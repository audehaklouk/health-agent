/**
 * Encrypted persistence for health data.
 *
 * Strategy: a SQLite database whose values are encrypted at the application layer
 * with AES-256-GCM, using a key derived from the TEE-injected MNEMONIC.
 *
 * - In production (inside the TEE), MNEMONIC is sealed by EigenCompute KMS and
 *   only available inside the enclave. The DB on disk is opaque to anyone else.
 * - In local dev, we fall back to a fixed dev seed. Not secure — clearly labeled.
 *
 * UPGRADE PATH: swap to SQLCipher or libsql with native encryption when persistence
 * across redeploys becomes important. For v1 demo, this is enough.
 */
import Database from 'better-sqlite3';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import type { ParsedHealth, HealthSummary } from './apple-health';

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = path.join(DATA_DIR, 'health.db');

let _cachedKey: Buffer | null = null;
function deriveKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const seed =
    process.env.MNEMONIC ||
    'dev-mnemonic-NOT-SECURE-DO-NOT-USE-IN-PRODUCTION-' +
      'this-fallback-only-exists-so-the-scaffold-runs-locally';
  _cachedKey = createHash('sha256').update(seed).digest();
  return _cachedKey;
}

function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

let db: Database.Database;

export function initStorage() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS data (
      key   TEXT PRIMARY KEY,
      value BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return { replaceData, getSummary, getRaw };
}

function replaceData(parsed: ParsedHealth) {
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM data').run();
    db.prepare('INSERT INTO data (key, value, updated_at) VALUES (?, ?, ?)').run(
      'summary',
      encrypt(JSON.stringify(parsed.summary)),
      now,
    );
    db.prepare('INSERT INTO data (key, value, updated_at) VALUES (?, ?, ?)').run(
      'raw',
      encrypt(JSON.stringify(parsed.raw)),
      now,
    );
  });
  tx();
}

function getSummary(): HealthSummary | null {
  const row = db
    .prepare('SELECT value FROM data WHERE key = ?')
    .get('summary') as { value: Buffer } | undefined;
  if (!row) return null;
  return JSON.parse(decrypt(row.value)) as HealthSummary;
}

function getRaw(): unknown | null {
  const row = db.prepare('SELECT value FROM data WHERE key = ?').get('raw') as
    | { value: Buffer }
    | undefined;
  if (!row) return null;
  return JSON.parse(decrypt(row.value));
}
