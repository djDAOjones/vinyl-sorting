#!/usr/bin/env node
// @ts-check

/**
 * match-run.mjs — runs the REAL matcher over the loaded dataset,
 * locally, against live Discogs.
 *
 * Same code path the cron trigger uses in production: same query
 * ladder, same scorer, same gate, same persistence. The only
 * difference is the bindings, which are node:sqlite and a plain fetch
 * rather than D1 and a Worker runtime.
 *
 * Rate limited to the shared 50/min. Read-only against Discogs; writes
 * only to the local database.
 *
 * RESUMABLE BY CONSTRUCTION: it selects only items with no `match_run`,
 * so a run that dies costs the row it was on and nothing else. The
 * database is a file, not memory, so results survive the process.
 *
 * Usage: node tools/match-run.mjs [--limit N] [--db data/deep-groove.sqlite]
 *                                 [--out data/match-run.json] [--backlog-only]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applySchema } from './test/helpers/bindings.mjs';
import { makeD1, makeR2, makeKv } from './test/helpers/bindings.mjs';
import { toSeedSql } from './load-dataset.mjs';
import { DiscogsClient } from '../worker/discogs.ts';
import { RateLimiter } from '../worker/rate-limit.ts';
import { matchRow, persistRun } from '../worker/match/run.ts';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const limit = Number(argOf('--limit', '0')) || Infinity;
const out = argOf('--out', 'data/match-run.json');
const dbPath = argOf('--db', 'data/deep-groove.sqlite');
const backlogOnly = args.includes('--backlog-only');

const token = readFileSync('Pre August 2026/Windsurf Projects/discogs_personal_access_token', 'utf8').trim();

// A real in-memory counter store; the limiter's algorithm is the same
// one the Worker runs against KV.
const counters = new Map();
const limiter = new RateLimiter({
  get: async (k) => counters.get(k) ?? null,
  put: async (k, v) => { counters.set(k, v); },
});
const client = new DiscogsClient(token, limiter);

// A FILE, not memory: 45 minutes of API time must survive the process.
const fresh = !existsSync(dbPath);
const db = new DatabaseSync(dbPath);
// WAL so a reader — a progress report, say — cannot block the writer
// or be blocked by it. The default rollback journal takes an exclusive
// lock and a mid-run read aborts the job.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 10000;');
if (fresh) {
  applySchema(db);
  db.exec(readFileSync('data/seed.sql', 'utf8'));
  console.log(`match-run: created ${dbPath} from the M0 seed`);
} else {
  const done = db.prepare('SELECT COUNT(*) n FROM match_run').get().n;
  console.log(`match-run: resuming ${dbPath} — ${done} row(s) already matched`);
}

/** Wrap the file database in the same D1 shape the Worker expects. */
const statement = (sql, boundArgs = []) => ({
  bind: (...next) => statement(sql, next),
  first: async () => db.prepare(sql).all(...boundArgs)[0] ?? null,
  all: async () => ({ results: db.prepare(sql).all(...boundArgs), success: true }),
  run: async () => { db.prepare(sql).run(...boundArgs); return { success: true }; },
  __exec: () => db.prepare(sql).run(...boundArgs),
});
const env = {
  DB: { raw: db, prepare: (sql) => statement(sql), exec: async (sql) => { db.exec(sql); },
    batch: async (stmts) => { db.exec('BEGIN'); try { const r = stmts.map((x) => x.__exec()); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } },
  PHOTOS: makeR2(), CACHE: makeKv(),
};

/**
 * Every row without a match_run yet. The 277 that already claim a
 * release are included on purpose: searching afresh and letting the
 * gate judge is the actual re-verification, where the earlier audit
 * only asked whether the existing claim held up.
 */
const rows = db.prepare(`
  SELECT i.id AS itemId, c.id AS captureId,
         c.catno_raw AS catnoRaw, c.label_raw AS labelRaw,
         c.title_raw AS titleRaw, c.name_raw AS nameRaw, c.year_raw AS yearRaw
    FROM item i
    LEFT JOIN capture c ON c.item_id = i.id
   WHERE NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id)
     ${backlogOnly ? 'AND i.release_id IS NULL' : ''}
   ORDER BY i.id
   LIMIT ?`).all(limit === Infinity ? -1 : limit);

console.log(`match-run: ${rows.length} rows to match; searching Discogs at the shared 50/min`);

const outcomes = [];
let n = 0;
for (const row of rows) {
  const result = await matchRow(row, client);
  await persistRun(env, row, result);
  outcomes.push({ ...result.outcome, capture: { catno: row.catnoRaw, title: row.titleRaw, name: row.nameRaw } });
  if (++n % 10 === 0) {
    console.log(`  ${n}/${rows.length}… (${outcomes.reduce((a, o) => a + o.queriesRun, 0)} queries)`);
  }
  // No sleep here: the client waits on the shared budget itself, which
  // is the only pacing that also holds inside the Worker.
}

const by = (v) => outcomes.filter((o) => o.verdict === v).length;
const stats = {
  ranAt: new Date().toISOString(),
  attempted: outcomes.length,
  verified: by('verified'),
  needsReview: by('needs_review'),
  noMatch: by('no_match'),
  rejectedBeforeAnyCall: by('rejected'),
  errored: by('error'),
  apiCalls: outcomes.reduce((a, o) => a + o.queriesRun, 0),
  queryErrors: outcomes.reduce((a, o) => a + (o.queryErrors ?? 0), 0),
};
writeFileSync(out, `${JSON.stringify({ ...stats, outcomes }, null, 2)}\n`);

// Re-emit the seed WITH the match results, so a deployment inherits
// this run instead of spending the same 2,000 queries again.
writeFileSync('data/seed.sql', toSeedSql(db));
console.log(`  -> data/seed.sql rewritten, now carrying the match results`);

console.log(`\nmatch-run: ${stats.attempted} rows`);
console.log(`  verified (auto-accepted): ${stats.verified}`);
console.log(`  needs review            : ${stats.needsReview}`);
console.log(`  nothing found           : ${stats.noMatch}`);
console.log(`  rejected before any call: ${stats.rejectedBeforeAnyCall}`);
console.log(`  never searched (errors)  : ${stats.errored}`);
console.log(`  Discogs queries spent   : ${stats.apiCalls} (${stats.queryErrors} failed)`);
console.log(`  -> ${out}`);
