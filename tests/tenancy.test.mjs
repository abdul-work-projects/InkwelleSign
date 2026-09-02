import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempStore, bootstrap, makeDocument, makeEnvelope, META, ACTOR } from './helpers.mjs';
useTempStore('tenancy');

const { db } = await import('../lib/db.js');
const { getEnvelope, getEnvelopeBundle, sendEnvelope, resolveSigningToken, voidEnvelope } = await import('../lib/envelopes.js');
const { getBlob } = await import('../lib/storage.js');
const { roleAtLeast } = await import('../lib/permissions.js');

const alpha = await bootstrap({ orgName: 'Alpha Corp', email: 'owner@alpha.test' });
const beta = await bootstrap({ orgName: 'Beta Corp', email: 'owner@beta.test' });

const alphaDoc = await makeDocument(alpha.orgId, alpha.userId, 'Alpha Agreement');
const { envelopeId: alphaEnvelope } = await makeEnvelope({
  orgId: alpha.orgId, userId: alpha.userId, version: alphaDoc.version, anchors: alphaDoc.anchors,
  recipients: [{ name: 'A1', email: 'a1@alpha.test' }, { name: 'A2', email: 'a2@alpha.test' }],
});

test('envelope lookups are scoped to the owning organisation', () => {
  assert.ok(getEnvelope(alpha.orgId, alphaEnvelope));
  assert.equal(getEnvelope(beta.orgId, alphaEnvelope), undefined);
  assert.equal(getEnvelopeBundle(beta.orgId, alphaEnvelope), null);
});

test('a foreign tenant cannot void another tenant\'s envelope', async () => {
  await assert.rejects(
    () => voidEnvelope({ orgId: beta.orgId, envelopeId: alphaEnvelope, reason: 'x', actor: ACTOR(beta.userId), meta: META }),
    /Envelope not found/,
  );
  assert.equal(getEnvelope(alpha.orgId, alphaEnvelope).status, 'draft');
});

test('blobs are partitioned per organisation and path traversal is rejected', () => {
  const version = db.prepare('SELECT * FROM document_versions WHERE org_id = ?').get(alpha.orgId);
  assert.ok(version.storage_key.startsWith(`${alpha.orgId}/`));
  assert.equal(getBlob(version.storage_key).subarray(0, 5).toString('latin1'), '%PDF-');
  for (const bad of ['../../etc/passwd', 'a/../../b', 'single', 'a/b/c']) {
    assert.throws(() => getBlob(bad), /invalid storage key/);
  }
});

test('signing tokens resolve to exactly one recipient regardless of tenant', async () => {
  await sendEnvelope({ orgId: alpha.orgId, envelopeId: alphaEnvelope, actor: ACTOR(alpha.userId), meta: META });
  const row = db.prepare("SELECT text FROM email_outbox WHERE envelope_id = ? ORDER BY rowid DESC LIMIT 1").get(alphaEnvelope);
  const token = (row.text.match(/\/sign\/(\S+)/) || [])[1];
  const resolved = resolveSigningToken(token);
  assert.equal(resolved.envelope.org_id, alpha.orgId);
  assert.equal(resolved.recipient.email, 'a1@alpha.test');
});

test('role ranking gates privileged actions', () => {
  assert.equal(roleAtLeast('owner', 'admin'), true);
  assert.equal(roleAtLeast('admin', 'admin'), true);
  assert.equal(roleAtLeast('member', 'admin'), false);
  assert.equal(roleAtLeast('viewer', 'member'), false);
  assert.equal(roleAtLeast('viewer', 'viewer'), true);
  assert.equal(roleAtLeast('nonsense', 'viewer'), false);
});
