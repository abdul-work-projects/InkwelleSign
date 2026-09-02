import { db, nowIso } from '@/lib/db.js';
import { withAuth, json, fail } from '@/lib/api.js';

export const DELETE = withAuth(async ({ orgId, params }) => {
  const key = db.prepare('SELECT id FROM api_keys WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!key) return fail('Key not found', 404);
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(nowIso(), params.id);
  return json({ ok: true });
}, { minRole: 'admin' });
