import { z } from 'zod';
import { db } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { getEnvelopeBundle, activeRecipients } from '@/lib/envelopes.js';
import { verifyChain } from '@/lib/audit.js';

export const GET = withAuth(async ({ orgId, params }) => {
  const bundle = getEnvelopeBundle(orgId, params.id);
  if (!bundle) return fail('Envelope not found', 404);
  return json({
    ...bundle,
    activeRecipientIds: activeRecipients(bundle.envelope, bundle.recipients).map((r) => r.id),
    integrity: verifyChain(params.id),
  });
});

const Patch = z.object({
  title: z.string().min(1).max(160).optional(),
  message: z.string().max(2000).nullable().optional(),
  ordered: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

export const PATCH = withAuth(async ({ orgId, params, request }) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!envelope) return fail('Envelope not found', 404);
  if (envelope.status !== 'draft') return fail('Only draft envelopes can be edited', 409);
  const parsed = Patch.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);
  const p = parsed.data;
  db.prepare(`UPDATE envelopes SET
      title = COALESCE(?, title),
      message = CASE WHEN ? THEN ? ELSE message END,
      ordered = COALESCE(?, ordered),
      expires_at = CASE WHEN ? THEN ? ELSE expires_at END
    WHERE id = ?`)
    .run(p.title ?? null,
      'message' in p ? 1 : 0, p.message ?? null,
      p.ordered === undefined ? null : (p.ordered ? 1 : 0),
      'expiresAt' in p ? 1 : 0, p.expiresAt ?? null,
      params.id);
  return json({ envelope: db.prepare('SELECT * FROM envelopes WHERE id = ?').get(params.id) });
}, { minRole: 'member' });

export const DELETE = withAuth(async ({ orgId, params }) => {
  const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!envelope) return fail('Envelope not found', 404);
  if (envelope.status !== 'draft') return fail('Only draft envelopes can be deleted. Void the envelope instead.', 409);
  db.prepare('DELETE FROM envelopes WHERE id = ?').run(params.id);
  return json({ ok: true });
}, { minRole: 'member' });
