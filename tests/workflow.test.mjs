import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempStore, bootstrap, makeDocument, makeEnvelope, META, ACTOR } from './helpers.mjs';
useTempStore('workflow');

const { db, nowIso } = await import('../lib/db.js');
const { sha256 } = await import('../lib/crypto.js');
const { verifyChain, verifyEvidenceSeal } = await import('../lib/audit.js');
const { verifyBlob, getBlob } = await import('../lib/storage.js');
const {
  sendEnvelope, resolveSigningToken, completeRecipient, declineEnvelope,
  voidEnvelope, remindRecipient, getRecipients, getEnvelope, activeRecipients,
} = await import('../lib/envelopes.js');

const { orgId, userId } = await bootstrap();

function linkFor(envelopeId, email) {
  const row = db.prepare(
    "SELECT text FROM email_outbox WHERE envelope_id = ? AND to_email = ? ORDER BY rowid DESC LIMIT 1"
  ).get(envelopeId, email);
  return row ? (row.text.match(/\/sign\/(\S+)/) || [])[1] : null;
}

function fill(recipientId) {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  db.prepare("UPDATE fields SET value = ?, filled_at = ? WHERE recipient_id = ?")
    .run(png, nowIso(), recipientId);
}

test('sequential routing invites only the current step, then advances', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Sequential Agreement');
  const { envelopeId, recipientIds } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'First', email: 'first@test.local' }, { name: 'Second', email: 'second@test.local' }],
  });

  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });

  let recipients = getRecipients(envelopeId);
  assert.equal(recipients[0].status, 'sent');
  assert.equal(recipients[1].status, 'created', 'the second signer must not be invited yet');
  assert.equal(linkFor(envelopeId, 'second@test.local'), null);

  // Second signer's link does not exist, and their turn check fails.
  assert.deepEqual(
    activeRecipients(getEnvelope(orgId, envelopeId), recipients).map((r) => r.id),
    [recipientIds[0]],
  );

  fill(recipientIds[0]);
  await completeRecipient({
    envelope: getEnvelope(orgId, envelopeId), recipient: recipients[0], meta: META,
  });

  recipients = getRecipients(envelopeId);
  assert.equal(recipients[0].status, 'completed');
  assert.equal(recipients[1].status, 'sent', 'completing step 1 must invite step 2');
  assert.ok(linkFor(envelopeId, 'second@test.local'));
  assert.equal(getEnvelope(orgId, envelopeId).status, 'in_progress');
});

test('a signing token stops authorising anything once its recipient completes', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Token Agreement');
  const { envelopeId, recipientIds } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'Only', email: 'only@test.local' }, { name: 'Cc', email: 'cc@test.local', kind: 'cc' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });

  const token = linkFor(envelopeId, 'only@test.local');
  assert.ok(token);
  assert.equal(resolveSigningToken(token).error, undefined);
  assert.equal(resolveSigningToken(`${token}x`).error, 'invalid');

  // Only the digest is stored.
  const stored = db.prepare('SELECT token_hash FROM recipients WHERE id = ?').get(recipientIds[0]).token_hash;
  assert.equal(stored, sha256(token));
  assert.notEqual(stored, token);

  fill(recipientIds[0]);
  await completeRecipient({
    envelope: getEnvelope(orgId, envelopeId), recipient: getRecipients(envelopeId)[0], meta: META,
  });

  // The token still resolves, so the signer gets an accurate "already signed" message,
  // but it authorises nothing: every signing endpoint refuses on a non-empty error.
  const after = resolveSigningToken(token);
  assert.equal(after.error, 'completed');
  assert.equal(after.envelope.id, envelopeId);
});

test('terminal envelope states produce an explanatory refusal, not a generic one', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Terminal States');

  const voided = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'V', email: 'vterm@test.local' }, { name: 'W', email: 'wterm@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId: voided.envelopeId, actor: ACTOR(userId), meta: META });
  const voidToken = linkFor(voided.envelopeId, 'vterm@test.local');
  await voidEnvelope({
    orgId, envelopeId: voided.envelopeId, reason: 'superseded', actor: ACTOR(userId), meta: META,
  });
  assert.equal(resolveSigningToken(voidToken).error, 'voided');

  const refused = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'D', email: 'dterm@test.local' }, { name: 'E', email: 'eterm@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId: refused.envelopeId, actor: ACTOR(userId), meta: META });
  const declineToken = linkFor(refused.envelopeId, 'dterm@test.local');
  await declineEnvelope({
    envelope: getEnvelope(orgId, refused.envelopeId),
    recipient: getRecipients(refused.envelopeId)[0], reason: 'no', meta: META,
  });
  assert.equal(resolveSigningToken(declineToken).error, 'declined');

  const later = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'F', email: 'fterm@test.local' }, { name: 'G', email: 'gterm@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId: later.envelopeId, actor: ACTOR(userId), meta: META });
  const expired = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'H', email: 'hterm@test.local' }, { name: 'I', email: 'iterm@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId: expired.envelopeId, actor: ACTOR(userId), meta: META });
  db.prepare('UPDATE envelopes SET expires_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 86400000).toISOString(), expired.envelopeId);
  assert.equal(resolveSigningToken(linkFor(expired.envelopeId, 'hterm@test.local')).error, 'expired');

  // A garbage token is still a flat "invalid" — no information is disclosed.
  assert.equal(resolveSigningToken('not-a-real-token').error, 'invalid');
});

