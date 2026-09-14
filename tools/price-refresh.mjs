#!/usr/bin/env node
// @ts-check

/**
 * price-refresh.mjs — fill and refresh `release.lowest_price`.
 *
 * The column has existed since M1 (schema 001) and nothing ever wrote
 * it, so the collection screen's `~value` had nothing to show and the
 * sort CATALOGUE-CONTROLS asked for could not exist. New matches carry
 * a price for free from 2026-09-14 — `fetchReleaseFacts` reads it off
 * the release call the tracklist already pays for — but the ~300
 * releases matched BEFORE that never will. This is that pass, and it is
 * also how a stale price gets refreshed afterwards.
 *
 * WHAT IT WRITES, AND WHY THAT IS NOT A DESTRUCTIVE OPERATION. Three
 * columns, on releases only: `lowest_price`, `num_for_sale`,
 * `price_checked_at`. Unlike `release-backfill.mjs` this OVERWRITES
 * rather than COALESCEs, and the difference is the nature of the fact:
 * a title is settled and a cheapest listing is a market on a Tuesday.
 * A price that is never overwritten is a price that lies. Nothing else
 * is touched — no item repointed, no confirmation altered, no row
 * deleted, and no `field_source` row written, because a re-checkable
 * number is not a sourced claim about what a pressing IS.
 *
 * ONE CURRENCY, NAMED. `lowest_price` is a bare REAL with no currency
 * beside it, so every writer fetches in `PRICE_CURRENCY` from
 * worker/discogs.ts and `curr_abbr` is always sent — Discogs otherwise
 * answers in whatever currency the token's account happens to prefer,
 * and a column holding two currencies is a column holding neither.
 *
 * Paced as AGENTS.md fixes it: 30/min AND at least 2 s apart, one
 * request per release, with a real user-agent. Stalest first, so an
 * interrupted run resumes where it stopped rather than starting again.
 *
 * Usage: node tools/price-refresh.mjs [--limit N] [--dry-run]
 *          [--gap 2500] [--older-than DAYS] [--token-file PATH]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { priceOf } from '../worker/match/run.ts';
import { PRICE_CURRENCY, USER_AGENT } from '../worker/discogs.ts';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const limit = Number(argOf('--limit', '400'));
const gapMs = Number(argOf('--gap', '2500'));
// Re-price only what is older than this many days. 0 means everything,
// which is what the first pass wants; a later sweep passes 30.
const olderThan = Number(argOf('--older-than', '0'));
const dryRun = args.includes('--dry-run');
const out = argOf('--out', 'data/price-refresh.json');
const DB = 'deep-groove';
// One wrangler invocation per row would double a run already bounded by
// the Discogs spacing, and a crash mid-pass would have written fewer
// rows than it fetched. Flushed in batches, and on the way out.
const FLUSH_EVERY = 25;

const tokenPath = argOf('--token-file', 'Pre August 2026/Windsurf Projects/discogs_personal_access_token');
const token = process.env.DISCOGS_TOKEN
  || (tokenPath && existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '');
if (!token && !dryRun) {
  console.error('No Discogs token. Set DISCOGS_TOKEN, or pass --token-file <path>.');
  console.error('The Worker secret cannot be read back, so this needs its own copy.');
  process.exit(2);
}

const wrangler = (argv) => {
  try {
    return execFileSync('npx', ['wrangler', ...argv],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`wrangler failed:\n${detail || err.message}`);
  }
};
const query = (sql) => {
  const out2 = wrangler(['d1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql]);
  const s = out2.indexOf('['); const e = out2.lastIndexOf(']');
  if (s < 0 || e <= s) throw new Error(`no JSON in reply:\n${out2.slice(0, 300)}`);
  return JSON.parse(out2.slice(s, e + 1)).flatMap((envelope) => envelope.results ?? []);
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : 'NULL');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ONLY releases something in the collection points at. Pricing a
// release no item claims spends a rate limit on a row no screen shows.
// Stalest first — NULLs are the never-checked, and they come first —
// so an interrupted run resumes rather than restarts.
const due = query(
  'SELECT r.id, r.discogs_id, r.price_checked_at FROM release r'
  + ' WHERE EXISTS (SELECT 1 FROM item i WHERE i.release_id = r.id)'
  + (olderThan > 0
    ? ` AND (r.price_checked_at IS NULL OR r.price_checked_at < datetime('now', '-${olderThan} days'))`
    : '')
  + ' ORDER BY r.price_checked_at IS NOT NULL, r.price_checked_at, r.id'
  + ` LIMIT ${limit}`);

if (!due.length) {
  console.log('No releases due a price. Nothing to do.');
  process.exit(0);
}
const never = due.filter((r) => !r.price_checked_at).length;
console.log(`${due.length} release(s) due — ${never} never priced, ${due.length - never} being refreshed.`);
console.log(`Currency ${PRICE_CURRENCY}, ${gapMs} ms apart: about ${Math.ceil(due.length * gapMs / 60000)} min.`);
if (dryRun) {
  console.log('\n--dry-run: no request made, nothing written.');
  process.exit(0);
}

/** @type {string[]} */
let pending = [];
/** @type {{discogsId: number, lowest: number|null, forSale: number|null}[]} */
const written = [];
const problems = [];
let listed = 0;
let unlisted = 0;

