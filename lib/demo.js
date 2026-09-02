import { db, DEMO_MODE } from './db.js';

/**
 * The seeded demo account. `npm run seed` creates it; nothing else references it.
 */
export const DEMO_EMAIL = 'owner@northwind.test';

/**
 * Demo sign-in bypasses the password, so it is off unless deliberately enabled:
 *
 *   DEMO_LOGIN unset   → available outside production only
 *   DEMO_LOGIN=on      → available (use only for a hosted evaluation instance)
 *   DEMO_LOGIN=off     → never available
 *
 * It is also unavailable whenever the seeded account does not exist, so a real
 * deployment that never ran `npm run seed` can never expose it.
 */
export function demoLogin() {
  const flag = (process.env.DEMO_LOGIN || '').toLowerCase();
  if (flag === 'off') return null;
  // A demo instance keeps no persistent accounts, so the seeded login is the only way in.
  if (flag !== 'on' && !DEMO_MODE && process.env.NODE_ENV === 'production') return null;

  const user = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, o.name AS org_name
     FROM users u JOIN organizations o ON o.id = u.org_id
     WHERE u.email = ? AND u.status = 'active'`
  ).get(DEMO_EMAIL);
  if (!user) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role, orgName: user.org_name };
}
