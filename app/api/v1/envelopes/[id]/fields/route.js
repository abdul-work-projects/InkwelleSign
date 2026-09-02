import { z } from 'zod';
import { db, newId } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';

const Field = z.object({
  id: z.string().optional().nullable(),
  recipientId: z.string(),
  type: z.enum(['signature', 'initials', 'date', 'text', 'checkbox', 'dropdown', 'email', 'fullname']),
  page: z.number().int().min(1),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(0.005).max(1), h: z.number().min(0.004).max(1),
  required: z.boolean().default(true),
  label: z.string().max(80).optional().nullable(),
  options: z.array(z.string().max(80)).optional().nullable(),
  fontSize: z.number().int().min(6).max(48).default(11),
});

/** Full replace of the field layout for a draft envelope. */
export const PUT = withAuth(async ({ orgId, params, request }) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!envelope) return fail('Envelope not found', 404);
  if (envelope.status !== 'draft') return fail('Only draft envelopes can be edited', 409);
  const parsed = z.object({ fields: z.array(Field).max(500) }).safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);

  const recipientIds = new Set(
    db.prepare('SELECT id FROM recipients WHERE envelope_id = ?').all(params.id).map((r) => r.id)
  );
  for (const f of parsed.data.fields) {
    if (!recipientIds.has(f.recipientId)) return fail('Field references an unknown recipient', 422);
  }

  db.transaction(() => {
    db.prepare('DELETE FROM fields WHERE envelope_id = ?').run(params.id);
    const stmt = db.prepare(`INSERT INTO fields
      (id, envelope_id, recipient_id, type, page, x, y, w, h, required, label, options, font_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of parsed.data.fields) {
      stmt.run(f.id || newId('fld'), params.id, f.recipientId, f.type, f.page, f.x, f.y, f.w, f.h,
        f.required ? 1 : 0, f.label || null, f.options ? JSON.stringify(f.options) : null, f.fontSize);
    }
  })();

  return json({ fields: db.prepare('SELECT * FROM fields WHERE envelope_id = ?').all(params.id) });
}, { minRole: 'member' });
