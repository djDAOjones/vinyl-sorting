#!/usr/bin/env node
// @ts-check

/**
 * split-item.mjs — one row that is two discs becomes two rows.
 *
 * CAPTURE-MERGED-ROWS: filing a disc used to mean leaving the
 * viewfinder, so a second disc photographed without those taps joined
 * the first. Item 453 arrived as twelve photographs of two records —
 * Ace of Clubs and Music for Pleasure — and the reader honestly
 * reported two catalogue numbers rather than choosing one.
 *
 * WHERE THE SPLIT FALLS IS A PERSON'S CALL, and this tool takes it as
 * an argument. Nothing here reads a photograph: only somebody who can
 * see them knows where one disc ends, and the timestamps cannot help —
 * all twelve arrived in one capture under one clientId.
 *
 * NOTHING IS DELETED. The new item is an INSERT and the photographs
 * move by UPDATE; no photograph is re-taken and no R2 object is
 * touched. The only removal is a `match_run` that reached no candidate
 * and that nobody has ruled on — a machine verdict over a row that has
 * since changed shape, which must be taken again. A run carrying a
 * candidate or a human decision is refused, and the split stops.
 *
 * Usage:
 *   node tools/split-item.mjs --item 453 --from 7 [--dry-run] [--local]
 *
 * `--from N` is the Nth photograph in capture order — the number
 * `photos-pull` writes into the filename, so `453-7.jpg` is `--from 7`.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const itemId = Number(argOf('--item', ''));
const from = Number(argOf('--from', ''));
const remote = args.includes('--local') ? '--local' : '--remote';
const dryRun = args.includes('--dry-run');
const DB = 'deep-groove';

if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(from) || from < 2) {
  console.error('Usage: node tools/split-item.mjs --item <id> --from <n>');
  console.error('  --from must be 2 or more: splitting before the first photograph');
  console.error('  would leave the original with none, which is a move, not a split.');
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
  const out = wrangler(['d1', 'execute', DB, remote, '--yes', '--json', '--command', sql]);
  const s = out.indexOf('['); const e = out.lastIndexOf(']');
  if (s < 0 || e <= s) throw new Error(`no JSON in reply:\n${out.slice(0, 300)}`);
  return JSON.parse(out.slice(s, e + 1)).flatMap((env) => env.results ?? []);
};

// Capture order is `item_photo.id` ascending — the same order
// photos-pull numbers filenames by, so `--from 7` means `<item>-7.jpg`.
const photos = query(`SELECT id, r2_key FROM item_photo WHERE item_id = ${itemId} ORDER BY id`);
if (photos.length < 2) {
  console.error(`Item ${itemId} has ${photos.length} photograph(s). Nothing to split.`);
  process.exit(2);
}
if (from > photos.length) {
  console.error(`Item ${itemId} has ${photos.length} photographs; --from ${from} is past the end.`);
  process.exit(2);
}

const staying = photos.slice(0, from - 1);
const moving = photos.slice(from - 1);

// A verdict somebody ruled on is their work, not a machine's answer to
// a question that has changed.
const guarded = query(
  `SELECT m.id,
          (SELECT COUNT(*) FROM review_decision d WHERE d.match_run_id = m.id) decided,
          (SELECT COUNT(*) FROM match_candidate c WHERE c.match_run_id = m.id) cands
     FROM match_run m WHERE m.item_id = ${itemId}`);
const held = guarded.filter((r) => r.decided > 0 || r.cands > 0);

console.log(`Item ${itemId}: ${photos.length} photograph(s)`);
console.log(`  staying with ${itemId}: ${staying.length} (1..${from - 1})`);
console.log(`  moving to a new item: ${moving.length} (${from}..${photos.length})`);
for (const p of moving) console.log(`    ${p.r2_key}`);

if (held.length) {
  console.error(`\nRefusing: ${held.length} match_run(s) on item ${itemId} carry a candidate or a`);
  console.error('human decision. Splitting would strand somebody\'s work against a row that no');
  console.error('longer means what it did. Resolve or re-queue those first.');
  process.exit(1);
}

if (dryRun) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

// The new item inherits only what is true of BOTH discs: where it was
// captured and by whom. Nothing read off a label comes across, because
// which disc that reading described is the open question.
const created = query(
  `INSERT INTO item (crate, position, captured_by, captured_at, notes)
   SELECT crate, position, captured_by, captured_at,
          COALESCE(notes || ' ', '') || 'Split from item ${itemId} at photograph ${from}.'
     FROM item WHERE id = ${itemId} RETURNING id`);
const newId = created[0]?.id;
if (!newId) throw new Error('the new item was not created');

query(`UPDATE item_photo SET item_id = ${newId} WHERE id IN (${moving.map((p) => p.id).join(',')})`);

// Both rows have changed shape, so both machine verdicts are stale.
query(`DELETE FROM match_run WHERE item_id IN (${itemId}, ${newId})`
  + ' AND NOT EXISTS (SELECT 1 FROM review_decision d WHERE d.match_run_id = match_run.id)'
  + ' AND NOT EXISTS (SELECT 1 FROM match_candidate c WHERE c.match_run_id = match_run.id)');

const after = query(
  `SELECT (SELECT COUNT(*) FROM item_photo WHERE item_id = ${itemId}) a,`
  + ` (SELECT COUNT(*) FROM item_photo WHERE item_id = ${newId}) b,`
  + ` (SELECT COUNT(*) FROM match_run WHERE item_id IN (${itemId}, ${newId})) runs`)[0];

console.log(`\nItem ${itemId} now has ${after.a} photograph(s); new item ${newId} has ${after.b}.`);
console.log(`${after.runs} match_run(s) left on the pair — both re-queued for the cron matcher.`);
console.log('\nBoth rows need reading again: the reading you have describes one row');
console.log('that was two records.\n');
console.log('  node tools/photos-pull.mjs && node tools/photo-pack.mjs');
