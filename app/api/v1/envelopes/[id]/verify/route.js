import { db } from '@/lib/db.js';
import { withAuth, json, fail } from '@/lib/api.js';
import { verifyChain, verifyEvidenceSeal } from '@/lib/audit.js';
import { verifyBlob } from '@/lib/storage.js';
import { getEnvelope } from '@/lib/envelopes.js';

/**
 * End-to-end tamper check: verifies the audit hash chain, the evidence signature
 * and that every stored PDF still hashes to its recorded digest.
 */
export const GET = withAuth(async ({ orgId, params }) => {
  const envelope = getEnvelope(orgId, params.id);
  if (!envelope) return fail('Envelope not found', 404);

  const chain = verifyChain(params.id);
  const seal = verifyEvidenceSeal(orgId, params.id);

  const versionIds = [envelope.source_version_id, envelope.final_version_id, envelope.certificate_version_id].filter(Boolean);
  const documents = versionIds.map((id) => {
    const v = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id);
    return {
      id: v.id, kind: v.kind, filename: v.filename, sha256: v.sha256,
      bytes: v.byte_size, intact: verifyBlob(v.storage_key, v.sha256),
    };
  });

  const allIntact = documents.every((d) => d.intact);
  return json({
    envelopeId: envelope.id,
    verifiedAt: new Date().toISOString(),
    auditChain: chain,
    evidenceSeal: seal,
    documents,
    verdict: chain.valid && allIntact && (!seal.sealed || seal.valid) ? 'intact' : 'tampered',
  });
});
