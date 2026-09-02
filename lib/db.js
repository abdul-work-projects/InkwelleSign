import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { SCHEMA } from './schema.js';

/**
 * Demo mode targets hosts with no persistent disk (Vercel and other serverless
 * platforms). The only writable location there is /tmp, which belongs to a single
 * function instance and is discarded when that instance is recycled — so the database
 * is rebuilt from the seed on each cold start and anything a visitor creates lasts only
 * as long as that instance. Adequate for review, never for real documents.
 */
export const DEMO_MODE = process.env.DEMO_MODE === '1'
  || (!!process.env.VERCEL && process.env.DEMO_MODE !== '0');

const DEFAULT_DIR = DEMO_MODE && !process.env.INKWELL_DATA_DIR
  ? path.join(os.tmpdir(), 'inkwell-demo')
  : path.join(process.cwd(), 'storage');

const DATA_DIR = process.env.INKWELL_DATA_DIR || DEFAULT_DIR;
const DB_PATH = process.env.INKWELL_DB_PATH || path.join(DATA_DIR, 'inkwell.db');

/**
 * Raised when the storage location cannot be opened — almost always a host with a
 * read-only or ephemeral filesystem (Vercel, Lambda and similar). Surfaced as a clear
 * message rather than an opaque crash, because the fix is a deployment decision, not
 * a code bug.
 */
export class StorageUnavailableError extends Error {
  constructor(cause) {
    super(
      'Storage is not writable. This build keeps its database and documents on disk, '
      + `so it needs a writable, persistent volume at ${DATA_DIR}. `
      + 'Serverless hosts do not provide one — deploy to a host with a persistent disk, '
      + 'or set INKWELL_DATA_DIR to a mounted volume.',
    );
    this.name = 'StorageUnavailableError';
    this.code = 'STORAGE_UNAVAILABLE';
    this.status = 503;
    this.cause = cause;
  }
}

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'blobs'), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// Reuse a single connection across Next.js hot reloads. Initialisation failure is
// captured rather than thrown at import time: throwing here takes down every route
// that transitively imports this module, which is what produces a bare 500 with no
// explanation on a read-only host.
const g = globalThis;
if (!g.__inkwellDb && !g.__inkwellDbError) {
  try {
    g.__inkwellDb = init();
  } catch (err) {
    g.__inkwellDbError = err;
  }
}

export const storageError = g.__inkwellDbError
  ? new StorageUnavailableError(g.__inkwellDbError)
  : null;

export function assertStorage() {
  if (storageError) throw storageError;
}

/**
 * The database handle. Accessing any method when storage is unavailable throws a
 * StorageUnavailableError explaining the deployment problem.
 * @type {import('better-sqlite3').Database}
 */
export const db = g.__inkwellDb || new Proxy({}, {
  get() { throw new StorageUnavailableError(g.__inkwellDbError); },
});
export const dataDir = DATA_DIR;

export function nowIso() {
  return new Date().toISOString();
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Demo instances have no shared storage, and on Vercel pages and API routes are separate
 * functions with separate temporary directories. Each seeds its own copy of the demo
 * workspace, so those copies must agree on every identifier or a link produced by one
 * function will not resolve in another. During seeding, ids come from a deterministic
 * counter instead of the random generator; afterwards randomness is restored so anything
 * a visitor creates keeps a unique id.
 */
let deterministic = null;

export async function withDeterministicIds(fn) {
  deterministic = new Map();
  try { return await fn(); } finally { deterministic = null; }
}

export function newId(prefix) {
  if (deterministic) {
    const key = prefix || 'id';
    const n = (deterministic.get(key) || 0) + 1;
    deterministic.set(key, n);
    return `${key}_demo${String(n).padStart(6, '0')}`;
  }
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Shared secret for demo-mode signing. Not a security boundary — demo mode has none. */
export const DEMO_SECRET = process.env.DEMO_SECRET || 'inkwell-demo-instance';

export function tx(fn) {
  return db.transaction(fn)();
}
