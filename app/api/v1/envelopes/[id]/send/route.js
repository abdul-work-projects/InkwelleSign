import { withAuth, json, fail } from '@/lib/api.js';
import { sendEnvelope, publicEnvelope } from '@/lib/envelopes.js';

export const POST = withAuth(async ({ orgId, params, actor, meta }) => {
  try {
    const result = await sendEnvelope({ orgId, envelopeId: params.id, actor, meta });
    return json({ ...result, envelope: publicEnvelope(orgId, params.id) });
  } catch (err) {
    return fail(err.message, 409);
  }
}, { minRole: 'member' });
