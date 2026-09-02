import { z } from 'zod';
import { db, newId } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { sha256 } from '@/lib/crypto.js';
import { RECIPIENT_COLORS } from '@/lib/envelopes.js';

const Body = z.object({
  ordered: z.boolean().optional(),
  recipients: z.array(z.object({
    id: z.string().optional().nullable(),
    name: z.string().min(1).max(120),
    email: z.string().email().max(160),
    role: z.string().max(60).optional().nullable(),
    kind: z.enum(['signer', 'approver', 'cc']).default('signer'),
    order: z.number().int().min(1).max(50).default(1),
    accessCode: z.string().max(40).optional().nullable(),
  })).min(1).max(30),
});

/** Full replace of the recipient list for a draft envelope. */
export const PUT = withAuth(async ({ orgId, params, request }) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!envelope) return fail('Envelope not found', 404);
  if (envelope.status !== 'draft') return fail('Only draft envelopes can be edited', 409);
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);

  const { recipients, ordered } = parsed.data;
  const existing = db.prepare('SELECT * FROM recipients WHERE envelope_id = ?').all(params.id);
  const keep = new Set(recipients.map((r) => r.id).filter(Boolean));

  db.transaction(() => {
    if (ordered !== undefined) {
      db.prepare('UPDATE envelopes SET ordered = ? WHERE id = ?').run(ordered ? 1 : 0, params.id);
    }
    for (const e of existing) {
      if (!keep.has(e.id)) db.prepare('DELETE FROM recipients WHERE id = ?').run(e.id);
    }
    recipients.forEach((r, i) => {
      const color = RECIPIENT_COLORS[i % RECIPIENT_COLORS.length];
      const orderIndex = (ordered ?? !!envelope.ordered) ? (r.order || i + 1) : 1;
      const accessHash = r.accessCode ? sha256(r.accessCode) : null;
      if (r.id && existing.some((e) => e.id === r.id)) {
        db.prepare(`UPDATE recipients SET name=?, email=?, role_name=?, kind=?, order_index=?, color=?,
          access_code_hash = COALESCE(?, access_code_hash),
          auth_method = CASE WHEN ? IS NOT NULL THEN 'access_code' ELSE auth_method END
          WHERE id = ?`)
          .run(r.name, r.email.toLowerCase(), r.role || null, r.kind, orderIndex, color, accessHash, accessHash, r.id);
      } else {
        db.prepare(`INSERT INTO recipients
          (id, envelope_id, org_id, order_index, name, email, role_name, kind, color, access_code_hash, auth_method)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(newId('rcp'), params.id, orgId, orderIndex, r.name, r.email.toLowerCase(),
            r.role || null, r.kind, color, accessHash, accessHash ? 'access_code' : 'link');
      }
    });
  })();

  return json({ recipients: db.prepare('SELECT * FROM recipients WHERE envelope_id = ? ORDER BY order_index, rowid').all(params.id) });
}, { minRole: 'member' });
