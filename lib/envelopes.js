import { db, newId, nowIso } from './db.js';
import { sha256, randomToken } from './crypto.js';
import { recordEvent, getEvents, sealEvidence } from './audit.js';
import { getBlob, putBlob } from './storage.js';
import { renderExecutedPdf, buildCertificate } from './pdf.js';
import { sendMail, templates, appUrl } from './mailer.js';
import { dispatchWebhooks } from './webhooks.js';
import { RECIPIENT_COLORS } from './colors.js';

export { RECIPIENT_COLORS } from './colors.js';

export function getEnvelope(orgId, envelopeId) {
  return db.prepare('SELECT * FROM envelopes WHERE id = ? AND org_id = ?').get(envelopeId, orgId);
}

export function getRecipients(envelopeId) {
  return db.prepare('SELECT * FROM recipients WHERE envelope_id = ? ORDER BY order_index ASC, rowid ASC').all(envelopeId);
}

export function getFields(envelopeId) {
  return db.prepare('SELECT * FROM fields WHERE envelope_id = ? ORDER BY page ASC, y ASC').all(envelopeId);
}

export function getEnvelopeBundle(orgId, envelopeId) {
  const envelope = getEnvelope(orgId, envelopeId);
  if (!envelope) return null;
  const source = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.source_version_id);
  return {
    envelope,
    recipients: getRecipients(envelopeId),
    fields: getFields(envelopeId),
    source,
    finalVersion: envelope.final_version_id
      ? db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.final_version_id) : null,
    certificateVersion: envelope.certificate_version_id
      ? db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.certificate_version_id) : null,
  };
}

/** Signers whose turn it currently is. Parallel envelopes activate everyone at once. */
export function activeRecipients(envelope, recipients) {
  const pending = recipients.filter((r) => r.kind !== 'cc' && r.status !== 'completed' && r.status !== 'declined');
  if (!pending.length) return [];
  if (!envelope.ordered) return pending;
  const turn = Math.min(...pending.map((r) => r.order_index));
  return pending.filter((r) => r.order_index === turn);
}

function issueToken(recipientId) {
  const raw = randomToken(32);
  db.prepare('UPDATE recipients SET token_hash = ?, token_prefix = ? WHERE id = ?')
    .run(sha256(raw), raw.slice(0, 8), recipientId);
  return raw;
}

export function signingUrl(rawToken) {
  return `${appUrl()}/sign/${rawToken}`;
}

async function notify(kind, { envelope, recipient, senderName, rawToken, extra = {} }) {
  const url = rawToken ? signingUrl(rawToken) : `${appUrl()}/envelopes/${envelope.id}`;
  const built = templates[kind]({ recipient, envelope, sender: senderName, url, ...extra });
  return sendMail({
    orgId: envelope.org_id,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    to: recipient.email,
    toName: recipient.name,
    kind,
    ...built,
  });
}

/** Transitions a draft envelope to `sent` and invites the first turn of signers. */
export async function sendEnvelope({ orgId, envelopeId, actor, meta }) {
  const envelope = getEnvelope(orgId, envelopeId);
  if (!envelope) throw new Error('Envelope not found');
  if (envelope.status !== 'draft') throw new Error(`Envelope is already ${envelope.status}`);

  const recipients = getRecipients(envelopeId);
  if (!recipients.length) throw new Error('Add at least one recipient before sending');
  const fields = getFields(envelopeId);
  const signers = recipients.filter((r) => r.kind !== 'cc');
  if (!signers.length) throw new Error('Add at least one signer');
  const unassigned = signers.filter((r) => !fields.some((f) => f.recipient_id === r.id));
  if (unassigned.length) {
    throw new Error(`No fields assigned to: ${unassigned.map((r) => r.name).join(', ')}`);
  }

  const sentAt = nowIso();
  db.prepare("UPDATE envelopes SET status = 'sent', sent_at = ? WHERE id = ?").run(sentAt, envelopeId);
  const updated = getEnvelope(orgId, envelopeId);

  recordEvent({
    orgId, envelopeId, eventType: 'envelope.sent',
    actorType: actor.kind === 'api' ? 'api' : 'user', actorId: actor.user?.id || actor.apiKey?.id,
    actorLabel: actor.label, ip: meta.ip, userAgent: meta.userAgent,
    payload: {
      recipients: recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, order: r.order_index, kind: r.kind })),
      ordered: !!envelope.ordered, fieldCount: fields.length,
    },
  });

  const turn = activeRecipients(updated, recipients);
  for (const recipient of turn) {
    const raw = issueToken(recipient.id);
    db.prepare("UPDATE recipients SET status = 'sent', sent_at = ? WHERE id = ?").run(sentAt, recipient.id);
    await notify('invitation', { envelope: updated, recipient, senderName: actor.label, rawToken: raw });
    recordEvent({
      orgId, envelopeId, eventType: 'recipient.invited', actorType: 'system',
      actorLabel: 'Inkwell', payload: { recipientId: recipient.id, email: recipient.email },
    });
  }

  dispatchWebhooks(orgId, 'envelope.sent', publicEnvelope(orgId, envelopeId));
  return { sent: turn.length };
}

