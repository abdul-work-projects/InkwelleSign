import { db } from '@/lib/db.js';
import { withAuth, json } from '@/lib/api.js';

export const GET = withAuth(async ({ orgId }) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'draft') AS draft,
      SUM(status IN ('sent','in_progress')) AS pending,
      SUM(status = 'completed') AS completed,
      SUM(status = 'declined') AS declined,
      SUM(status = 'voided') AS voided
    FROM envelopes WHERE org_id = ?`).get(orgId);

  const documents = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE org_id = ?').get(orgId);
  const templates = db.prepare('SELECT COUNT(*) AS n FROM templates WHERE org_id = ?').get(orgId);
  const awaiting = db.prepare(`
    SELECT r.name, r.email, r.status, e.id AS envelope_id, e.title, e.sent_at
    FROM recipients r JOIN envelopes e ON e.id = r.envelope_id
    WHERE e.org_id = ? AND e.status IN ('sent','in_progress') AND r.status IN ('sent','viewed')
    ORDER BY e.sent_at ASC LIMIT 8`).all(orgId);

  const recent = db.prepare(`
    SELECT a.event_type, a.created_at, a.actor_label, a.envelope_id, e.title
    FROM audit_events a JOIN envelopes e ON e.id = a.envelope_id
    WHERE a.org_id = ? ORDER BY a.created_at DESC LIMIT 12`).all(orgId);

  const completionTimes = db.prepare(`
    SELECT sent_at, completed_at FROM envelopes
    WHERE org_id = ? AND status = 'completed' AND sent_at IS NOT NULL`).all(orgId);
  const avgHours = completionTimes.length
    ? completionTimes.reduce((s, r) => s + (new Date(r.completed_at) - new Date(r.sent_at)), 0) / completionTimes.length / 36e5
    : null;

  return json({
    counts: {
      total: counts.total || 0, draft: counts.draft || 0, pending: counts.pending || 0,
      completed: counts.completed || 0, declined: counts.declined || 0, voided: counts.voided || 0,
    },
    documents: documents.n, templates: templates.n, awaiting, recent,
    avgCompletionHours: avgHours === null ? null : Math.round(avgHours * 10) / 10,
  });
});
