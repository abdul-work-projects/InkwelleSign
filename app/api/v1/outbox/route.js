import { db } from '@/lib/db.js';
import { withAuth, json } from '@/lib/api.js';

export const GET = withAuth(async ({ orgId, request }) => {
  const envelopeId = new URL(request.url).searchParams.get('envelopeId');
  const rows = envelopeId
    ? db.prepare('SELECT * FROM email_outbox WHERE org_id = ? AND envelope_id = ? ORDER BY created_at DESC, rowid DESC').all(orgId, envelopeId)
    : db.prepare('SELECT * FROM email_outbox WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200').all(orgId);
  return json({ messages: rows, smtpConfigured: Boolean(process.env.SMTP_URL) });
});
