// @ts-check
/**
 * Test doubles for the Worker's bindings.
 *
 * D1 is SQLite, so `node:sqlite` is not an approximation of it — it is
 * the same engine running the same SQL. That lets the Worker be tested
 * end to end with no wrangler, no emulator and no Cloudflare account,
 * which matters because this machine has none of them.
 */

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

/** Every migration in order — the schema is no longer one file. */
export const applySchema = (db, dir = 'schema') => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`${dir}/${f}`, 'utf8'));
  }
};

/** @param {any} db @param {string} sql @param {any[]} args */
const rows = (db, sql, args) => db.prepare(sql).all(...args);

/** Minimal D1Database over node:sqlite. */
export function makeD1(schemaDir = 'schema') {
  const db = new DatabaseSync(':memory:');
  applySchema(db, schemaDir);

  /** @param {string} sql @param {any[]} args */
  const statement = (sql, args = []) => ({
    /** @param {any[]} next */
    bind: (...next) => statement(sql, next),
    first: async (/** @type {string=} */ col) => {
      const r = rows(db, sql, args)[0] ?? null;
      return r && col ? r[col] : r;
    },
    all: async () => ({ results: rows(db, sql, args), success: true }),
    run: async () => {
      const info = db.prepare(sql).run(...args);
      return { success: true, meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } };
    },
    __exec: () => db.prepare(sql).run(...args),
  });

  return {
    raw: db,
    prepare: (/** @type {string} */ sql) => statement(sql),
    exec: async (/** @type {string} */ sql) => { db.exec(sql); },
    batch: async (/** @type {any[]} */ stmts) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.__exec());
        db.exec('COMMIT');
        return out.map(() => ({ success: true }));
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

/**
 * Minimal R2Bucket.
 *
 * It KEEPS THE BYTES, and returns them from `get` the way R2 does: an
 * object with a `body` stream and `httpMetadata`. It used to record
 * only a byte count and return that, so `get(...).body` was undefined
 * — a photo route could serve nothing at all and every local check
 * still passed, because nothing could tell an empty response from a
 * served one. That was found on 2026-08-31 by fetching a real
 * photograph through the real Worker and getting 200 with zero bytes.
 */
export function makeR2() {
  /** @type {Map<string, {body: Uint8Array, contentType?: string}>} */ const store = new Map();
  return {
    store,
    put: async (/** @type {string} */ key, /** @type {any} */ body, /** @type {any} */ opts) => {
      /** @type {Uint8Array} */ let bytes;
      if (body && typeof body.getReader === 'function') {
        const chunks = [];
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        bytes = new Uint8Array(chunks.reduce((acc, c) => acc.concat([...c]), []));
      } else if (body instanceof Uint8Array) {
        bytes = body;
      } else if (body) {
        bytes = new TextEncoder().encode(String(body));
      } else {
        bytes = new Uint8Array();
      }
      store.set(key, { body: bytes, contentType: opts?.httpMetadata?.contentType });
      return { key };
    },
    get: async (/** @type {string} */ key) => {
      const hit = store.get(key);
      if (!hit) return null;
      return {
        // A fresh stream per get, because a stream is consumed once.
        body: new Blob([hit.body]).stream(),
        size: hit.body.byteLength,
        httpMetadata: { contentType: hit.contentType },
      };
    },
  };
}

/**
 * Minimal KVNamespace. It ENFORCES the real 60-second minimum TTL,
 * because a version that silently accepted anything let a 8-second TTL
 * ship and fail in production with "Expiration TTL must be at least
 * 60". A double that is more permissive than the real thing is worse
 * than no double at all.
 */
export function makeKv() {
  /** @type {Map<string, string>} */ const store = new Map();
  return {
    store,
    get: async (/** @type {string} */ k) => store.get(k) ?? null,
    put: async (/** @type {string} */ k, /** @type {string} */ v, /** @type {any} */ opts) => {
      const t = opts?.expirationTtl;
      if (t !== undefined && (!Number.isFinite(t) || t < 60)) {
        throw new Error(`KV PUT failed: 400 Invalid expiration_ttl of ${t}. Expiration TTL must be at least 60.`);
      }
      store.set(k, v);
    },
    delete: async (/** @type {string} */ k) => { store.delete(k); },
  };
}

/** A full Env for the Worker under test. Note: no DISCOGS_TOKEN. */
export function makeEnv() {
  return { DB: makeD1(), PHOTOS: makeR2(), CACHE: makeKv() };
}
