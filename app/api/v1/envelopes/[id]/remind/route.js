import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { remindRecipient, getRecipients, getEnvelope, activeRecipients } from '@/lib/envelopes.js';

export const POST = withAuth(async ({ orgId, params, actor, meta, request }) => {
  const { recipientId } = await readJson(request);
  try {
    if (recipientId) {
      await remindRecipient({ orgId, envelopeId: params.id, recipientId, actor, meta });
      return json({ reminded: 1 });
    }
    // No recipient specified: remind everyone whose turn it currently is.
    const envelope = getEnvelope(orgId, params.id);
    if (!envelope) return fail('Envelope not found', 404);
    const targets = activeRecipients(envelope, getRecipients(params.id));
    for (const r of targets) {
      await remindRecipient({ orgId, envelopeId: params.id, recipientId: r.id, actor, meta });
    }
    return json({ reminded: targets.length });
  } catch (err) {
    return fail(err.message, 409);
  }
}, { minRole: 'member' });
