import { z } from 'zod';
import { db, newId, nowIso } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';

const Body = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  documentVersionId: z.string(),
  roles: z.array(z.object({
    key: z.string().min(1).max(40),
    name: z.string().min(1).max(60),
    order: z.number().int().min(1).max(50).default(1),
    color: z.string().max(9).optional(),
  })).min(1).max(20),
  fields: z.array(z.object({
    roleKey: z.string(),
    type: z.string(),
    page: z.number().int().min(1),
    x: z.number(), y: z.number(), w: z.number(), h: z.number(),
    required: z.boolean().default(true),
    label: z.string().max(80).optional().nullable(),
    options: z.array(z.string()).optional().nullable(),
    fontSize: z.number().int().default(11),
  })).default([]),
});

export const GET = withAuth(async ({ orgId }) => {
  const templates = db.prepare(`
    SELECT t.*, dv.page_count, dv.filename,
      (SELECT COUNT(*) FROM envelopes e WHERE e.template_id = t.id) AS usage_count
    FROM templates t JOIN document_versions dv ON dv.id = t.document_version_id
    WHERE t.org_id = ? ORDER BY t.updated_at DESC`).all(orgId);
  return json({
    templates: templates.map((t) => ({
      ...t, roles: JSON.parse(t.roles || '[]'), fields: JSON.parse(t.fields || '[]'),
    })),
  });
});

export const POST = withAuth(async ({ orgId, actor, request }) => {
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);
  const b = parsed.data;
  const version = db.prepare('SELECT id FROM document_versions WHERE id = ? AND org_id = ?').get(b.documentVersionId, orgId);
  if (!version) return fail('Document version not found', 404);
  const id = newId('tpl');
  const at = nowIso();
  db.prepare(`INSERT INTO templates
    (id, org_id, name, description, document_version_id, roles, fields, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, orgId, b.name, b.description || null, b.documentVersionId,
      JSON.stringify(b.roles), JSON.stringify(b.fields), actor.user?.id || null, at, at);
  return json({ template: db.prepare('SELECT * FROM templates WHERE id = ?').get(id) }, { status: 201 });
}, { minRole: 'member' });
