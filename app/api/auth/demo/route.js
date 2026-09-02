import { cookies } from 'next/headers';
import { createSession, SESSION_COOKIE, requestMeta } from '@/lib/auth.js';
import { demoLogin } from '@/lib/demo.js';
import { json, fail, withRoute } from '@/lib/api.js';

/**
 * Signs in as the seeded demo account without a password. The account is fixed —
 * this endpoint takes no input, so it cannot be used to assume an arbitrary user —
 * and `demoLogin()` refuses unless demo mode is explicitly available.
 */
export const POST = withRoute(async () => {
  const user = demoLogin();
  if (!user) return fail('Demo sign-in is not available on this instance', 404);

  const meta = await requestMeta();
  const { raw, expires } = createSession(user.id, meta.ip, meta.userAgent);
  (await cookies()).set(SESSION_COOKIE, raw, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', expires,
  });
  return json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
});
