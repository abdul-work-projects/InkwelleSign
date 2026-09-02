import { db } from '@/lib/db.js';
import { withAuth, fail, pdfResponse } from '@/lib/api.js';
import { getBlob } from '@/lib/storage.js';

export const GET = withAuth(async ({ orgId, params, request }) => {
  const version = db.prepare('SELECT * FROM document_versions WHERE id = ? AND org_id = ?').get(params.id, orgId);
  if (!version) return fail('Version not found', 404);
  const download = new URL(request.url).searchParams.get('download') === '1';
  return pdfResponse(getBlob(version.storage_key), version.filename, { download });
});
