/**
 * Builds the demo workspace: an organisation, two users, a sample agreement, a reusable
 * template, one envelope out for signature and one fully executed with its certificate.
 *
 * Callable from a script (`npm run seed`) and from server start-up, so an ephemeral
 * instance can populate itself on a cold boot.
 */
import { db, newId, nowIso, withDeterministicIds, DEMO_MODE } from './db.js';
import { hashPassword, generateKeyPair } from './crypto.js';
import { buildSamplePdf, inspectPdf } from './pdf.js';
import { saveVersion, sendEnvelope, completeRecipient, getRecipients, getEnvelope } from './envelopes.js';
import { recordEvent } from './audit.js';
import { drawSignaturePng } from './png.js';

const signatureFor = (seed, strokes = 2) =>
  `data:image/png;base64,${drawSignaturePng({ seed, strokes }).toString('base64')}`;

const EMAIL = 'owner@northwind.test';
const PASSWORD = 'inkwell-demo-2026';

function ensureOrg(quiet) {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(EMAIL);
  if (existing) {
    if (!quiet) console.log('Demo workspace already exists — reusing it.');
    return { orgId: existing.org_id, userId: existing.id };
  }
  const orgId = newId('org');
  const userId = newId('usr');
  const keys = generateKeyPair();
  db.prepare('INSERT INTO organizations (id, name, slug, signing_key, verify_key, created_at) VALUES (?,?,?,?,?,?)')
    .run(orgId, 'Northwind Legal', 'northwind-legal', keys.privateKey, keys.publicKey, nowIso());
  db.prepare('INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId, orgId, EMAIL, 'Avery Chen', hashPassword(PASSWORD), 'owner', nowIso());
  db.prepare('INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('usr'), orgId, 'paralegal@northwind.test', 'Sam Okafor', hashPassword(PASSWORD), 'member', nowIso());
  return { orgId, userId };
}

async function ensureDocument(orgId, userId, title) {
  const { bytes, anchors } = await buildSamplePdf(title);
  const meta = await inspectPdf(bytes);
  const docId = newId('doc');
  db.prepare('INSERT INTO documents (id, org_id, name, created_by, created_at) VALUES (?,?,?,?,?)')
    .run(docId, orgId, title, userId, nowIso());
  const version = saveVersion({
    orgId, documentId: docId, kind: 'source', filename: `${title.replace(/\s+/g, '-').toLowerCase()}.pdf`,
    buffer: bytes, pageCount: meta.pageCount, pageSizes: meta.pageSizes, createdBy: userId,
  });
  return { version, anchors };
}

/** Applies a recipient's marks, records their consent, and completes their step. */
async function signAs({ orgId, envelopeId, recipient, seed }) {
  const signature = signatureFor(seed);
  const initials = signatureFor(seed + 5, 1);
  for (const f of db.prepare('SELECT * FROM fields WHERE recipient_id = ?').all(recipient.id)) {
    const value =
      f.type === 'signature' ? signature
        : f.type === 'initials' ? initials
          : f.type === 'date' ? new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
            : f.type === 'checkbox' ? 'true'
              : recipient.name;
    db.prepare('UPDATE fields SET value = ?, value_meta = ?, filled_at = ? WHERE id = ?')
      .run(value, JSON.stringify({ method: f.type === 'signature' ? 'drawn' : 'input' }), nowIso(), f.id);
  }
  db.prepare('UPDATE recipients SET consent_at = ? WHERE id = ?').run(nowIso(), recipient.id);
  recordEvent({
    orgId, envelopeId, eventType: 'recipient.consented', actorType: 'recipient',
    actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
    ip: '203.0.113.44', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)',
    payload: { disclosure: 'Electronic Record and Signature Disclosure accepted' },
  });
  await completeRecipient({
    envelope: getEnvelope(orgId, envelopeId), recipient,
    meta: { ip: '203.0.113.44', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)' },
  });
}

/**
 * Field layout derived from the anchors printed into the sample agreement.
 *
 * `parties: 1` puts every field on the single signer, so the envelope completes the
 * moment they finish and the executed document is available to them immediately.
 */
function layoutFor(anchors, { parties = 2 } = {}) {
  const [first, second] = anchors.parties;
  if (parties === 1) {
    return [
      { role: 0, type: 'signature', ...first.signature },
      { role: 0, type: 'date', ...first.date },
      { role: 0, type: 'checkbox', label: 'Accepts the terms', ...anchors.checkbox },
      { role: 0, type: 'initials', label: 'Initials', ...anchors.initials },
    ];
  }
  return [
    { role: 0, type: 'signature', ...first.signature },
    { role: 0, type: 'date', ...first.date },
    { role: 1, type: 'signature', ...second.signature },
    { role: 1, type: 'date', ...second.date },
    { role: 1, type: 'checkbox', label: 'Accepts the terms', ...anchors.checkbox },
    { role: 1, type: 'initials', label: 'Initials', ...anchors.initials },
  ];
}

function createEnvelope({ orgId, userId, version, anchors, title, recipients, message }) {
  const layout = layoutFor(anchors, { parties: recipients.length });
  const envelopeId = newId('env');
  db.prepare(`INSERT INTO envelopes
    (id, org_id, document_id, source_version_id, title, message, status, ordered, created_by, created_at)
    VALUES (?,?,?,?,?,?,'draft',1,?,?)`)
    .run(envelopeId, orgId, version.document_id, version.id, title, message, userId, nowIso());

  const ids = recipients.map((r, i) => {
    const id = newId('rcp');
    db.prepare(`INSERT INTO recipients
      (id, envelope_id, org_id, order_index, name, email, role_name, kind, color)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, envelopeId, orgId, i + 1, r.name, r.email, r.role, 'signer',
        ['#4f46e5', '#0d9488', '#c2410c'][i % 3]);
    return id;
  });

  for (const f of layout) {
    db.prepare(`INSERT INTO fields
      (id, envelope_id, recipient_id, type, page, x, y, w, h, required, label, font_size)
      VALUES (?,?,?,?,?,?,?,?,?,1,?,10)`)
      .run(newId('fld'), envelopeId, ids[f.role], f.type, f.page, f.x, f.y, f.w, f.h, f.label || null);
  }

  recordEvent({
    orgId, envelopeId, eventType: 'envelope.created', actorType: 'user', actorId: userId,
    actorLabel: 'Avery Chen', ip: '198.51.100.24', userAgent: 'Inkwell seed script',
    payload: { title, documentSha256: version.sha256, recipients: recipients.length, ordered: true },
  });

  return envelopeId;
}


export async function seedDemoWorkspace({ quiet = false } = {}) {
  // Deterministic ids only matter for demo instances, where several functions each build
  // their own copy of this workspace and must agree on every identifier.
  if (DEMO_MODE) return withDeterministicIds(() => buildWorkspace({ quiet }));
  return buildWorkspace({ quiet });
}

async function buildWorkspace({ quiet = false } = {}) {
  const { orgId, userId } = ensureOrg(quiet);

  // 1) Executed envelope with a complete evidence record.
  const done = await ensureDocument(orgId, userId, 'Mutual Non-Disclosure Agreement');
  const doneId = createEnvelope({
    orgId, userId, version: done.version, anchors: done.anchors,
    title: 'Mutual NDA — Northwind & Vertex Labs',
    message: 'Standard mutual NDA ahead of the diligence call. No redlines expected.',
    recipients: [
      { name: 'Avery Chen', email: EMAIL, role: 'Disclosing Party' },
      { name: 'Jordan Reyes', email: 'jordan@vertexlabs.test', role: 'Receiving Party' },
    ],
  });
  await sendEnvelope({
    orgId, envelopeId: doneId,
    actor: { kind: 'user', user: { id: userId }, label: 'Avery Chen' },
    meta: { ip: '198.51.100.24', userAgent: 'Mozilla/5.0 (Macintosh) Inkwell seed' },
  });

  let seed = 11;
  for (const recipient of getRecipients(doneId)) {
    seed += 37;
    await signAs({ orgId, envelopeId: doneId, recipient, seed });
  }

  // 2) Envelope currently out for signature.
  const live = await ensureDocument(orgId, userId, 'Consulting Services Agreement');
  const liveId = createEnvelope({
    orgId, userId, version: live.version, anchors: live.anchors,
    title: 'Consulting Agreement — Q3 engagement',
    message: 'Countersigned on our side — please review section 3 and add your signature.',
    // The provider signs during seeding, so only the client's side is outstanding. The
    // client's signature therefore completes the envelope outright, and the document
    // they download carries both signatures.
    recipients: [
      { name: 'Avery Chen', email: EMAIL, role: 'Provider' },
      { name: 'Priya Raman', email: 'priya@vertexlabs.test', role: 'Client' },
    ],
  });
  await sendEnvelope({
    orgId, envelopeId: liveId,
    actor: { kind: 'user', user: { id: userId }, label: 'Avery Chen' },
    meta: { ip: '198.51.100.24', userAgent: 'Mozilla/5.0 (Macintosh) Inkwell seed' },
  });

  // Countersign as the provider. Routing then advances to the client, whose link is the
  // one offered in the app — they sign one side and the envelope is done.
  const [provider] = getRecipients(liveId);
  await signAs({ orgId, envelopeId: liveId, recipient: provider, seed: 301 });

  // 3) A reusable template.
  const tpl = await ensureDocument(orgId, userId, 'Mutual Non-Disclosure Agreement');
  const roles = [
    { key: 'role1', name: 'Disclosing Party', order: 1, color: '#4f46e5' },
    { key: 'role2', name: 'Receiving Party', order: 2, color: '#0d9488' },
  ];
  db.prepare(`INSERT INTO templates
    (id, org_id, name, description, document_version_id, roles, fields, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(newId('tpl'), orgId, 'Mutual NDA (standard)',
      'Two-party mutual NDA with signature, date and initials blocks.',
      tpl.version.id, JSON.stringify(roles),
      JSON.stringify(layoutFor(tpl.anchors).map((f) => ({
        roleKey: roles[f.role].key, type: f.type, page: f.page,
        x: f.x, y: f.y, w: f.w, h: f.h, required: true, label: f.label || null, fontSize: 10,
      }))),
      userId, nowIso(), nowIso());

  if (!quiet) {
    console.log('\n  Demo workspace ready\n');
    console.log('  URL       http://localhost:4000/login');
    console.log(`  Email     ${EMAIL}`);
    console.log(`  Password  ${PASSWORD}\n`);
    console.log('  Open the Outbox to pick up the live signing link for Priya Raman.\n');
  }
  return { email: EMAIL, password: PASSWORD };
}

/** True when the database has no organisation yet. */
export function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n === 0;
}

export const DEMO_CREDENTIALS = { email: EMAIL, password: PASSWORD };
