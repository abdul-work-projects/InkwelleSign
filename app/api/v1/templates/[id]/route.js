import { db, nowIso } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';

export const GET = withAuth(async ({ orgId, params }) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!t) return fail('Template not found', 404);
  const version = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(t.document_version_id);
  return json({
    template: { ...t, roles: JSON.parse(t.roles || '[]'), fields: JSON.parse(t.fields || '[]') },
    version,
  });
});

export const PATCH = withAuth(async ({ orgId, params, request }) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!t) return fail('Template not found', 404);
  const b = await readJson(request);
  db.prepare(`UPDATE templates SET name = COALESCE(?, name), description = COALESCE(?, description),
    roles = COALESCE(?, roles), fields = COALESCE(?, fields), updated_at = ? WHERE id = ?`)
    .run(b.name ?? null, b.description ?? null,
      b.roles ? JSON.stringify(b.roles) : null, b.fields ? JSON.stringify(b.fields) : null,
      nowIso(), params.id);
  return json({ ok: true });
}, { minRole: 'member' });

export const DELETE = withAuth(async ({ orgId, params }) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!t) return fail('Template not found', 404);
  db.prepare('DELETE FROM templates WHERE id = ?').run(params.id);
  return json({ ok: true });
}, { minRole: 'admin' });
