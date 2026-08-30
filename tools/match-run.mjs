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
 * Usage: node tools/match-run.mjs [--limit N] [--out data/match-run.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { makeEnv } from './test/helpers/bindings.mjs';
import { loadDataset } from './load-dataset.mjs';
import { DiscogsClient } from '../worker/discogs.ts';
import { RateLimiter } from '../worker/rate-limit.ts';
import { matchRow, persistRun } from '../worker/match/run.ts';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const limit = Number(argOf('--limit', '40')) || 40;
const out = argOf('--out', 'data/match-run.json');

const token = readFileSync('Pre August 2026/Windsurf Projects/discogs_personal_access_token', 'utf8').trim();

// A real in-memory counter store; the limiter's algorithm is the same
// one the Worker runs against KV.
const counters = new Map();
const limiter = new RateLimiter({
  get: async (k) => counters.get(k) ?? null,
  put: async (k, v) => { counters.set(k, v); },
});
const client = new DiscogsClient(token, limiter);

// Load the dataset into a real database, then match against it.
const env = makeEnv();
const source = loadDataset(':memory:');
env.DB.raw.exec(readFileSync('data/seed.sql', 'utf8'));
source.db.close?.();

/** The backlog: rows with a capture but no Discogs release yet. */
const rows = env.DB.raw.prepare(`
  SELECT i.id AS itemId, c.id AS captureId,
         c.catno_raw AS catnoRaw, c.label_raw AS labelRaw,
         c.title_raw AS titleRaw, c.name_raw AS nameRaw, c.year_raw AS yearRaw
    FROM item i
    LEFT JOIN capture c ON c.item_id = i.id
   WHERE i.release_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id)
   ORDER BY i.id
   LIMIT ?`).all(limit);

console.log(`match-run: ${rows.length} unmatched rows (of the backlog); searching Discogs`);

const outcomes = [];
let n = 0;
for (const row of rows) {
  const result = await matchRow(row, client);
  await persistRun(env, row, result);
  outcomes.push({ ...result.outcome, capture: { catno: row.catnoRaw, title: row.titleRaw, name: row.nameRaw } });
  if (++n % 10 === 0) console.log(`  ${n}/${rows.length}…`);
  // The limiter refuses over budget; this paces under it.
  await new Promise((r) => setTimeout(r, 200));
}

const by = (v) => outcomes.filter((o) => o.verdict === v).length;
const stats = {
  ranAt: new Date().toISOString(),
  attempted: outcomes.length,
  verified: by('verified'),
  needsReview: by('needs_review'),
  noMatch: by('no_match'),
  rejectedBeforeAnyCall: by('rejected'),
  apiCalls: outcomes.reduce((a, o) => a + o.queriesRun, 0),
};
writeFileSync(out, `${JSON.stringify({ ...stats, outcomes }, null, 2)}\n`);

console.log(`\nmatch-run: ${stats.attempted} rows`);
console.log(`  verified (auto-accepted): ${stats.verified}`);
console.log(`  needs review            : ${stats.needsReview}`);
console.log(`  nothing found           : ${stats.noMatch}`);
console.log(`  rejected before any call: ${stats.rejectedBeforeAnyCall}`);
console.log(`  Discogs queries spent   : ${stats.apiCalls}`);
console.log(`  -> ${out}`);
