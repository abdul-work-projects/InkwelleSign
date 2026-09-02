import { cookies } from 'next/headers';
import { withPublic, json, fail, readJson } from '@/lib/api.js';
import { resolveSigningToken, declineEnvelope } from '@/lib/envelopes.js';
import { SIGN_COOKIE, accessProof } from '../route.js';

export const POST = withPublic(async ({ params, request, meta }) => {
  const resolved = resolveSigningToken(params.token);
  if (resolved.error) return fail('This signing session is no longer active', 410);
  const { envelope, recipient } = resolved;
  if (recipient.access_code_hash) {
    const jar = await cookies();
    if (jar.get(SIGN_COOKIE)?.value !== accessProof(recipient)) return fail('Authentication required', 401);
  }
  const { reason } = await readJson(request);
  await declineEnvelope({ envelope, recipient, reason: (reason || '').slice(0, 500), meta });
  return json({ ok: true });
});
