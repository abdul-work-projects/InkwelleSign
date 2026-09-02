import { cookies } from 'next/headers';
import { z } from 'zod';
import { db, nowIso } from '@/lib/db.js';
import { withPublic, json, fail, readJson } from '@/lib/api.js';
import { resolveSigningToken } from '@/lib/envelopes.js';
import { SIGN_COOKIE, accessProof } from '../route.js';

const MAX_IMAGE_CHARS = 900_000; // ~650 KB decoded

const Body = z.object({
  values: z.array(z.object({
    fieldId: z.string(),
    value: z.string().max(MAX_IMAGE_CHARS).nullable(),
    method: z.enum(['typed', 'drawn', 'uploaded', 'input']).optional(),
  })).max(500),
});

/** Incremental save of the current signer's field values. */
export const PUT = withPublic(async ({ params, request }) => {
  const resolved = resolveSigningToken(params.token);
  if (resolved.error) return fail('This signing session is no longer active', 410);
  const { recipient } = resolved;
  if (recipient.access_code_hash) {
    const jar = await cookies();
    if (jar.get(SIGN_COOKIE)?.value !== accessProof(recipient)) return fail('Authentication required', 401);
  }

  const parsed = Body.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);

  const owned = new Map(
    db.prepare('SELECT id, type FROM fields WHERE recipient_id = ?').all(recipient.id).map((f) => [f.id, f])
  );

  const stmt = db.prepare('UPDATE fields SET value = ?, value_meta = ?, filled_at = ? WHERE id = ? AND recipient_id = ?');
  const at = nowIso();
  db.transaction(() => {
    for (const v of parsed.data.values) {
      const field = owned.get(v.fieldId);
      if (!field) continue; // silently ignore fields that are not this signer's
      if ((field.type === 'signature' || field.type === 'initials') && v.value) {
        if (!/^data:image\/(png|jpeg);base64,/.test(v.value)) continue;
      }
      stmt.run(v.value, JSON.stringify({ method: v.method || 'input' }), v.value ? at : null, v.fieldId, recipient.id);
    }
  })();

  return json({ saved: parsed.data.values.length });
});