test('a reminder rotates the token so the previous link stops working', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Reminder Agreement');
  const { envelopeId } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'Slow', email: 'slow@test.local' }, { name: 'Later', email: 'later@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });
  const first = linkFor(envelopeId, 'slow@test.local');

  await remindRecipient({
    orgId, envelopeId, recipientId: getRecipients(envelopeId)[0].id, actor: ACTOR(userId), meta: META,
  });
  const second = linkFor(envelopeId, 'slow@test.local');

  assert.notEqual(first, second);
  assert.equal(resolveSigningToken(first).error, 'invalid');
  assert.equal(resolveSigningToken(second).error, undefined);
  assert.equal(getRecipients(envelopeId)[0].reminder_count, 1);
});

test('reminding someone out of turn is refused', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Turn Agreement');
  const { envelopeId, recipientIds } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'One', email: 'one@test.local' }, { name: 'Two', email: 'two@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });
  await assert.rejects(
    () => remindRecipient({ orgId, envelopeId, recipientId: recipientIds[1], actor: ACTOR(userId), meta: META }),
    /not this recipient's turn/i,
  );
});

test('sending is refused when a signer has no fields', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Unassigned Agreement');
  const { envelopeId, recipientIds } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'Has', email: 'has@test.local' }, { name: 'None', email: 'none@test.local' }],
  });
  db.prepare('DELETE FROM fields WHERE recipient_id = ?').run(recipientIds[1]);
  await assert.rejects(
    () => sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META }),
    /No fields assigned to: None/,
  );
  assert.equal(getEnvelope(orgId, envelopeId).status, 'draft');
});

test('parallel routing invites everyone at once', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Parallel Agreement');
  const { envelopeId } = await makeEnvelope({
    orgId, userId, version, anchors, ordered: false,
    recipients: [{ name: 'P1', email: 'p1@test.local' }, { name: 'P2', email: 'p2@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });
  const statuses = getRecipients(envelopeId).map((r) => r.status);
  assert.deepEqual(statuses, ['sent', 'sent']);
  assert.ok(linkFor(envelopeId, 'p1@test.local'));
  assert.ok(linkFor(envelopeId, 'p2@test.local'));
});

test('declining closes the envelope and notifies the sender', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Declined Agreement');
  const { envelopeId } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'Nope', email: 'nope@test.local' }, { name: 'Never', email: 'never@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });
  const recipient = getRecipients(envelopeId)[0];
  await declineEnvelope({
    envelope: getEnvelope(orgId, envelopeId), recipient, reason: 'Terms unacceptable', meta: META,
  });
  assert.equal(getEnvelope(orgId, envelopeId).status, 'declined');
  const notice = db.prepare("SELECT * FROM email_outbox WHERE envelope_id = ? AND kind = 'declined'").get(envelopeId);
  assert.ok(notice, 'the sender should receive a decline notice');
  assert.equal(verifyChain(envelopeId).valid, true);
});

test('voiding stops every outstanding link from authorising anything', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Voided Agreement');
  const { envelopeId } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'V1', email: 'v1@test.local' }, { name: 'V2', email: 'v2@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });
  const token = linkFor(envelopeId, 'v1@test.local');
  await voidEnvelope({ orgId, envelopeId, reason: 'superseded', actor: ACTOR(userId), meta: META });
  assert.equal(getEnvelope(orgId, envelopeId).status, 'voided');
  assert.equal(resolveSigningToken(token).error, 'voided', 'the link must refuse, and say why');
});

test('completing the last signer produces an executed PDF, certificate and sealed evidence', async () => {
  const { version, anchors } = await makeDocument(orgId, userId, 'Finalised Agreement');
  const { envelopeId, recipientIds } = await makeEnvelope({
    orgId, userId, version, anchors,
    recipients: [{ name: 'Alpha', email: 'alpha@test.local' }, { name: 'Beta', email: 'beta@test.local' }],
  });
  await sendEnvelope({ orgId, envelopeId, actor: ACTOR(userId), meta: META });

  for (const id of recipientIds) {
    fill(id);
    const recipient = db.prepare('SELECT * FROM recipients WHERE id = ?').get(id);
    await completeRecipient({ envelope: getEnvelope(orgId, envelopeId), recipient, meta: META });
  }

  const envelope = getEnvelope(orgId, envelopeId);
  assert.equal(envelope.status, 'completed');
  assert.ok(envelope.completed_at);
  assert.ok(envelope.final_version_id, 'an executed version must be stored');
  assert.ok(envelope.certificate_version_id, 'a certificate must be stored');

  const executed = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.final_version_id);
  const certificate = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.certificate_version_id);
  assert.equal(executed.kind, 'executed');
  assert.equal(certificate.kind, 'certificate');
  assert.equal(getBlob(executed.storage_key).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(getBlob(certificate.storage_key).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(verifyBlob(executed.storage_key, executed.sha256), true);
  assert.notEqual(executed.sha256, version.sha256, 'the executed file must differ from the source');

  assert.equal(verifyChain(envelopeId).valid, true);
  assert.deepEqual(verifyEvidenceSeal(orgId, envelopeId), { sealed: true, valid: true });

  const events = db.prepare('SELECT event_type FROM audit_events WHERE envelope_id = ? ORDER BY seq').all(envelopeId)
    .map((e) => e.event_type);
  assert.deepEqual(events.filter((e) => e === 'recipient.signed').length, 2);
  assert.ok(events.includes('envelope.completed'));
  assert.ok(events.includes('document.executed'));

  // Every party plus the sender receives the completion notice.
  const notices = db.prepare("SELECT to_email FROM email_outbox WHERE envelope_id = ? AND kind = 'completed'").all(envelopeId);
  assert.equal(notices.length, 3);
});

test('signature images are recorded in the audit log by digest, not verbatim', () => {
  const row = db.prepare(
    "SELECT payload FROM audit_events WHERE event_type = 'recipient.signed' ORDER BY seq DESC LIMIT 1"
  ).get();
  const payload = JSON.parse(row.payload);
  assert.match(payload.fields[0].value, /^sha256:[0-9a-f]{64}$/);
});