export async function remindRecipient({ orgId, envelopeId, recipientId, actor, meta }) {
  const envelope = getEnvelope(orgId, envelopeId);
  if (!envelope) throw new Error('Envelope not found');
  const recipient = db.prepare('SELECT * FROM recipients WHERE id = ? AND envelope_id = ?').get(recipientId, envelopeId);
  if (!recipient) throw new Error('Recipient not found');
  if (recipient.status === 'completed') throw new Error('Recipient has already completed');

  const turn = activeRecipients(envelope, getRecipients(envelopeId));
  if (!turn.some((r) => r.id === recipientId)) throw new Error('It is not this recipient\'s turn to sign');

  // A reminder always re-issues the link; the previous token is invalidated.
  const raw = issueToken(recipientId);
  db.prepare('UPDATE recipients SET last_reminded_at = ?, reminder_count = reminder_count + 1 WHERE id = ?')
    .run(nowIso(), recipientId);
  await notify('reminder', { envelope, recipient, senderName: actor.label, rawToken: raw });
  recordEvent({
    orgId, envelopeId, eventType: 'recipient.reminded',
    actorType: actor.kind === 'api' ? 'api' : 'user', actorId: actor.user?.id, actorLabel: actor.label,
    ip: meta.ip, userAgent: meta.userAgent,
    payload: { recipientId, email: recipient.email },
  });
  return { ok: true };
}

/** Marks a signer complete, then either advances the order or finalises. */
export async function completeRecipient({ envelope, recipient, meta }) {
  const at = nowIso();
  db.prepare("UPDATE recipients SET status = 'completed', completed_at = ?, signed_ip = ?, signed_user_agent = ? WHERE id = ?")
    .run(at, meta.ip, meta.userAgent, recipient.id);
  // The token is deliberately retained. `resolveSigningToken` refuses every action on a
  // completed recipient, so it grants no capability — but keeping it lets someone who
  // re-opens their own emailed link see "you have already signed" instead of a generic
  // "invalid link" error. A reminder still rotates the token, invalidating the old one.

  const filled = db.prepare('SELECT type, label, value, filled_at FROM fields WHERE recipient_id = ?').all(recipient.id);
  recordEvent({
    orgId: envelope.org_id, envelopeId: envelope.id, eventType: 'recipient.signed',
    actorType: 'recipient', actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
    ip: meta.ip, userAgent: meta.userAgent,
    payload: {
      fields: filled.map((f) => ({
        type: f.type, label: f.label,
        // Signature images are recorded by digest, never verbatim, to keep the log compact.
        value: f.type === 'signature' || f.type === 'initials' ? `sha256:${sha256(f.value || '')}` : f.value,
      })),
    },
  });

  dispatchWebhooks(envelope.org_id, 'envelope.recipient_completed', {
    ...publicEnvelope(envelope.org_id, envelope.id),
    recipient: { id: recipient.id, name: recipient.name, email: recipient.email },
  });

  const recipients = getRecipients(envelope.id);
  const remaining = recipients.filter((r) => r.kind !== 'cc' && r.status !== 'completed' && r.status !== 'declined');

  if (!remaining.length) {
    await finalizeEnvelope(envelope.org_id, envelope.id);
    return { completed: true };
  }

  db.prepare("UPDATE envelopes SET status = 'in_progress' WHERE id = ? AND status = 'sent'").run(envelope.id);
  const next = activeRecipients(getEnvelope(envelope.org_id, envelope.id), recipients);
  const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(envelope.created_by);
  for (const r of next) {
    if (r.status !== 'created') continue; // already invited
    const raw = issueToken(r.id);
    db.prepare("UPDATE recipients SET status = 'sent', sent_at = ? WHERE id = ?").run(nowIso(), r.id);
    await notify('invitation', { envelope, recipient: r, senderName: sender?.name || 'Inkwell eSign', rawToken: raw });
    recordEvent({
      orgId: envelope.org_id, envelopeId: envelope.id, eventType: 'recipient.invited',
      actorType: 'system', actorLabel: 'Inkwell', payload: { recipientId: r.id, email: r.email },
    });
  }
  return { completed: false, advancedTo: next.map((r) => r.id) };
}

