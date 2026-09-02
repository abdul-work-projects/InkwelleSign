import { db } from '@/lib/db.js';
import { withAuth, json } from '@/lib/api.js';

/** Publishes the org's evidence verification key so third parties can validate seals. */
export const GET = withAuth(async ({ orgId }) => {
  const org = db.prepare('SELECT id, name, verify_key, created_at FROM organizations WHERE id = ?').get(orgId);
  return json({
    organization: { id: org.id, name: org.name, created_at: org.created_at },
    algorithm: 'ECDSA P-256 / SHA-256',
    publicKey: org.verify_key,
  });
});
