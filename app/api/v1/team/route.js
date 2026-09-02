import { z } from 'zod';
import { db, newId, nowIso } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { hashPassword } from '@/lib/crypto.js';
import { ROLES } from '@/lib/auth.js';

export const GET = withAuth(async ({ orgId }) => {
  const members = db.prepare(
    'SELECT id, name, email, role, status, created_at FROM users WHERE org_id = ? ORDER BY created_at ASC'
  ).all(orgId);
  return json({ members });
});

const Body = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(10).max(200),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
});

export const POST = withAuth(async ({ orgId, request }) => {
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);
  const b = parsed.data;
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(b.email.toLowerCase())) {
    return fail('A user with that email already exists', 409);
  }
  const id = newId('usr');
  db.prepare('INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, orgId, b.email.toLowerCase(), b.name, hashPassword(b.password), b.role, nowIso());
  return json({ member: { id, name: b.name, email: b.email, role: b.role } }, { status: 201 });
}, { minRole: 'admin' });

export const PATCH = withAuth(async ({ orgId, request, actor }) => {
  const { userId, role, status } = await readJson(request);
  const target = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(userId, orgId);
  if (!target) return fail('User not found', 404);
  if (role && !ROLES.includes(role)) return fail('Unknown role', 422);
  if (target.id === actor.user?.id && role && role !== target.role) {
    return fail('You cannot change your own role', 409);
  }
  if (target.role === 'owner' && role && role !== 'owner') {
    const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'owner'").get(orgId);
    if (owners.n <= 1) return fail('An organisation must retain at least one owner', 409);
  }
  db.prepare('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?')
    .run(role || null, status || null, userId);
  return json({ ok: true });
}, { minRole: 'admin' });
