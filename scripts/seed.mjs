/**
 * Seeds a demo workspace: an organisation, two users, a sample agreement,
 * a reusable template, one envelope out for signature and one fully executed
 * envelope complete with certificate of completion.
 *
 *   node scripts/seed.mjs
 */
import { db, newId, nowIso } from '../lib/db.js';
import { hashPassword, generateKeyPair } from '../lib/crypto.js';
import { buildSamplePdf, inspectPdf } from '../lib/pdf.js';
import { saveVersion, sendEnvelope, completeRecipient, getRecipients, getEnvelope } from '../lib/envelopes.js';
import { recordEvent } from '../lib/audit.js';
import { drawSignaturePng } from '../lib/png.js';

const signatureFor = (seed, strokes = 2) =>
  `data:image/png;base64,${drawSignaturePng({ seed, strokes }).toString('base64')}`;

const EMAIL = 'owner@northwind.test';
const PASSWORD = 'inkwell-demo-2026';

function ensureOrg() {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(EMAIL);
  if (existing) {
    console.log('Demo workspace already exists — reusing it.');
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

/** Field layout derived from the anchors printed into the sample agreement. */
function layoutFor(anchors) {
  const [first, second] = anchors.parties;
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

  for (const f of layoutFor(anchors)) {
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


async function main() {
  const { orgId, userId } = ensureOrg();

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
    const signature = signatureFor(seed);
    const initials = signatureFor(seed + 5, 1);
    const fields = db.prepare('SELECT * FROM fields WHERE recipient_id = ?').all(recipient.id);
    for (const f of fields) {
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
      orgId, envelopeId: doneId, eventType: 'recipient.consented', actorType: 'recipient',
      actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
      ip: '203.0.113.44', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)',
      payload: { disclosure: 'Electronic Record and Signature Disclosure accepted' },
    });
    await completeRecipient({
      envelope: getEnvelope(orgId, doneId), recipient,
      meta: { ip: '203.0.113.44', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)' },
    });
  }

  // 2) Envelope currently out for signature.
  const live = await ensureDocument(orgId, userId, 'Consulting Services Agreement');
  const liveId = createEnvelope({
    orgId, userId, version: live.version, anchors: live.anchors,
    title: 'Consulting Agreement — Q3 engagement',
    message: 'Please review section 3 and sign at your convenience.',
    recipients: [
      { name: 'Priya Raman', email: 'priya@vertexlabs.test', role: 'Client' },
      { name: 'Avery Chen', email: EMAIL, role: 'Provider' },
    ],
  });
  await sendEnvelope({
    orgId, envelopeId: liveId,
    actor: { kind: 'user', user: { id: userId }, label: 'Avery Chen' },
    meta: { ip: '198.51.100.24', userAgent: 'Mozilla/5.0 (Macintosh) Inkwell seed' },
  });

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

  console.log('\n  Demo workspace ready\n');
  console.log(`  URL       http://localhost:4000/login`);
  console.log(`  Email     ${EMAIL}`);
  console.log(`  Password  ${PASSWORD}\n`);
  console.log('  Open the Outbox to pick up the live signing link for Priya Raman.\n');
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
