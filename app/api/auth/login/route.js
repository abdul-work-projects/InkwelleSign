import { cookies } from 'next/headers';
import { authenticatePassword, createSession, SESSION_COOKIE, requestMeta } from '@/lib/auth.js';
import { json, fail, readJson } from '@/lib/api.js';

export async function POST(request) {
  const { email, password } = await readJson(request);
  if (!email || !password) return fail('Email and password are required', 422);
  const user = authenticatePassword(email, password);
  if (!user) return fail('Invalid email or password', 401);
  const meta = await requestMeta();
  const { raw, expires } = createSession(user.id, meta.ip, meta.userAgent);
  (await cookies()).set(SESSION_COOKIE, raw, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', expires,
  });
  return json({ ok: true });
}
