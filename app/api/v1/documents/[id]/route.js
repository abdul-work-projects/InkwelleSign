import { db } from '@/lib/db.js';
import { withAuth, json, fail } from '@/lib/api.js';

export const GET = withAuth(async ({ orgId, params }) => {
  const document = db.prepare('SELECT * FROM documents WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!document) return fail('Document not found', 404);
  const versions = db.prepare(
    'SELECT * FROM document_versions WHERE document_id = ? ORDER BY version DESC'
  ).all(params.id);
  const envelopes = db.prepare(
    'SELECT id, title, status, created_at FROM envelopes WHERE document_id = ? ORDER BY created_at DESC'
  ).all(params.id);
  return json({ document, versions, envelopes });
});

export const DELETE = withAuth(async ({ orgId, params }) => {
  const document = db.prepare('SELECT * FROM documents WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!document) return fail('Document not found', 404);
  const active = db.prepare(
    "SELECT COUNT(*) AS n FROM envelopes WHERE document_id = ? AND status NOT IN ('draft','voided')"
  ).get(params.id);
  if (active.n > 0) return fail('This document is referenced by sent envelopes and cannot be deleted', 409);
  db.prepare('DELETE FROM documents WHERE id = ?').run(params.id);
  return json({ ok: true });
}, { minRole: 'admin' });
