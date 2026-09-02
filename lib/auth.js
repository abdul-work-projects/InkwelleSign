import { cookies, headers } from 'next/headers';
import { db, newId, nowIso } from './db.js';
import { sha256, randomToken, hashPassword, verifyPassword, generateKeyPair } from './crypto.js';
import { roleAtLeast } from './permissions.js';

export const SESSION_COOKIE = 'inkwell_session';
const SESSION_DAYS = 14;

export { ROLES, roleAtLeast } from './permissions.js';

export async function requestMeta() {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return {
    ip: (fwd ? fwd.split(',')[0].trim() : null) || h.get('x-real-ip') || '127.0.0.1',
    userAgent: h.get('user-agent') || 'unknown',
  };
}

export function createSession(userId, ip, userAgent) {
  const raw = randomToken(32);
  const id = sha256(raw);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare(
    'INSERT INTO sessions (id, user_id, ip, user_agent, created_at, expires_at) VALUES (?,?,?,?,?,?)'
  ).run(id, userId, ip, userAgent, nowIso(), expires.toISOString());
  return { raw, expires };
}

export function resolveSession(rawToken) {
  if (!rawToken) return null;
  const row = db.prepare(
    `SELECT s.id AS sid, s.expires_at, u.*, o.name AS org_name, o.slug AS org_slug
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN organizations o ON o.id = u.org_id
     WHERE s.id = ?`
  ).get(sha256(rawToken));
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.sid);
    return null;
  }
  if (row.status !== 'active') return null;
  return {
    sessionId: row.sid,
    id: row.id, orgId: row.org_id, email: row.email, name: row.name,
    role: row.role, orgName: row.org_name, orgSlug: row.org_slug,
  };
}

export async function currentUser() {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

/** API-key authentication for the public REST API. */
export function resolveApiKey(rawKey) {
  if (!rawKey) return null;
  const row = db.prepare(
    `SELECT k.*, o.name AS org_name FROM api_keys k
     JOIN organizations o ON o.id = k.org_id
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`
  ).get(sha256(rawKey));
  if (!row) return null;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return {
    id: row.id, orgId: row.org_id, name: row.name,
    scopes: row.scopes.split(','), orgName: row.org_name,
  };
}

/**
 * Resolves the caller from either a session cookie or an `Authorization: Bearer` API key.
 * Returns a principal carrying the org id every query must be scoped by.
 */
export async function authenticate({ allowApiKey = true } = {}) {
  const user = await currentUser();
  if (user) return { kind: 'user', orgId: user.orgId, user, role: user.role, label: user.name };
  if (!allowApiKey) return null;
  const h = await headers();
  const auth = h.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const key = resolveApiKey(m[1].trim());
    if (key) return { kind: 'api', orgId: key.orgId, apiKey: key, role: 'admin', label: `API key ${key.name}` };
  }
  return null;
}

export function registerOrganization({ orgName, name, email, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) throw new Error('An account with that email already exists');
  const orgId = newId('org');
  const userId = newId('usr');
  const keys = generateKeyPair();
  const slugBase = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
  let slug = slugBase, n = 1;
  while (db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug)) slug = `${slugBase}-${++n}`;
  db.prepare(
    'INSERT INTO organizations (id, name, slug, signing_key, verify_key, created_at) VALUES (?,?,?,?,?,?)'
  ).run(orgId, orgName, slug, keys.privateKey, keys.publicKey, nowIso());
  db.prepare(
    'INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(userId, orgId, email.toLowerCase(), name, hashPassword(password), 'owner', nowIso());
  return { orgId, userId };
}

export function authenticatePassword(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user) {
    // Equalise timing between "no such user" and "wrong password".
    verifyPassword(password, hashPassword('placeholder'));
    return null;
  }
  if (!verifyPassword(password, user.password_hash)) return null;
  if (user.status !== 'active') return null;
  return user;
}
