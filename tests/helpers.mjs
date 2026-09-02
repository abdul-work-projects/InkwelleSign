import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every test file gets an isolated database + blob store.
export function useTempStore(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `inkwell-${name}-`));
  process.env.INKWELL_DATA_DIR = dir;
  process.env.APP_URL = 'http://localhost:4000';
  delete process.env.SMTP_URL;
  return dir;
}

export async function bootstrap({ orgName = 'Test Org', userName = 'Test Owner', email = 'owner@test.local' } = {}) {
  const { db, newId, nowIso } = await import('../lib/db.js');
  const { hashPassword, generateKeyPair } = await import('../lib/crypto.js');
  const orgId = newId('org');
  const userId = newId('usr');
  const keys = generateKeyPair();
  db.prepare('INSERT INTO organizations (id, name, slug, signing_key, verify_key, created_at) VALUES (?,?,?,?,?,?)')
    .run(orgId, orgName, `${orgName.toLowerCase().replace(/\W+/g, '-')}-${orgId.slice(-4)}`, keys.privateKey, keys.publicKey, nowIso());
  db.prepare('INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId, orgId, email, userName, hashPassword('correct-horse-battery'), 'owner', nowIso());
  return { orgId, userId, db };
}

export async function makeDocument(orgId, userId, title = 'Test Agreement') {
  const { db, newId, nowIso } = await import('../lib/db.js');
  const { buildSamplePdf, inspectPdf } = await import('../lib/pdf.js');
  const { saveVersion } = await import('../lib/envelopes.js');
  const { bytes, anchors } = await buildSamplePdf(title);
  const meta = await inspectPdf(bytes);
  const documentId = newId('doc');
  db.prepare('INSERT INTO documents (id, org_id, name, created_by, created_at) VALUES (?,?,?,?,?)')
    .run(documentId, orgId, title, userId, nowIso());
  const version = saveVersion({
    orgId, documentId, kind: 'source', filename: 'test.pdf', buffer: bytes,
    pageCount: meta.pageCount, pageSizes: meta.pageSizes, createdBy: userId,
  });
  return { version, anchors };
}

export async function makeEnvelope({ orgId, userId, version, anchors, recipients, ordered = true }) {
  const { db, newId, nowIso } = await import('../lib/db.js');
  const envelopeId = newId('env');
  db.prepare(`INSERT INTO envelopes
    (id, org_id, document_id, source_version_id, title, status, ordered, created_by, created_at)
    VALUES (?,?,?,?,?,'draft',?,?,?)`)
    .run(envelopeId, orgId, version.document_id, version.id, 'Test envelope', ordered ? 1 : 0, userId, nowIso());

  const ids = recipients.map((r, i) => {
    const id = newId('rcp');
    db.prepare(`INSERT INTO recipients (id, envelope_id, org_id, order_index, name, email, kind, color, access_code_hash, auth_method)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, envelopeId, orgId, ordered ? i + 1 : 1, r.name, r.email, r.kind || 'signer', '#4f46e5',
        r.accessCodeHash || null, r.accessCodeHash ? 'access_code' : 'link');
    return id;
  });

  recipients.forEach((r, i) => {
    const rect = i === 0 ? anchors.parties[0].signature : anchors.parties[1].signature;
    db.prepare(`INSERT INTO fields (id, envelope_id, recipient_id, type, page, x, y, w, h, required, font_size)
      VALUES (?,?,?,?,?,?,?,?,?,1,11)`)
      .run(newId('fld'), envelopeId, ids[i], 'signature', rect.page, rect.x, rect.y, rect.w, rect.h);
  });

  return { envelopeId, recipientIds: ids };
}

export const META = { ip: '203.0.113.9', userAgent: 'node-test' };
export const ACTOR = (userId) => ({ kind: 'user', user: { id: userId }, label: 'Test Owner' });
