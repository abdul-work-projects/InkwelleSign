import { db, newId, nowIso } from './db.js';
import { sha256, canonicalJson, signPayload, verifySignature } from './crypto.js';

/**
 * Append-only, hash-chained audit log.
 *
 * Every event stores the hash of the previous event. Recomputing the chain detects
 * any insertion, deletion, reordering or mutation of historical events, because a
 * change at position N invalidates every hash from N onward.
 */
export function chainHash({ prevHash, seq, envelopeId, eventType, actorType, actorId, actorLabel, ip, userAgent, payload, createdAt }) {
  const material = [
    prevHash,
    String(seq),
    envelopeId,
    eventType,
    actorType,
    actorId || '',
    actorLabel || '',
    ip || '',
    userAgent || '',
    canonicalJson(payload || {}),
    createdAt,
  ].join('\n');
  return sha256(material);
}

export const GENESIS = '0'.repeat(64);

export function recordEvent(opts) {
  const {
    orgId, envelopeId, eventType,
    actorType = 'system', actorId = null, actorLabel = null,
    ip = null, userAgent = null, payload = {},
  } = opts;

  const last = db.prepare(
    'SELECT seq, hash FROM audit_events WHERE envelope_id = ? ORDER BY seq DESC LIMIT 1'
  ).get(envelopeId);

  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.hash : GENESIS;
  const createdAt = nowIso();

  const hash = chainHash({
    prevHash, seq, envelopeId, eventType, actorType, actorId, actorLabel, ip, userAgent, payload, createdAt,
  });

  db.prepare(`INSERT INTO audit_events
    (id, org_id, envelope_id, seq, event_type, actor_type, actor_id, actor_label, ip, user_agent, payload, prev_hash, hash, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    newId('evt'), orgId, envelopeId, seq, eventType, actorType, actorId, actorLabel,
    ip, userAgent, canonicalJson(payload || {}), prevHash, hash, createdAt
  );

  db.prepare('UPDATE envelopes SET audit_head_hash = ? WHERE id = ?').run(hash, envelopeId);
  return { seq, hash, prevHash, createdAt };
}

export function getEvents(envelopeId) {
  return db.prepare('SELECT * FROM audit_events WHERE envelope_id = ? ORDER BY seq ASC').all(envelopeId);
}

/** Walk the chain and report the first position that fails verification. */
export function verifyChain(envelopeId) {
  const events = getEvents(envelopeId);
  let prevHash = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) {
      return { valid: false, brokenAt: e.seq, reason: 'sequence gap', events: events.length };
    }
    if (e.prev_hash !== prevHash) {
      return { valid: false, brokenAt: e.seq, reason: 'previous-hash mismatch', events: events.length };
    }
    const recomputed = chainHash({
      prevHash: e.prev_hash, seq: e.seq, envelopeId: e.envelope_id, eventType: e.event_type,
      actorType: e.actor_type, actorId: e.actor_id, actorLabel: e.actor_label,
      ip: e.ip, userAgent: e.user_agent, payload: JSON.parse(e.payload || '{}'), createdAt: e.created_at,
    });
    if (recomputed !== e.hash) {
      return { valid: false, brokenAt: e.seq, reason: 'event hash mismatch', events: events.length };
    }
    prevHash = e.hash;
  }
  return { valid: true, head: prevHash, events: events.length };
}

/**
 * Seals the envelope: signs {envelopeId, headHash, documentHash} with the
 * organisation's private key so the evidence record cannot be re-created by
 * anyone without the key, even with full database access.
 */
export function sealEvidence(orgId, envelopeId, documentSha256) {
  const org = db.prepare('SELECT signing_key FROM organizations WHERE id = ?').get(orgId);
  const env = db.prepare('SELECT audit_head_hash FROM envelopes WHERE id = ?').get(envelopeId);
  if (!org?.signing_key || !env) return null;
  const payload = canonicalJson({ envelopeId, headHash: env.audit_head_hash, documentSha256 });
  const signature = signPayload(org.signing_key, payload);
  db.prepare('UPDATE envelopes SET evidence_signature = ? WHERE id = ?').run(signature, envelopeId);
  return signature;
}

export function verifyEvidenceSeal(orgId, envelopeId) {
  const org = db.prepare('SELECT verify_key FROM organizations WHERE id = ?').get(orgId);
  const env = db.prepare(
    `SELECT e.audit_head_hash, e.evidence_signature, dv.sha256 AS doc_hash
     FROM envelopes e LEFT JOIN document_versions dv ON dv.id = e.final_version_id
     WHERE e.id = ?`
  ).get(envelopeId);
  if (!org?.verify_key || !env?.evidence_signature) return { sealed: false };
  const payload = canonicalJson({
    envelopeId, headHash: env.audit_head_hash, documentSha256: env.doc_hash,
  });
  return { sealed: true, valid: verifySignature(org.verify_key, payload, env.evidence_signature) };
}