const flush = () => {
  if (!pending.length) return;
  query(pending.join('; '));
  pending = [];
};

for (const [i, row] of due.entries()) {
  if (i) await sleep(gapMs);
  let rel;
  try {
    const url = `https://api.discogs.com/releases/${row.discogs_id}?curr_abbr=${PRICE_CURRENCY}`;
    const res = await fetch(url, {
      headers: { Authorization: `Discogs token=${token}`, 'User-Agent': USER_AGENT },
    });
    // Honour Retry-After rather than hammering — the shared egress makes
    // Discogs stricter than its published rate (M2-DISCOGS-PACING).
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 0) || 60;
      console.log(`  throttled — waiting ${wait}s`);
      await sleep(wait * 1000);
      problems.push(`${row.discogs_id}: throttled, not re-tried this pass`);
      continue;
    }
    if (!res.ok) { problems.push(`${row.discogs_id}: HTTP ${res.status}`); continue; }
    rel = await res.json();
  } catch (err) {
    problems.push(`${row.discogs_id}: ${err instanceof Error ? err.message : err}`);
    continue;
  }

  // The SAME reader the Worker uses, so the two cannot drift apart on
  // what "no price" means.
  const price = priceOf(rel);
  if (!price) {
    problems.push(`${row.discogs_id}: response carried no price keys — left untouched`);
    continue;
  }

  pending.push(
    `UPDATE release SET lowest_price = ${num(price.lowest)},`
    + ` num_for_sale = ${num(price.forSale)},`
    + " price_checked_at = datetime('now')"
    + ` WHERE id = ${Number(row.id)}`);
  written.push({ discogsId: Number(row.discogs_id), lowest: price.lowest, forSale: price.forSale });
  if (price.lowest === null) unlisted += 1; else listed += 1;
  console.log(`  ${row.discogs_id} -> ${price.lowest === null ? 'none listed' : `${price.lowest} ${PRICE_CURRENCY}`}`
    + ` (${price.forSale ?? '?'} for sale)`);
  if (pending.length >= FLUSH_EVERY) flush();
}
flush();

const priced = written.filter((w) => typeof w.lowest === 'number').map((w) => w.lowest);
const total = priced.reduce((a, b) => a + b, 0);
writeFileSync(out, `${JSON.stringify({
  ranAt: new Date().toISOString(),
  currency: PRICE_CURRENCY,
  due: due.length,
  written: written.length,
  listed,
  unlisted,
  problems,
  releases: written,
}, null, 2)}\n`);

console.log(`\n${written.length} release(s) priced: ${listed} with a listing, ${unlisted} with none.`);
if (priced.length) {
  const sorted = [...priced].sort((a, b) => a - b);
  console.log(`Cheapest listings: total ${total.toFixed(2)} ${PRICE_CURRENCY},`
    + ` median ${sorted[Math.floor(sorted.length / 2)]?.toFixed(2)},`
    + ` dearest ${sorted[sorted.length - 1]?.toFixed(2)}.`);
  console.log('That total is what the cheapest copies are ASKING, not a valuation of the collection.');
}
console.log(`Report: ${out}`);
if (problems.length) { console.log('\nProblems:'); for (const p of problems) console.log(`  ${p}`); }
