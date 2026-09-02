import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { voidEnvelope, publicEnvelope } from '@/lib/envelopes.js';

export const POST = withAuth(async ({ orgId, params, actor, meta, request }) => {
  const { reason } = await readJson(request);
  try {
    await voidEnvelope({ orgId, envelopeId: params.id, reason, actor, meta });
    return json({ envelope: publicEnvelope(orgId, params.id) });
  } catch (err) {
    return fail(err.message, 409);
  }
}, { minRole: 'member' });
