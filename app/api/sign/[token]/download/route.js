import { cookies } from 'next/headers';
import { db } from '@/lib/db.js';
import { withPublic, fail, pdfResponse } from '@/lib/api.js';
import { getBlob } from '@/lib/storage.js';
import { mergePdfs } from '@/lib/pdf.js';
import { resolveSigningToken, slug } from '@/lib/envelopes.js';
import { SIGN_COOKIE, accessProof } from '../route.js';

/**
 * Lets a recipient download the document they signed.
 *
 * `resolveSigningToken` reports `completed` for a signer who has finished, and still
 * returns their envelope — which is why the token is kept rather than destroyed. A party
 * to an executed document is entitled to a copy, and on an instance where mail is
 * captured rather than delivered this is their only route to one.
 *
 * ?doc=combined (default) | executed | certificate
 */
export const GET = withPublic(async ({ params, request }) => {
  const resolved = resolveSigningToken(params.token);
  const { envelope, recipient } = resolved;
  if (!envelope || !recipient) return fail('This link is not valid', 404);

  if (envelope.status !== 'completed') {
    return fail('This document is not finished yet. You will receive a copy once every party has signed.', 409);
  }
  if (recipient.status !== 'completed') {
    return fail('Only a party who has signed this document can download it', 403);
  }
  if (recipient.access_code_hash) {
    const jar = await cookies();
    if (jar.get(SIGN_COOKIE)?.value !== accessProof(recipient)) return fail('Authentication required', 401);
  }

  const version = (id) => (id ? db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) : null);
  const executed = version(envelope.final_version_id);
  const certificate = version(envelope.certificate_version_id);
  if (!executed) return fail('The signed document is not available yet', 409);

  const which = new URL(request.url).searchParams.get('doc') || 'combined';
  if (which === 'executed') return pdfResponse(getBlob(executed.storage_key), executed.filename, { download: true });
  if (which === 'certificate') {
    if (!certificate) return fail('Certificate not available', 409);
    return pdfResponse(getBlob(certificate.storage_key), certificate.filename, { download: true });
  }

  const merged = await mergePdfs([getBlob(executed.storage_key), getBlob(certificate.storage_key)]);
  return pdfResponse(merged, `${slug(envelope.title)}-signed.pdf`, { download: true });
});
