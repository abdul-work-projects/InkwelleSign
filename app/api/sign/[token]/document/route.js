import { cookies } from 'next/headers';
import { db } from '@/lib/db.js';
import { withPublic, fail, pdfResponse } from '@/lib/api.js';
import { getBlob } from '@/lib/storage.js';
import { resolveSigningToken } from '@/lib/envelopes.js';
import { SIGN_COOKIE, accessProof } from '../route.js';

export const GET = withPublic(async ({ params }) => {
  const resolved = resolveSigningToken(params.token);
  if (resolved.error) return fail('Not available', 410);
  const { envelope, recipient } = resolved;
  if (recipient.access_code_hash) {
    const jar = await cookies();
    if (jar.get(SIGN_COOKIE)?.value !== accessProof(recipient)) return fail('Authentication required', 401);
  }
  const version = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(envelope.source_version_id);
  return pdfResponse(getBlob(version.storage_key), version.filename);
});
