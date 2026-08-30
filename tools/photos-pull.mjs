#!/usr/bin/env node
// @ts-check

/**
 * photos-pull.mjs — PHOTOS-TO-DESKTOP.
 *
 * Photographs taken on the phone land in R2, and until now nothing
 * could read them back: the Worker has a PUT and no GET at all. This
 * pulls them to the desktop, named by the item id that ties a reading
 * back to a record.
 *
 * IT PULLS, RATHER THAN ADDING A ROUTE. The obvious design — a
 * zip-download endpoint in the app — inverts the property that keeps a
 * sign-in-free v1 safe: "no route reads a photo" would become "one
 * route enumerates and returns all of them", and unlike the matcher,
 * which runs from cron and has no caller, an export route exists to be
 * called. This uses the credentials Joe already has from deploying, so
 * there is no new exposure and no auth conversation.
 *
 * IT NEVER ENUMERATES R2. `item_photo` carries `(item_id, r2_key)`, so
 * the pairs come from D1 and each object is fetched by name. That was
 * the open question in the record, and the schema answers it: nothing
 * here depends on listing a bucket.
 *
 * IT IS READ-ONLY, everywhere. It runs SELECTs against D1 and GETs
 * against R2, and a test asserts it issues no other verb — a tool
 * pointed at production with `--remote` should not be able to write
 * to it even by accident.
 *
 * Usage:
 *   node tools/photos-pull.mjs [--out data/label-photos] [--kind all|label_a|…]
 *                              [--limit 20] [--local] [--dry-run]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const outDir = argOf('--out', 'data/label-photos');
// Everything, by default. The app no longer describes its photographs
// — they are all `other` — so filtering by kind would now mean pulling
// nothing, and a record's title may be on any one of its shots.
const kind = argOf('--kind', 'all');
const limit = Number(argOf('--limit', '0'));
const remote = args.includes('--local') ? '--local' : '--remote';
const dryRun = args.includes('--dry-run');

const DB = 'deep-groove';
const BUCKET = 'deep-groove-photos';

/**
 * `wrangler`, with stdin closed and stderr captured.
 *
 * Closing stdin matters: wrangler will sit waiting on a TTY it was
 * never given. Capturing stderr matters more — without it a failure
 * surfaces as execFileSync's own "Command failed" and the reason
 * wrangler gave is thrown away, which is a diagnosis deleted at exactly
 * the moment it is needed.
 */
const wrangler = (argv, opts = {}) => {
  try {
    return execFileSync('npx', ['wrangler', ...argv],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`wrangler ${argv.join(' ')} failed:\n${detail || err.message}`);
  }
};

/**
 * `d1 execute --json` prints an array of result envelopes, but wrangler
 * also prints its own banner on stdout depending on version and TTY.
 * Digging the JSON out of whatever surrounds it is the same forgiveness
 * the chat-reply parser needs, and for the same reason.
 */
function query(sql) {
  const raw = wrangler(['d1', 'execute', DB, remote, '--json', '--command', sql]);
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error(`no JSON in wrangler's reply:\n${raw.slice(0, 400)}`);
  const envelopes = JSON.parse(raw.slice(start, end + 1));
  return envelopes.flatMap((e) => e.results ?? []);
}

console.log(`Reading photo rows from D1 (${remote})…`);

/**
 * What exists, by kind, before anything is filtered.
 *
 * A capture may now carry several photographs — the catalogue number is
 * on the centre label and the title is often on the sleeve — so a pull
 * that quietly takes `label_a` and drops the rest would hand the reader
 * half a record and call it whole. Counting first means a skip is
 * always stated.
 */
const byKind = query('SELECT kind, COUNT(*) n FROM item_photo GROUP BY kind');
if (byKind.length) {
  console.log(`In the store: ${byKind.map((k) => `${k.n} ${k.kind}`).join(', ')}`);
}

// One row per photo of the requested kind, newest first, with the typed
// capture beside it — the two halves the spike needs, from one query.
const rows = query(`
  SELECT ip.item_id, ip.r2_key, i.crate, i.position,
         ip.kind, c.catno_raw, c.label_raw, c.name_raw, c.title_raw, c.year_raw
  FROM item_photo ip
  JOIN item i ON i.id = ip.item_id
  LEFT JOIN capture c ON c.item_id = ip.item_id
  ${kind === 'all' ? '' : `WHERE ip.kind = '${kind}'`}
  ORDER BY ip.id DESC
  ${limit > 0 ? `LIMIT ${limit}` : ''}
`.trim());