export async function declineEnvelope({ envelope, recipient, reason, meta }) {
  const at = nowIso();
  db.prepare("UPDATE recipients SET status = 'declined', declined_at = ?, decline_reason = ? WHERE id = ?")
    .run(at, reason || null, recipient.id);
  db.prepare("UPDATE envelopes SET status = 'declined' WHERE id = ?").run(envelope.id);
  recordEvent({
    orgId: envelope.org_id, envelopeId: envelope.id, eventType: 'recipient.declined',
    actorType: 'recipient', actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
    ip: meta.ip, userAgent: meta.userAgent, payload: { reason: reason || null },
  });

  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(envelope.created_by);
  if (owner) {
    const built = templates.declined({
      recipient: { name: owner.name }, envelope, decliner: recipient.name, reason,
    });
    await sendMail({
      orgId: envelope.org_id, envelopeId: envelope.id, to: owner.email, toName: owner.name,
      kind: 'declined', ...built,
    });
  }
  dispatchWebhooks(envelope.org_id, 'envelope.declined', publicEnvelope(envelope.org_id, envelope.id));
}

/**
 * Produces the executed PDF and certificate of completion, then seals the evidence
 * record with the organisation signing key.
 */
export async function finalizeEnvelope(orgId, envelopeId) {
  const envelope = getEnvelope(orgId, envelopeId);
  if (!envelope) throw new Error('Envelope not found');
  const recipients = getRecipients(envelopeId);
  const fields = getFields(envelopeId);
  const source = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.source_version_id);
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);

  const completedAt = nowIso();
  db.prepare("UPDATE envelopes SET status = 'completed', completed_at = ? WHERE id = ?").run(completedAt, envelopeId);
  recordEvent({
    orgId, envelopeId, eventType: 'envelope.completed', actorType: 'system', actorLabel: 'Inkwell',
    payload: { recipients: recipients.filter((r) => r.kind !== 'cc').length, fields: fields.length },
  });

  const withHead = getEnvelope(orgId, envelopeId);
  const sourceBytes = getBlob(source.storage_key);
  const executed = await renderExecutedPdf({ sourceBytes, fields, recipients, envelope: withHead });

  const executedVersion = saveVersion({
    orgId, documentId: envelope.document_id, kind: 'executed',
    filename: `${slug(envelope.title)}-executed.pdf`, buffer: executed.bytes,
    pageCount: executed.pageCount, createdBy: envelope.created_by,
  });

  recordEvent({
    orgId, envelopeId, eventType: 'document.executed', actorType: 'system', actorLabel: 'Inkwell',
    payload: { sha256: executed.sha256, bytes: executed.bytes.length, sourceSha256: source.sha256 },
  });

  const signature = sealEvidence(orgId, envelopeId, executed.sha256);

  const certificate = await buildCertificate({
    envelope: getEnvelope(orgId, envelopeId),
    recipients, events: getEvents(envelopeId), org,
    sourceVersion: source, executedVersion, evidenceSignature: signature,
  });
  const certVersion = saveVersion({
    orgId, documentId: envelope.document_id, kind: 'certificate',
    filename: `${slug(envelope.title)}-certificate.pdf`, buffer: certificate.bytes,
    pageCount: certificate.pageCount, createdBy: envelope.created_by,
  });

  db.prepare('UPDATE envelopes SET final_version_id = ?, certificate_version_id = ? WHERE id = ?')
    .run(executedVersion.id, certVersion.id, envelopeId);

  const url = `${appUrl()}/envelopes/${envelopeId}`;
  for (const r of recipients) {
    const built = templates.completed({ recipient: r, envelope, url });
    await sendMail({
      orgId, envelopeId, recipientId: r.id, to: r.email, toName: r.name, kind: 'completed', ...built,
    });
  }
  const owner = db.prepare('SELECT name, email FROM users WHERE id = ?').get(envelope.created_by);
  if (owner && !recipients.some((r) => r.email === owner.email)) {
    const built = templates.completed({ recipient: owner, envelope, url });
    await sendMail({ orgId, envelopeId, to: owner.email, toName: owner.name, kind: 'completed', ...built });
  }

  dispatchWebhooks(orgId, 'envelope.completed', publicEnvelope(orgId, envelopeId));
  return { executedVersion, certVersion };
}

