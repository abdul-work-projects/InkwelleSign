import { withAuth, json, fail } from '@/lib/api.js';
import { getEvents, verifyChain, verifyEvidenceSeal } from '@/lib/audit.js';
import { getEnvelope } from '@/lib/envelopes.js';

export const GET = withAuth(async ({ orgId, params }) => {
  const envelope = getEnvelope(orgId, params.id);
  if (!envelope) return fail('Envelope not found', 404);
  return json({
    events: getEvents(params.id).map((e) => ({ ...e, payload: JSON.parse(e.payload || '{}') })),
    integrity: verifyChain(params.id),
    seal: verifyEvidenceSeal(orgId, params.id),
  });
});
