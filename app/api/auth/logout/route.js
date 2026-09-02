import { cookies } from 'next/headers';
import { db } from '@/lib/db.js';
import { sha256 } from '@/lib/crypto.js';
import { SESSION_COOKIE } from '@/lib/auth.js';
import { json } from '@/lib/api.js';

export async function POST() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(raw));
  jar.delete(SESSION_COOKIE);
  return json({ ok: true });
}
