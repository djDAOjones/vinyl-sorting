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
 *                               [--truth data/label-photos/ground-truth.csv]
 *                               [--model "the chat you used"]
 *                               [--not-independent 448,449,450]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readCsv } from './lib/csv.mjs';
import { parseChatReply } from './lib/photo-fields.mjs';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flagged = new Set();
for (const n of ['--ids', '--out', '--truth', '--model', '--not-independent']) {
  const i = argv.indexOf(n);
  if (i >= 0) { flagged.add(i); flagged.add(i + 1); }
}
const replies = argv.filter((_, i) => !flagged.has(i));

const idsPath = argOf('--ids', 'data/photo-packs/row-ids.csv');
const outPath = argOf('--out', 'data/photo-extract.json');
const truthPath = argOf('--truth', 'data/label-photos/ground-truth.csv');
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

/**
 * The RECORDS that were sent, each once.
 *
 * `row-ids.csv` carries one line per file, and a record may have been
 * photographed a dozen times — so read naively this reported "5 of 98
 * ids" and named record 453 twelve times in the missing list. A record
 * is one row however many photographs it took, which is the same rule
 * the pack builder follows.
 */
const expectedIds = [...new Set(
  readCsv(readFileSync(idsPath, 'utf8')).map((r) => r.row_id).filter(Boolean))];

/**
 * Which rows already had a typed answer BEFORE this reading arrived.
 *
 * A reader with access to this repository can open the ground truth
 * whatever the prompt asks, so the prompt cannot be the guard. This is:
 * a reading of a row whose answer already existed is not an independent
 * measurement, and the scorer refuses to count it as one. Looking
 * therefore cannot manufacture a pass — it can only waste a photograph.
 *
 * A row present but entirely blank does not count: a seeded skeleton is
 * not an answer, and treating it as one would condemn every row before
 * anybody typed anything.
 */
/**
 * Rows the READER itself declared non-independent.
 *
 * Independence can be lost two ways and only one is mechanical. The
 * answer may already have existed — that is checked below. Or the
 * reader may have carried context about these records from before it
 * read them, which nothing here can detect and only it can report.
 *
 * ChatGPT disclosed exactly that for pack-01 on 2026-08-31: "prior
 * project memory exposed some earlier transcription details before I
 * read READ-ALL.md". Taking that at face value costs five rows;
 * ignoring it because the file-based check came back clean would let a
 * known-contaminated batch count as evidence, which is the failure the
 * whole guard exists to prevent. A reader honest enough to volunteer
 * it should not be overruled by a test that cannot see what it saw.
 */
const declared = new Set(argOf('--not-independent', '').split(',').map((s) => s.trim()).filter(Boolean));

const VALUE_COLUMNS = ['catno_raw', 'label_raw', 'name_raw', 'title_raw', 'year_raw', 'decoy_numbers'];
const answered = new Set(
  (existsSync(truthPath) ? readCsv(readFileSync(truthPath, 'utf8')) : [])
    .filter((r) => VALUE_COLUMNS.some((c) => (r[c] ?? '').trim() !== ''))
    .map((r) => r.row_id)
    .filter(Boolean));

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
  for (const [id, result] of Object.entries(parsed.results)) {
    // Stamped at import, never recomputed later: by the time anyone
    // scores this, the ground truth will exist for every row, and the
    // only moment this is knowable is now.
    result.truthPreexisting = answered.has(id);
    if (declared.has(id)) result.declaredNotIndependent = true;
  }
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

const compromised = Object.entries(run.results)
  .filter(([, r]) => r.truthPreexisting).map(([id]) => id);
if (compromised.length) {
  console.log(`\n${compromised.length} row(s) already had a typed answer when this reading`);
  console.log(`arrived: ${compromised.join(', ')}`);
  console.log('They are recorded, but the scorer will not count them as an');
  console.log('independent measurement — the reader could have read the answer.');
}

const told = Object.entries(run.results)
  .filter(([, r]) => r.declaredNotIndependent).map(([id]) => id);
if (told.length) {
  console.log(`\n${told.length} row(s) the reader itself declared non-independent:`);
  console.log(`  ${told.join(', ')}`);
  console.log('Nothing here could have detected that. Held out on its word.');
}

if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(`  ${p}`);
}

console.log(`\nWrote ${outPath}. Score it with: node tools/photo-score.mjs`);
// A reply that named an id nobody sent means the round trip lost
// alignment somewhere, and a score computed over it would be fiction.
process.exit(problems.length ? 1 : 0);
