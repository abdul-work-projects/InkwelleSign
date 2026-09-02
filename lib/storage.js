import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.js';
import { sha256 } from './crypto.js';

/**
 * Content-addressed blob store. Files are written under storage/blobs/<org>/<sha256>.
 * Keying by org id keeps tenant data physically partitioned; keying by digest makes
 * every stored byte self-verifying.
 */
export function putBlob(orgId, buffer) {
  const digest = sha256(buffer);
  const dir = path.join(dataDir, 'blobs', orgId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, digest);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer, { mode: 0o600 });
  return { storageKey: `${orgId}/${digest}`, sha256: digest, byteSize: buffer.length };
}

// Storage keys are always "<orgId>/<sha256>"; anything else is rejected outright
// rather than sanitised, so no traversal sequence can reach the filesystem.
const KEY_PATTERN = /^[A-Za-z0-9_-]+\/[0-9a-f]{64}$/;

export function getBlob(storageKey) {
  const key = String(storageKey);
  if (!KEY_PATTERN.test(key)) throw new Error('invalid storage key');
  const [orgId, digest] = key.split('/');
  return fs.readFileSync(path.join(dataDir, 'blobs', orgId, digest));
}

export function blobExists(storageKey) {
  try { getBlob(storageKey); return true; } catch { return false; }
}

/** Re-hash the stored bytes and compare against the recorded digest. */
export function verifyBlob(storageKey, expectedSha256) {
  try {
    return sha256(getBlob(storageKey)) === expectedSha256;
  } catch {
    return false;
  }
}
