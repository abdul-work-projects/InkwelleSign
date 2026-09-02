import { db } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';

export const PATCH = withAuth(async ({ orgId, params, request }) => {
  const hook = db.prepare('SELECT id FROM webhooks WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!hook) return fail('Webhook not found', 404);
  const { active } = await readJson(request);
  db.prepare('UPDATE webhooks SET active = ? WHERE id = ?').run(active ? 1 : 0, params.id);
  return json({ ok: true });
}, { minRole: 'admin' });

export const DELETE = withAuth(async ({ orgId, params }) => {
  const hook = db.prepare('SELECT id FROM webhooks WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!hook) return fail('Webhook not found', 404);
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(params.id);
  return json({ ok: true });
}, { minRole: 'admin' });
