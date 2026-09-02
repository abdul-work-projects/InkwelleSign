import { cookies } from 'next/headers';
import { z } from 'zod';
import { registerOrganization, createSession, SESSION_COOKIE } from '@/lib/auth.js';
import { requestMeta } from '@/lib/auth.js';
import { json, fail, readJson } from '@/lib/api.js';

const Body = z.object({
  orgName: z.string().min(2).max(80),
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

export async function POST(request) {
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);
  try {
    const { userId } = registerOrganization(parsed.data);
    const meta = await requestMeta();
    const { raw, expires } = createSession(userId, meta.ip, meta.userAgent);
    (await cookies()).set(SESSION_COOKIE, raw, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/', expires,
    });
    return json({ ok: true });
  } catch (err) {
    return fail(err.message, 409);
  }
}
