import { db, newId, nowIso } from './db.js';
import { hmacSha256, canonicalJson } from './crypto.js';

/**
 * Fire-and-forget webhook dispatch. Each delivery is logged with its response so
 * integrators can debug from the dashboard. Payloads are signed with HMAC-SHA256
 * over `<timestamp>.<body>` and sent as `X-Inkwell-Signature: t=...,v1=...`.
 */
export function dispatchWebhooks(orgId, event, data) {
  const hooks = db.prepare('SELECT * FROM webhooks WHERE org_id = ? AND active = 1').all(orgId);
  const matching = hooks.filter((h) => {
    const events = JSON.parse(h.events || '["*"]');
    return events.includes('*') || events.includes(event);
  });
  if (!matching.length) return;

  const body = canonicalJson({ id: newId('whk'), event, created_at: nowIso(), data });

  for (const hook of matching) {
    const deliveryId = newId('whd');
    db.prepare(`INSERT INTO webhook_deliveries (id, webhook_id, org_id, event, payload, attempts, created_at)
      VALUES (?,?,?,?,?,?,?)`).run(deliveryId, hook.id, orgId, event, body, 0, nowIso());

    const ts = Math.floor(Date.now() / 1000);
    const signature = hmacSha256(hook.secret, `${ts}.${body}`);

    const attempt = async () => {
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Inkwell-eSign-Webhooks/1.0',
            'x-inkwell-event': event,
            'x-inkwell-signature': `t=${ts},v1=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(8000),
        });
        db.prepare('UPDATE webhook_deliveries SET status_code = ?, attempts = attempts + 1, delivered_at = ? WHERE id = ?')
          .run(res.status, nowIso(), deliveryId);
      } catch (err) {
        db.prepare('UPDATE webhook_deliveries SET error = ?, attempts = attempts + 1 WHERE id = ?')
          .run(String(err?.message || err), deliveryId);
      }
    };
    attempt();
  }
}

export const WEBHOOK_EVENTS = [
  'envelope.sent',
  'envelope.viewed',
  'envelope.recipient_completed',
  'envelope.completed',
  'envelope.declined',
  'envelope.voided',
];
