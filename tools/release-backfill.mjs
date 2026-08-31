#!/usr/bin/env node
// @ts-check

/**
 * release-backfill.mjs — fill in releases the matcher created blank.
 *
 * `upsertRelease` wrote the discogs id alone until 2026-08-31, so every
 * release the matcher made carried no title, label or catalogue number.
 * The review screen reads those columns, so a person was asked to
 * confirm a match against an empty panel — and two items were confirmed
 * that way before anyone noticed.
 *
 * ADDITIVE ONLY. It fills columns that are NULL and touches nothing
 * else: no row is deleted, no `item.release_id` is repointed, and no
 * confirmation is altered. Whether a confirmation made against a blank
 * screen should stand is a person's call, not this script's.
 *
 * Rate-limited the same way everything else here is — one request per
 * release, spaced, because Discogs cares about burstiness and the
 * shared egress makes it stricter.
 *
 * Usage: node tools/release-backfill.mjs [--limit N] [--dry-run] [--gap 2500]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const limit = Number(argOf('--limit', '50'));
const gapMs = Number(argOf('--gap', '2500'));
const dryRun = args.includes('--dry-run');
const DB = 'deep-groove';

const tokenPath = argOf('--token-file', '');
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
  const out = wrangler(['d1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql]);
  const s = out.indexOf('['); const e = out.lastIndexOf(']');
  if (s < 0 || e <= s) throw new Error(`no JSON in reply:\n${out.slice(0, 300)}`);
  return JSON.parse(out.slice(s, e + 1)).flatMap((env) => env.results ?? []);
};
const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const blank = query(
  'SELECT id, discogs_id FROM release'
  + ' WHERE title IS NULL AND catno IS NULL AND label IS NULL'
  + ` ORDER BY id LIMIT ${limit}`);

if (!blank.length) {
  console.log('No blank release rows. Nothing to do.');
  process.exit(0);
}
console.log(`${blank.length} blank release(s): ${blank.map((r) => r.discogs_id).join(', ')}`);
if (dryRun) process.exit(0);

let filled = 0;
const problems = [];
for (const [i, row] of blank.entries()) {
  if (i) await sleep(gapMs);
  let rel;
  try {
    const res = await fetch(`https://api.discogs.com/releases/${row.discogs_id}`, {
      headers: { Authorization: `Discogs token=${token}`, 'User-Agent': 'VinylSorter/0.1 +backfill' },
    });
    if (!res.ok) { problems.push(`${row.discogs_id}: HTTP ${res.status}`); continue; }
    rel = await res.json();
  } catch (err) {
    problems.push(`${row.discogs_id}: ${err instanceof Error ? err.message : err}`);
    continue;
  }

  const label = (rel.labels ?? []).map((l) => l.name).filter(Boolean).join('; ') || null;
  const catno = (rel.labels ?? []).map((l) => l.catno).filter(Boolean)[0] ?? null;
  const title = [(rel.artists ?? []).map((a) => a.name).join(', '), rel.title]
    .filter(Boolean).join(' — ') || null;
  const year = Number(rel.year) || null;

  // COALESCE, so a column that already has a value is never overwritten
  // — this fills gaps, it does not restate what is already known.
  query(
    `UPDATE release SET title = COALESCE(title, ${title ? sql(title) : 'NULL'}),`
    + ` label = COALESCE(label, ${label ? sql(label) : 'NULL'}),`
    + ` catno = COALESCE(catno, ${catno ? sql(catno) : 'NULL'}),`
    + ` year  = COALESCE(year,  ${year ?? 'NULL'})`
    + ` WHERE id = ${row.id}`);
  console.log(`  ${row.discogs_id} -> ${catno ?? '(no catno)'} | ${label ?? '(no label)'} | ${title ?? '(no title)'}`);
  filled += 1;
}

console.log(`\n${filled} release(s) filled.`);
if (problems.length) { console.log('\nProblems:'); for (const p of problems) console.log(`  ${p}`); }
console.log('\nNothing else was changed: no row deleted, no item repointed, no');
console.log('confirmation altered. Two items were confirmed while these were');
console.log('blank — whether those stand is a person\'s call.');
