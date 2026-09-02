import { cookies } from 'next/headers';
import { db } from '@/lib/db.js';
import { withPublic, json, fail, readJson } from '@/lib/api.js';
import { sha256, timingSafeEqualStr } from '@/lib/crypto.js';
import { recordEvent } from '@/lib/audit.js';
import { resolveSigningToken } from '@/lib/envelopes.js';
import { SIGN_COOKIE, accessProof } from '../route.js';

/** Simple in-memory throttle: five attempts per recipient per 10 minutes. */
const attempts = globalThis.__inkAccessAttempts || (globalThis.__inkAccessAttempts = new Map());

export const POST = withPublic(async ({ params, request, meta }) => {
  const resolved = resolveSigningToken(params.token);
  if (resolved.error) return fail('This signing link is not valid', 410);
  const { recipient, envelope } = resolved;
  if (!recipient.access_code_hash) return json({ ok: true });

  const now = Date.now();
  const record = attempts.get(recipient.id) || { count: 0, windowStart: now };
  if (now - record.windowStart > 6e5) { record.count = 0; record.windowStart = now; }
  if (record.count >= 5) {
    // Record the lockout itself so a brute-force attempt is visible in the evidence.
    recordEvent({
      orgId: envelope.org_id, envelopeId: envelope.id, eventType: 'recipient.authentication_throttled',
      actorType: 'recipient', actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
      ip: meta.ip, userAgent: meta.userAgent, payload: { method: 'access_code', attempts: record.count },
    });
    return fail('Too many incorrect attempts. Try again in a few minutes.', 429);
  }

  const { accessCode } = await readJson(request);
  const ok = timingSafeEqualStr(sha256(String(accessCode || '')), recipient.access_code_hash);

  record.count = ok ? 0 : record.count + 1;
  attempts.set(recipient.id, record);

  recordEvent({
    orgId: envelope.org_id, envelopeId: envelope.id,
    eventType: ok ? 'recipient.authenticated' : 'recipient.authentication_failed',
    actorType: 'recipient', actorId: recipient.id, actorLabel: `${recipient.name} <${recipient.email}>`,
    ip: meta.ip, userAgent: meta.userAgent, payload: { method: 'access_code' },
  });

  if (!ok) return fail('That access code is incorrect', 401);

  (await cookies()).set(SIGN_COOKIE, accessProof(recipient), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: 60 * 60 * 6,
  });
  return json({ ok: true });
});
