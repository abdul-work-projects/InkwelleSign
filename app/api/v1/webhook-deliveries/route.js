import { db } from '@/lib/db.js';
import { withAuth, json } from '@/lib/api.js';

export const GET = withAuth(async ({ orgId }) => {
  const deliveries = db.prepare(
    `SELECT d.*, w.url FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
     WHERE d.org_id = ? ORDER BY d.created_at DESC LIMIT 100`
  ).all(orgId);
  return json({ deliveries });
}, { minRole: 'admin' });
