import { db } from '@/lib/db.js';
import { withAuth, fail, pdfResponse } from '@/lib/api.js';
import { getBlob } from '@/lib/storage.js';
import { mergePdfs } from '@/lib/pdf.js';
import { getEnvelope, slug } from '@/lib/envelopes.js';

/** ?doc=executed | certificate | combined | source */
export const GET = withAuth(async ({ orgId, params, request }) => {
  const envelope = getEnvelope(orgId, params.id);
  if (!envelope) return fail('Envelope not found', 404);
  const which = new URL(request.url).searchParams.get('doc') || 'combined';

  const pick = (id) => (id ? db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) : null);
  const executed = pick(envelope.final_version_id);
  const certificate = pick(envelope.certificate_version_id);
  const source = pick(envelope.source_version_id);

  if (which === 'source') return pdfResponse(getBlob(source.storage_key), source.filename, { download: true });
  if (!executed) return fail('This envelope has not been completed yet', 409);
  if (which === 'executed') return pdfResponse(getBlob(executed.storage_key), executed.filename, { download: true });
  if (which === 'certificate') {
    if (!certificate) return fail('Certificate not available', 409);
    return pdfResponse(getBlob(certificate.storage_key), certificate.filename, { download: true });
  }
  const merged = await mergePdfs([getBlob(executed.storage_key), getBlob(certificate.storage_key)]);
  return pdfResponse(merged, `${slug(envelope.title)}-signed-packet.pdf`, { download: true });
});
