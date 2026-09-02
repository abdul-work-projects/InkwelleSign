import { db } from '@/lib/db.js';
import { json, fail } from '@/lib/api.js';
import { headers } from 'next/headers';
import { getEnvelope, getRecipients, activeRecipients, remindRecipient } from '@/lib/envelopes.js';

/**
 * Scheduled reminder sweep. Protect with CRON_SECRET in production:
 *   curl -H "x-cron-secret: $CRON_SECRET" https://host/api/cron/reminders
 */
export async function POST() {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const h = await headers();
    if (h.get('x-cron-secret') !== secret) return fail('Unauthorized', 401);
  }
  const afterHours = Number(process.env.REMINDER_AFTER_HOURS || 48);
  const maxReminders = Number(process.env.REMINDER_MAX || 3);
  const cutoff = new Date(Date.now() - afterHours * 36e5).toISOString();

  const envelopes = db.prepare(
    "SELECT * FROM envelopes WHERE status IN ('sent','in_progress')"
  ).all();

  let sent = 0;
  for (const envelope of envelopes) {
    if (envelope.expires_at && new Date(envelope.expires_at) < new Date()) {
      db.prepare("UPDATE envelopes SET status = 'expired' WHERE id = ?").run(envelope.id);
      continue;
    }
    const targets = activeRecipients(envelope, getRecipients(envelope.id));
    for (const r of targets) {
      const last = r.last_reminded_at || r.sent_at;
      if (!last || last > cutoff) continue;
      if (r.reminder_count >= maxReminders) continue;
      await remindRecipient({
        orgId: envelope.org_id, envelopeId: envelope.id, recipientId: r.id,
        actor: { kind: 'system', label: 'Automated reminder', user: null },
        meta: { ip: null, userAgent: 'inkwell-scheduler' },
      });
      sent++;
    }
  }
  return json({ reminded: sent, scanned: envelopes.length });
}

export const GET = POST;
