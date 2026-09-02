import { cookies } from 'next/headers';
import { db, nowIso } from '@/lib/db.js';
import { withPublic, json, fail, readJson } from '@/lib/api.js';
import { recordEvent } from '@/lib/audit.js';
import { resolveSigningToken, completeRecipient } from '@/lib/envelopes.js';
import { SIGN_COOKIE, accessProof } from '../route.js';

export const POST = withPublic(async ({ params, request, meta }) => {
  const resolved = resolveSigningToken(params.token);
  if (resolved.error) return fail('This signing session is no longer active', 410);
  const { envelope, recipient } = resolved;
  if (recipient.access_code_hash) {
    const jar = await cookies();
    if (jar.get(SIGN_COOKIE)?.value !== accessProof(recipient)) return fail('Authentication required', 401);
  }

  const { consent } = await readJson(request);
  if (!consent) return fail('You must agree to sign electronically before completing', 422);

  const fields = db.prepare('SELECT * FROM fields WHERE recipient_id = ?').all(recipient.id);
  const missing = fields.filter((f) => f.required && (f.value === null || f.value === '' ||
    (f.type === 'checkbox' && f.value !== 'true')));
  if (missing.length) {
    return fail(`${missing.length} required field${missing.length > 1 ? 's are' : ' is'} still empty`, 422, {
      missingFieldIds: missing.map((f) => f.id),
    });
  }

  if (!recipient.consent_at) {
    db.prepare('UPDATE recipients SET consent_at = ? WHERE id = ?').run(nowIso(), recipient.id);
    recordEvent({
      orgId: envelope.org_id, envelopeId: envelope.id, eventType: 'recipient.consented',
      actorType: 'recipient', actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
      ip: meta.ip, userAgent: meta.userAgent,
      payload: { disclosure: 'Electronic Record and Signature Disclosure accepted' },
    });
  }

  const result = await completeRecipient({ envelope, recipient, meta });
  return json({ ok: true, ...result });
});
