import { db, newId, nowIso } from '@/lib/db.js';
import { withAuth, json, fail } from '@/lib/api.js';
import { inspectPdf } from '@/lib/pdf.js';
import { saveVersion } from '@/lib/envelopes.js';

const MAX_BYTES = 25 * 1024 * 1024;

export const GET = withAuth(async ({ orgId }) => {
  const documents = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM document_versions v WHERE v.document_id = d.id) AS version_count,
      (SELECT COUNT(*) FROM envelopes e WHERE e.document_id = d.id) AS envelope_count,
      (SELECT v.id FROM document_versions v WHERE v.document_id = d.id AND v.kind='source' ORDER BY v.version DESC LIMIT 1) AS latest_version_id,
      (SELECT v.page_count FROM document_versions v WHERE v.document_id = d.id AND v.kind='source' ORDER BY v.version DESC LIMIT 1) AS page_count,
      (SELECT v.sha256 FROM document_versions v WHERE v.document_id = d.id AND v.kind='source' ORDER BY v.version DESC LIMIT 1) AS sha256,
      (SELECT v.byte_size FROM document_versions v WHERE v.document_id = d.id AND v.kind='source' ORDER BY v.version DESC LIMIT 1) AS byte_size
    FROM documents d WHERE d.org_id = ? ORDER BY d.created_at DESC`).all(orgId);
  return json({ documents });
});

/** Accepts multipart/form-data with a `file` part (PDF only, <= 25 MB). */
export const POST = withAuth(async ({ request, orgId, actor }) => {
  const form = await request.formData();
  const file = form.get('file');
  const documentId = form.get('documentId'); // present when uploading a new version
  if (!file || typeof file === 'string') return fail('A PDF file is required', 422);
  if (file.size > MAX_BYTES) return fail('File exceeds the 25 MB limit', 413);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return fail('Only PDF files are supported', 415);
  }

  let meta;
  try {
    meta = await inspectPdf(buffer);
  } catch {
    return fail('The PDF could not be parsed. It may be corrupt or password protected.', 422);
  }
  if (meta.pageCount < 1) return fail('The PDF contains no pages', 422);

  let docId = documentId;
  if (docId) {
    const owned = db.prepare('SELECT id FROM documents WHERE id = ? AND org_id = ?').get(docId, orgId);
    if (!owned) return fail('Document not found', 404);
  } else {
    docId = newId('doc');
    db.prepare('INSERT INTO documents (id, org_id, name, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(docId, orgId, (form.get('name') || file.name || 'Untitled document').toString().slice(0, 160), actor.user?.id || null, nowIso());
  }

  const version = saveVersion({
    orgId, documentId: docId, kind: 'source',
    filename: file.name || 'document.pdf', buffer,
    pageCount: meta.pageCount, pageSizes: meta.pageSizes, createdBy: actor.user?.id || null,
  });

  return json({ document: db.prepare('SELECT * FROM documents WHERE id = ?').get(docId), version }, { status: 201 });
}, { minRole: 'member' });
