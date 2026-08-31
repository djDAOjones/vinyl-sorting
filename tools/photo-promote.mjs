#!/usr/bin/env node
// @ts-check

/**
 * photo-promote.mjs — put a photo reading where the matcher can use it.
 *
 * This is the step SPIKE-PHOTO-TO-FIELDS existed to inform, and the
 * maintainer authorised it on 2026-08-31. Everything before it
 * measured; this one writes.
 *
 * IT NEVER WRITES `capture`, and a test asserts it cannot. That table
 * holds what a HUMAN read off the disc, and duplicate detection depends
 * on the difference between that and what a machine thought it saw. A
 * reading lands in `raw_value` with provenance `vision`, which every
 * decision view already excludes — `v_confirmed_field` allow-lists
 * shelf, discogs and musicbrainz, so a vision value cannot reach a
 * cluster, a coverage check, a sell list or a shortlist however
 * confident it looks.
 *
 * WHAT IT IS FOR is the matcher, which searches Discogs on whatever
 * signals exist and refuses a verdict on one signal family alone. A
 * reading is therefore a lead — the same standing a catalogue number
 * has always had here — and its output is a review-queue item for a
 * person to accept or reject.
 *
 * IT RE-QUEUES, because the cron matcher has already swept these rows
 * and found nothing, having had nothing to search. A `match_run` that
 * reached no candidates and that nobody has ruled on is a machine
 * verdict over empty input; it is removed so the row is matched again.
 * A run with a candidate or a human decision is never touched.
 *
 * Usage:
 *   node tools/photo-promote.mjs [--extract data/photo-extract.json]
 *                                [--local] [--dry-run]
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PHOTO_FIELDS } from './lib/photo-fields.mjs';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const extractPath = argOf('--extract', 'data/photo-extract.json');
const remote = args.includes('--local') ? '--local' : '--remote';
const dryRun = args.includes('--dry-run');
const DB = 'deep-groove';

if (!existsSync(extractPath)) {
  console.error(`No reading at ${extractPath}. Import one first.`);
  process.exit(2);
}

const wrangler = (argv) => {
  try {
    return execFileSync('npx', ['wrangler', ...argv],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`wrangler ${argv.slice(0, 3).join(' ')} failed:\n${detail || err.message}`);
  }
};
const exec = (sql) => wrangler(['d1', 'execute', DB, remote, '--yes', '--json', '--command', sql]);
const query = (sql) => {
  const out = exec(sql);
  const s = out.indexOf('[');
  const e = out.lastIndexOf(']');
  if (s < 0 || e <= s) throw new Error(`no JSON in wrangler's reply:\n${out.slice(0, 300)}`);
  return JSON.parse(out.slice(s, e + 1)).flatMap((env) => env.results ?? []);
};

const run = JSON.parse(readFileSync(extractPath, 'utf8'));
const sqlStr = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Only rows that name a real item, and only fields with a value. */
const statements = [];
const rows = [];
for (const [rowId, result] of Object.entries(run.results ?? {})) {
  const itemId = Number(rowId);
  if (!Number.isInteger(itemId) || itemId <= 0) continue;   // a filename-stem id is not an item
  const fields = PHOTO_FIELDS
    .map((f) => [f, result?.fields?.[f]])
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');

  /**
   * `other_numbers` comes across too, and it is NOT in PHOTO_FIELDS.
   *
   * That list is the SCORED set — what `photo-score.mjs` grades a
   * reading against — and every number a label happens to print is not
   * something a reading can be right or wrong about. But it is
   * evidence, and until now it was extracted into
   * `data/photo-extract.json` and consumed by nothing at all: item 480
   * carries `SUA 10639 Mono` behind the stereo number it chose, item
   * 469 carries `642 273 GL` behind `GL5840`, and no query ever tried
   * either (MATCH-OTHER-NUMBERS).
   *
   * Joined with newlines because that is what `otherCatnoVariants`
   * splits on, and it survives a number containing a comma.
   */
  const others = Array.isArray(result?.fields?.other_numbers)
    ? result.fields.other_numbers.map((v) => String(v).trim()).filter(Boolean)
    : [];
  if (others.length) fields.push(['other_numbers', others.join('\n')]);

  if (!fields.length) continue;
  rows.push({ itemId, n: fields.length });
  for (const [field, value] of fields) {
    const v = sqlStr(String(value).trim());
    // Re-reading a photograph should update the reading, not collide
    // with it, so both writes are upserts keyed the way the schema is.
    statements.push(
      `INSERT INTO raw_value (item_id, field, value) VALUES (${itemId}, ${sqlStr(field)}, ${v})`
      + ` ON CONFLICT(item_id, field) DO UPDATE SET value = excluded.value`);
    statements.push(
      "INSERT INTO field_source (entity, entity_id, field, source)"
      + ` SELECT 'raw_value', r.id, ${sqlStr(field)}, 'vision' FROM raw_value r`
      + ` WHERE r.item_id = ${itemId} AND r.field = ${sqlStr(field)}`
      + " ON CONFLICT(entity, entity_id, field) DO UPDATE SET source = 'vision'");
  }
}

if (!rows.length) {
  console.log('No reading names an item id — nothing to promote.');
  process.exit(0);
}

const ids = rows.map((r) => r.itemId);
console.log(`${rows.length} record(s) with a reading: ${ids.join(', ')}`);
console.log(`${statements.length} statement(s) to apply (${remote}).`);

// Only a verdict reached over nothing, that nobody has ruled on.
const requeue =
  `DELETE FROM match_run WHERE item_id IN (${ids.join(',')})`
  + ' AND NOT EXISTS (SELECT 1 FROM review_decision d WHERE d.match_run_id = match_run.id)'
  + ' AND NOT EXISTS (SELECT 1 FROM match_candidate c WHERE c.match_run_id = match_run.id)';

if (dryRun) {
  console.log('\n--dry-run: nothing written. First two statements:');
  for (const s of statements.slice(0, 2)) console.log(`  ${s}`);
  console.log(`\nAnd the re-queue:\n  ${requeue}`);
  process.exit(0);
}

for (const [i, s] of statements.entries()) {
  exec(s);
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${statements.length}`);
}
exec(requeue);

const after = query(
  `SELECT (SELECT COUNT(*) FROM raw_value WHERE item_id IN (${ids.join(',')})) raws,`
  + ` (SELECT COUNT(*) FROM field_source WHERE source = 'vision') visions,`
  + ` (SELECT COUNT(*) FROM match_run WHERE item_id IN (${ids.join(',')})) runs`)[0];

console.log(`\nraw_value rows for these items: ${after.raws}`);
console.log(`field_source rows sourced 'vision': ${after.visions}`);
console.log(`match_run rows left on them: ${after.runs} (re-queued: ${ids.length - after.runs})`);
console.log('\nMatch them:\n\n  node tools/match-run.mjs');
