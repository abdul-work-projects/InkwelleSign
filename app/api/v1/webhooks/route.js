import { z } from 'zod';
import { db, newId, nowIso } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { randomToken } from '@/lib/crypto.js';
import { WEBHOOK_EVENTS } from '@/lib/webhooks.js';

export const GET = withAuth(async ({ orgId }) => {
  const webhooks = db.prepare('SELECT * FROM webhooks WHERE org_id = ? ORDER BY created_at DESC').all(orgId);
  return json({
    webhooks: webhooks.map((w) => ({ ...w, events: JSON.parse(w.events) })),
    availableEvents: WEBHOOK_EVENTS,
  });
}, { minRole: 'admin' });

const Body = z.object({
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'URL must be http(s)'),
  events: z.array(z.string()).min(1).default(['*']),
});

export const POST = withAuth(async ({ orgId, request }) => {
  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);
  const id = newId('wh');
  const secret = `whsec_${randomToken(24)}`;
  db.prepare('INSERT INTO webhooks (id, org_id, url, secret, events, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, orgId, parsed.data.url, secret, JSON.stringify(parsed.data.events), nowIso());
  return json({ webhook: { id, url: parsed.data.url, secret, events: parsed.data.events } }, { status: 201 });
}, { minRole: 'admin' });
