import { cookies } from 'next/headers';
import { db, nowIso } from '@/lib/db.js';
import { withPublic, json, fail } from '@/lib/api.js';
import { sha256 } from '@/lib/crypto.js';
import { recordEvent } from '@/lib/audit.js';
import { resolveSigningToken, getFields, getRecipients } from '@/lib/envelopes.js';
import { dispatchWebhooks } from '@/lib/webhooks.js';

export const SIGN_COOKIE = 'ink_sign_ok';
export function accessProof(recipient) {
  return sha256(`${recipient.id}:${recipient.access_code_hash}`);
}

const REASONS = {
  invalid: 'This signing link is not valid. It may have been replaced by a newer link.',
  completed: 'You have already completed this document. A copy was emailed to you.',
  declined: 'This document was declined and is no longer available for signing.',
  voided: 'This document has been voided by the sender.',
  expired: 'This signing request has expired.',
  not_your_turn: 'It is not your turn to sign yet. You will be notified by email when the document reaches you.',
};

export const GET = withPublic(async ({ params, meta }) => {
  const resolved = resolveSigningToken(params.token);
  if (resolved.error) {
    return json({
      error: resolved.error,
      message: REASONS[resolved.error] || REASONS.invalid,
      envelopeTitle: resolved.envelope?.title || null,
    }, { status: resolved.error === 'invalid' ? 404 : 410 });
  }

  const { envelope, recipient } = resolved;

  if (recipient.access_code_hash) {
    const jar = await cookies();
    if (jar.get(SIGN_COOKIE)?.value !== accessProof(recipient)) {
      return json({
        requiresAccessCode: true,
        recipientName: recipient.name,
        envelopeTitle: envelope.title,
      }, { status: 401 });
    }
  }

  if (!recipient.viewed_at) {
    db.prepare("UPDATE recipients SET viewed_at = ?, status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE id = ?")
      .run(nowIso(), recipient.id);
    recordEvent({
      orgId: envelope.org_id, envelopeId: envelope.id, eventType: 'recipient.viewed',
      actorType: 'recipient', actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
      ip: meta.ip, userAgent: meta.userAgent, payload: {},
    });
    dispatchWebhooks(envelope.org_id, 'envelope.viewed', {
      envelopeId: envelope.id, recipient: { id: recipient.id, email: recipient.email },
    });
  }

  const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(envelope.org_id);
  const sender = db.prepare('SELECT name, email FROM users WHERE id = ?').get(envelope.created_by);
  const version = db.prepare('SELECT id, page_count, page_sizes, filename FROM document_versions WHERE id = ?')
    .get(envelope.source_version_id);
  const allFields = getFields(envelope.id);
  const allRecipients = getRecipients(envelope.id);

  return json({
    envelope: {
      id: envelope.id, title: envelope.title, message: envelope.message,
      status: envelope.status, ordered: !!envelope.ordered, expires_at: envelope.expires_at,
    },
    organization: org?.name || 'Inkwell eSign',
    sender: sender ? { name: sender.name, email: sender.email } : null,
    recipient: {
      id: recipient.id, name: recipient.name, email: recipient.email,
      role: recipient.role_name, order: recipient.order_index, consent_at: recipient.consent_at,
    },
    document: {
      versionId: version.id, pageCount: version.page_count, filename: version.filename,
      pageSizes: version.page_sizes ? JSON.parse(version.page_sizes) : null,
    },
    // Own fields are editable; other parties' fields are shown read-only for context.
    fields: allFields.map((f) => ({
      id: f.id, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h,
      required: !!f.required, label: f.label, options: f.options ? JSON.parse(f.options) : null,
      fontSize: f.font_size, value: f.value, mine: f.recipient_id === recipient.id,
      recipientColor: allRecipients.find((r) => r.id === f.recipient_id)?.color || '#94a3b8',
      recipientName: allRecipients.find((r) => r.id === f.recipient_id)?.name || '',
    })),
  });
});
