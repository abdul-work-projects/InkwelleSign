/**
 * Role model. Kept free of Next.js imports so it can be reused by scripts and tests.
 *
 *   owner  — full control, including billing-level settings and org ownership
 *   admin  — manages API keys, webhooks and team membership
 *   member — creates, prepares and sends envelopes
 *   viewer — read-only access to envelopes and evidence
 */
export const ROLES = ['owner', 'admin', 'member', 'viewer'];

const RANK = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function roleAtLeast(role, minimum) {
  const have = RANK[role] || 0;
  const need = RANK[minimum];
  if (!need) return false;
  return have >= need;
}