export function saveVersion({ orgId, documentId, kind, filename, buffer, pageCount, pageSizes = null, createdBy }) {
  const blob = putBlob(orgId, buffer);
  const row = db.prepare('SELECT MAX(version) AS v FROM document_versions WHERE document_id = ?').get(documentId);
  const version = (row?.v || 0) + 1;
  const id = newId('dv');
  db.prepare(`INSERT INTO document_versions
    (id, document_id, org_id, version, kind, filename, mime, byte_size, sha256, storage_key, page_count, page_sizes, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, documentId, orgId, version, kind, filename, 'application/pdf', blob.byteSize, blob.sha256,
      blob.storageKey, pageCount, pageSizes ? JSON.stringify(pageSizes) : null, createdBy, nowIso());
  return db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id);
}

export async function voidEnvelope({ orgId, envelopeId, reason, actor, meta }) {
  const envelope = getEnvelope(orgId, envelopeId);
  if (!envelope) throw new Error('Envelope not found');
  if (envelope.status === 'completed') throw new Error('Completed envelopes cannot be voided');
  // Voiding the envelope is what kills the links: resolveSigningToken refuses any
  // envelope in a terminal state, so outstanding tokens stop authorising anything while
  // still resolving well enough to explain why.
  db.prepare("UPDATE envelopes SET status = 'voided', voided_at = ?, void_reason = ? WHERE id = ?")
    .run(nowIso(), reason || null, envelopeId);
  recordEvent({
    orgId, envelopeId, eventType: 'envelope.voided',
    actorType: actor.kind === 'api' ? 'api' : 'user', actorId: actor.user?.id, actorLabel: actor.label,
    ip: meta.ip, userAgent: meta.userAgent, payload: { reason: reason || null },
  });
  dispatchWebhooks(orgId, 'envelope.voided', publicEnvelope(orgId, envelopeId));
}

export function publicEnvelope(orgId, envelopeId) {
  const e = getEnvelope(orgId, envelopeId);
  if (!e) return null;
  return {
    id: e.id,
    title: e.title,
    status: e.status,
    ordered: !!e.ordered,
    created_at: e.created_at,
    sent_at: e.sent_at,
    completed_at: e.completed_at,
    audit_head_hash: e.audit_head_hash,
    recipients: getRecipients(envelopeId).map((r) => ({
      id: r.id, name: r.name, email: r.email, role: r.role_name, kind: r.kind,
      order: r.order_index, status: r.status, viewed_at: r.viewed_at, completed_at: r.completed_at,
    })),
  };
}

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';
}

/** Resolves a raw signing token to its recipient + envelope, enforcing envelope state. */
export function resolveSigningToken(rawToken) {
  const recipient = db.prepare('SELECT * FROM recipients WHERE token_hash = ?').get(sha256(String(rawToken || '')));
  if (!recipient) return { error: 'invalid' };
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ?').get(recipient.envelope_id);
  if (!envelope) return { error: 'invalid' };
  if (['voided', 'declined'].includes(envelope.status)) return { error: envelope.status, envelope, recipient };
  if (envelope.expires_at && new Date(envelope.expires_at) < new Date()) return { error: 'expired', envelope, recipient };
  if (recipient.status === 'completed') return { error: 'completed', envelope, recipient };
  const turn = activeRecipients(envelope, getRecipients(envelope.id));
  if (!turn.some((r) => r.id === recipient.id)) return { error: 'not_your_turn', envelope, recipient };
  return { envelope, recipient };
}
