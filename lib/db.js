import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SCHEMA } from './schema.js';

const DATA_DIR = process.env.INKWELL_DATA_DIR || path.join(process.cwd(), 'storage');
const DB_PATH = process.env.INKWELL_DB_PATH || path.join(DATA_DIR, 'inkwell.db');

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'blobs'), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// Reuse a single connection across Next.js hot reloads.
const g = globalThis;
if (!g.__inkwellDb) g.__inkwellDb = init();

/** @type {import('better-sqlite3').Database} */
export const db = g.__inkwellDb;
export const dataDir = DATA_DIR;

export function nowIso() {
  return new Date().toISOString();
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export function newId(prefix) {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

export function tx(fn) {
  return db.transaction(fn)();
}
