import { db, newId, nowIso } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { sha256, randomToken } from '@/lib/crypto.js';

export const GET = withAuth(async ({ orgId }) => {
  const keys = db.prepare(
    'SELECT id, name, prefix, scopes, created_at, last_used_at, revoked_at FROM api_keys WHERE org_id = ? ORDER BY created_at DESC'
  ).all(orgId);
  return json({ keys });
}, { minRole: 'admin' });

/** The plaintext key is returned exactly once; only its SHA-256 digest is stored. */
export const POST = withAuth(async ({ orgId, actor, request }) => {
  const { name } = await readJson(request);
  if (!name) return fail('A key name is required', 422);
  const raw = `ink_live_${randomToken(24)}`;
  const id = newId('key');
  db.prepare('INSERT INTO api_keys (id, org_id, name, prefix, key_hash, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, orgId, String(name).slice(0, 80), raw.slice(0, 16), sha256(raw), actor.user?.id || null, nowIso());
  return json({ id, key: raw, prefix: raw.slice(0, 16) }, { status: 201 });
}, { minRole: 'admin' });
