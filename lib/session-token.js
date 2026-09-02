import { hmacSha256, timingSafeEqualStr } from './crypto.js';

/**
 * Stateless session tokens for demo instances.
 *
 * A demo instance has no shared storage — on Vercel the page and API routes are separate
 * functions, each with its own temporary directory — so a session row written by one is
 * invisible to the other. The session is therefore carried entirely in the cookie and
 * verified by signature, with no database lookup.
 *
 * This is deliberately limited to demo mode. It cannot be revoked server-side, which is
 * why real deployments keep sessions in the database instead.
 */
export function issueStatelessSession(secret, userId, expiresAt) {
  const payload = Buffer.from(`${userId}|${expiresAt}`).toString('base64url');
  return `d.${payload}.${hmacSha256(secret, payload)}`;
}

/** Returns the user id, or null when the token is absent, altered, forged or expired. */
export function readStatelessSession(secret, raw, now = Date.now()) {
  if (!raw) return null;
  const parts = String(raw).split('.');
  if (parts.length !== 3 || parts[0] !== 'd') return null;
  const [, payload, signature] = parts;
  if (!timingSafeEqualStr(hmacSha256(secret, payload), signature)) return null;
  const decoded = Buffer.from(payload, 'base64url').toString();
  const separator = decoded.lastIndexOf('|');
  if (separator < 1) return null;
  const userId = decoded.slice(0, separator);
  const expiresAt = Number(decoded.slice(separator + 1));
  if (!userId || !Number.isFinite(expiresAt) || expiresAt < now) return null;
  return userId;
}
