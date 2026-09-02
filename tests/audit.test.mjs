import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempStore, bootstrap, makeDocument, makeEnvelope } from './helpers.mjs';
useTempStore('audit');

const { db } = await import('../lib/db.js');
const { recordEvent, verifyChain, getEvents, sealEvidence, verifyEvidenceSeal, GENESIS } = await import('../lib/audit.js');

const { orgId, userId } = await bootstrap();
const { version, anchors } = await makeDocument(orgId, userId);
const { envelopeId } = await makeEnvelope({
  orgId, userId, version, anchors,
  recipients: [{ name: 'A', email: 'a@test.local' }, { name: 'B', email: 'b@test.local' }],
});

test('events chain from the genesis hash', () => {
  recordEvent({ orgId, envelopeId, eventType: 'envelope.created', actorType: 'user', actorId: userId, payload: { n: 1 } });
  recordEvent({ orgId, envelopeId, eventType: 'envelope.sent', actorType: 'user', actorId: userId, payload: { n: 2 } });
  recordEvent({ orgId, envelopeId, eventType: 'recipient.viewed', actorType: 'recipient', payload: { n: 3 } });

  const events = getEvents(envelopeId);
  assert.equal(events.length, 3);
  assert.equal(events[0].prev_hash, GENESIS);
  assert.equal(events[1].prev_hash, events[0].hash);
  assert.equal(events[2].prev_hash, events[1].hash);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
  assert.equal(verifyChain(envelopeId).valid, true);
});

test('the envelope head hash tracks the newest event', () => {
  const head = db.prepare('SELECT audit_head_hash FROM envelopes WHERE id = ?').get(envelopeId).audit_head_hash;
  const last = getEvents(envelopeId).at(-1);
  assert.equal(head, last.hash);
});

test('mutating a historical payload breaks verification', () => {
  const target = getEvents(envelopeId)[1];
  db.prepare('UPDATE audit_events SET payload = ? WHERE id = ?').run('{"n":99}', target.id);
  const result = verifyChain(envelopeId);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 2);
  assert.equal(result.reason, 'event hash mismatch');
  db.prepare('UPDATE audit_events SET payload = ? WHERE id = ?').run('{"n":2}', target.id);
  assert.equal(verifyChain(envelopeId).valid, true);
});

test('deleting an event breaks the sequence', () => {
  const target = getEvents(envelopeId)[1];
  const backup = { ...target };
  db.prepare('DELETE FROM audit_events WHERE id = ?').run(target.id);
  const result = verifyChain(envelopeId);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 3);
  db.prepare(`INSERT INTO audit_events
    (id, org_id, envelope_id, seq, event_type, actor_type, actor_id, actor_label, ip, user_agent, payload, prev_hash, hash, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(backup.id, backup.org_id, backup.envelope_id, backup.seq, backup.event_type, backup.actor_type,
      backup.actor_id, backup.actor_label, backup.ip, backup.user_agent, backup.payload,
      backup.prev_hash, backup.hash, backup.created_at);
  assert.equal(verifyChain(envelopeId).valid, true);
});

test('a forged event cannot be spliced in without the chain noticing', () => {
  const events = getEvents(envelopeId);
  const forged = { ...events[2] };
  db.prepare('UPDATE audit_events SET event_type = ? WHERE id = ?').run('recipient.signed', forged.id);
  assert.equal(verifyChain(envelopeId).valid, false);
  db.prepare('UPDATE audit_events SET event_type = ? WHERE id = ?').run(forged.event_type, forged.id);
});

test('the evidence seal binds the audit head to the executed document digest', () => {
  // Attach a final version so sealEvidence and verifyEvidenceSeal see the same digest.
  const source = db.prepare('SELECT * FROM document_versions WHERE id = (SELECT source_version_id FROM envelopes WHERE id = ?)').get(envelopeId);
  db.prepare('UPDATE envelopes SET final_version_id = ? WHERE id = ?').run(source.id, envelopeId);

  const signature = sealEvidence(orgId, envelopeId, source.sha256);
  assert.ok(signature, 'sealing should produce a signature');
  assert.deepEqual(verifyEvidenceSeal(orgId, envelopeId), { sealed: true, valid: true });

  // Swapping the recorded document digest invalidates the seal.
  db.prepare('UPDATE document_versions SET sha256 = ? WHERE id = ?').run('b'.repeat(64), source.id);
  assert.equal(verifyEvidenceSeal(orgId, envelopeId).valid, false);
  db.prepare('UPDATE document_versions SET sha256 = ? WHERE id = ?').run(source.sha256, source.id);

  // So does rewriting history, because the head hash is part of the signed payload.
  const first = getEvents(envelopeId)[0];
  db.prepare('UPDATE envelopes SET audit_head_hash = ? WHERE id = ?').run(first.hash, envelopeId);
  assert.equal(verifyEvidenceSeal(orgId, envelopeId).valid, false);
});
