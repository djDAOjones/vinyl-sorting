#!/usr/bin/env node
// @ts-check

/**
 * photo-import.mjs — SPIKE-PHOTO-TO-FIELDS, the inbound half.
 *
 * Takes what a chat replied, checks it against the ids that were sent,
 * and merges it into the file the scorer reads.
 *
 * THE CHECK IS THE POINT. A hand-run round trip has one failure mode an
 * API call does not: the answer can come back for the wrong photo.
 * Twenty images go up, eighteen objects come back, and without ids
 * every row after the gap is attributed to its neighbour — nineteen
 * plausible readings, all shifted by one, indistinguishable from good
 * data. So an id that was not sent is refused rather than trusted, a
 * repeated id is refused, and anything that never came back is named.
 *
 * IT NEVER TOUCHES THE DATABASE, and a test asserts it cannot.
 *
 * Usage:
 *   node tools/photo-import.mjs <reply.txt> [more-replies.txt ...]
 *                               [--ids data/photo-packs/row-ids.csv]
 *                               [--out data/photo-extract.json]
 *                               [--model "the chat you used"]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readCsv } from './lib/csv.mjs';
import { parseChatReply } from './lib/photo-fields.mjs';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flagged = new Set();
for (const n of ['--ids', '--out', '--model']) {
  const i = argv.indexOf(n);
  if (i >= 0) { flagged.add(i); flagged.add(i + 1); }
}
const replies = argv.filter((_, i) => !flagged.has(i));

const idsPath = argOf('--ids', 'data/photo-packs/row-ids.csv');
const outPath = argOf('--out', 'data/photo-extract.json');
const model = argOf('--model', 'unknown chat');

if (!replies.length) {
  console.error('Give me at least one saved chat reply.');
  console.error('  node tools/photo-import.mjs data/photo-packs/reply-01.txt');
  process.exit(2);
}
if (!existsSync(idsPath)) {
  console.error(`No id list at ${idsPath} — run tools/photo-pack.mjs first.`);
  process.exit(2);
}

const expectedIds = readCsv(readFileSync(idsPath, 'utf8')).map((r) => r.row_id).filter(Boolean);

const run = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf8'))
  : { source: 'chat', model, results: {} };
run.source = 'chat';
run.model = model;

let imported = 0;
const problems = [];

for (const file of replies) {
  if (!existsSync(file)) { problems.push(`${file}: no such file`); continue; }
  let parsed;
  try {
    parsed = parseChatReply(readFileSync(file, 'utf8'), expectedIds);
  } catch (err) {
    problems.push(`${file}: ${err instanceof Error ? err.message : err}`);
    continue;
  }
  const got = Object.keys(parsed.results);
  Object.assign(run.results, parsed.results);
  imported += got.length;
  console.log(`${file}: ${got.length} row(s) — ${got.join(', ') || 'none'}`);
  for (const id of parsed.unknown) {
    problems.push(`${file}: reply names "${id}", which was never sent — dropped`);
  }
  for (const id of parsed.duplicated) {
    problems.push(`${file}: "${id}" appears twice — the second was dropped`);
  }
}

mkdirSync(outPath.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(run, null, 2)}\n`);

const stillMissing = expectedIds.filter((id) => !run.results[id]);
console.log(`\n${imported} row(s) imported this run; ${Object.keys(run.results).length} of ${expectedIds.length} ids now have a reading.`);

if (stillMissing.length) {
  console.log(`\nNo reading yet for ${stillMissing.length}: ${stillMissing.join(', ')}`);
  console.log('Re-upload those images and import the reply — nothing already imported is lost.');
}

if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(`  ${p}`);
}

console.log(`\nWrote ${outPath}. Score it with: node tools/photo-score.mjs`);
// A reply that named an id nobody sent means the round trip lost
// alignment somewhere, and a score computed over it would be fiction.
process.exit(problems.length ? 1 : 0);