if (!rows.length) {
  console.log(`\nNo ${kind} photos in the database.`);
  console.log('Photographs taken before R2 was enabled stay queued on the phone —');
  console.log('they upload themselves once the binding exists, and appear here then.');
  process.exit(0);
}

console.log(`${rows.length} photo(s) to pull.\n`);
if (dryRun) {
  for (const r of rows) console.log(`  ${r.item_id} ← ${r.r2_key}`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const pulled = [];
const failed = [];
/** How many photographs of each item have been named so far. */
const seen = new Map();
for (const row of rows) {
  // `<item_id>-<n>.jpg`. The number is the order the photographs were
  // taken, which is a fact; the filename asserts nothing else, because
  // nothing else is known about them. photo-pack reads the item id back
  // off the stem and groups a record's photographs together.
  seen.set(row.item_id, (seen.get(row.item_id) ?? 0) + 1);
  const dest = join(outDir, `${row.item_id}-${seen.get(row.item_id)}.jpg`);
  // Already on disk is a skip, not a re-download: a second run after
  // adding ten more discs should cost ten fetches, not two hundred.
  row.file = dest.slice(dest.lastIndexOf('/') + 1);
  if (existsSync(dest)) { pulled.push(row); continue; }
  try {
    wrangler(['r2', 'object', 'get', `${BUCKET}/${row.r2_key}`, '--file', dest, remote]);
    pulled.push(row);
    console.log(`  ${row.file}`);
  } catch (err) {
    // A missing object is not fatal: the row may have been captured
    // while R2 was off, so the capture exists and the photo never
    // arrived. Naming it is more useful than stopping the run.
    failed.push({ item_id: row.item_id, r2_key: row.r2_key });
  }
}

// Several files may map to one row id, and that is the point: a record
// is one row however many photographs it took.
writeFileSync(join(outDir, 'row-ids.csv'),
  `file,row_id\n${pulled.map((r) => `${r.file},${r.item_id}`).join('\n')}\n`);

/**
 * The ground truth, pre-filled from what a person typed into capture.
 *
 * `capture` holds what a HUMAN read off the label, which is exactly the
 * definition of ground truth here — so retyping it into a CSV would be
 * transcribing the same values twice and inviting a discrepancy between
 * them. Only `decoy_numbers` is left blank, because it is the one thing
 * capture never asks for, and it is the column that catches a matrix
 * number being reported as a catalogue number.
 *
 * An existing file is never overwritten: it may already carry decoys
 * typed by hand, and that is the expensive half.
 */
const truthPath = join(outDir, 'ground-truth.csv');
const header = 'row_id,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers';
const q = (v) => {
  const s = (v ?? '').toString();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const byItem = new Map();
for (const r of pulled) if (!byItem.has(r.item_id)) byItem.set(r.item_id, r);
const body = [...byItem.values()].map((r) =>
  [r.item_id, r.catno_raw, r.label_raw, r.name_raw, r.title_raw, r.year_raw, ''].map(q).join(','));

if (existsSync(truthPath) && readFileSync(truthPath, 'utf8').trim() !== header) {
  writeFileSync(join(outDir, 'ground-truth.from-captures.csv'), `${header}\n${body.join('\n')}\n`);
  console.log(`\nground-truth.csv already has rows — wrote ground-truth.from-captures.csv instead.`);
  console.log('Merge what you want from it; your typed decoy numbers are untouched.');
} else {
  writeFileSync(truthPath, `${header}\n${body.join('\n')}\n`);
  console.log(`\nWrote ${truthPath} from the values you typed into capture.`);
}

console.log(`\n${pulled.length} photo(s) of ${byItem.size} record(s) in ${outDir}.`);
if (failed.length) {
  console.log(`\n${failed.length} had no object in R2 (captured before it was enabled?):`);
  for (const f of failed) console.log(`  item ${f.item_id} — ${f.r2_key}`);
}
const skipped = kind === 'all' ? 0 : byKind.filter((k) => k.kind !== kind).reduce((n, k) => n + k.n, 0);
if (kind !== 'all' && skipped) {
  console.log(`\nNOT pulled: ${skipped} photo(s) of other kinds. A record whose title is`);
  console.log('on the sleeve cannot be read from its label alone — use --kind all to');
  console.log('take them too. Note that photo-pack still treats one image as one row.');
}

console.log('\nStill to do by hand: the `decoy_numbers` column — every OTHER number');
console.log('on each label. It is what catches a matrix number reported as a');
console.log('catalogue number, and capture never asks for it.');
console.log('\nThen:  node tools/photo-pack.mjs');
