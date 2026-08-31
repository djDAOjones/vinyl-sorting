#!/usr/bin/env node
// @ts-check

/**
 * photo-pack.mjs — SPIKE-PHOTO-TO-FIELDS, the outbound half.
 *
 * Builds zips of label photographs ready to upload to a chat, each
 * image named after its row id and each zip carrying the prompt to
 * paste above it.
 *
 * NO API KEY, by maintainer decision (2026-08-30). The reading happens
 * in a chat window a person is already paying for, so nothing metered
 * sits behind the Cloudflare Free plan and OPS-SPEND-GUARD's wall
 * still holds.
 *
 * EVERY PACK IS BOTH A DIRECTORY AND A ZIP. The directory is the cheap
 * path: point a session on this machine at it and there is no upload,
 * no drag, and no per-message image cap. The zip is the fallback for a
 * browser chat — and note that claude.ai does not unpack a zip into the
 * vision path, so there it is still unzip-then-drag.
 *
 * BATCHED at 10, because chat interfaces cap images per message and 10
 * is under every client's cap rather than at claude.ai's. A pack that
 * exceeds the cap fails halfway through an upload, which is the worst
 * moment to discover it. The directory path has no cap at all, so the
 * batch size only ever costs a browser upload.
 *
 * EACH PACK CARRIES ITS OWN INSTRUCTIONS — the task, the ids, and the
 * clause forbidding a reader from opening the ground truth that sits
 * two directories away. The no-upload path is cheaper in every way
 * except that one, and the answer sheet is now on the same disk.
 *
 * IT NEVER TOUCHES THE DATABASE. A spike measures; promoting a reading
 * into the store is the decision the measurement exists to inform, and
 * a test asserts this file cannot reach sqlite.
 *
 * Usage:
 *   node tools/photo-pack.mjs [--photos data/label-photos]
 *                             [--out data/photo-packs] [--batch 10]   (records)
 *                             [--max-images 20]
 *                             [--ids data/label-photos/row-ids.csv]
 *                             [--long-edge 1568]
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { readCsv } from './lib/csv.mjs';
import { chatPrompt, packInstructions, readAllInstructions } from './lib/photo-fields.mjs';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const photoDir = argOf('--photos', 'data/label-photos');
const outDir = argOf('--out', 'data/photo-packs');
const batchSize = Number(argOf('--batch', '10'));
const maxImages = Number(argOf('--max-images', '20'));
const idsPath = argOf('--ids', join(photoDir, 'row-ids.csv'));
const longEdge = Number(argOf('--long-edge', '1568'));

const IMAGE = /^\.(jpe?g|png|webp)$/i;
const truthPath = join(photoDir, 'ground-truth.csv');

if (!existsSync(photoDir)) {
  console.error(`No photo directory at ${photoDir}.`);
  console.error('See data/label-photos/README.md.');
  process.exit(2);
}

const photos = readdirSync(photoDir).filter((f) => IMAGE.test(extname(f))).sort();
if (!photos.length) {
  console.error(`No images in ${photoDir}.`);
  process.exit(2);
}

/**
 * Row ids come from a mapping file when one exists — that is how a
 * photo ties back to an item already in the store — and from the
 * filename otherwise, which is enough for the spike.
 */
const mapped = existsSync(idsPath)
  ? new Map(readCsv(readFileSync(idsPath, 'utf8')).map((r) => [r.file, (r.row_id ?? '').trim()]))
  : new Map();

const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * A record is one row however many photographs it took.
 *
 * With a mapping file, several files sharing a row id is the point —
 * `448-1.jpg` and `448-2.jpg` are the label and the sleeve of record
 * 448. Without one, the id falls back to the filename stem and a
 * collision is still a fault: two unrelated photographs silently
 * merged into one record is exactly the misattribution the ids exist
 * to prevent.
 */
const rows = photos.map((file) => ({
  file,
  rowId: safe(mapped.get(file) || basename(file, extname(file))),
}));

const byId = new Map();
for (const r of rows) {
  if (!r.rowId) { console.error(`${r.file} has no usable row id.`); process.exit(2); }
  if (!mapped.size && byId.has(r.rowId)) {
    console.error(`Row id "${r.rowId}" is used by both ${byId.get(r.rowId)[0]} and ${r.file}.`);
    console.error(`Give them distinct ids in ${idsPath} (columns: file,row_id).`);
    process.exit(2);
  }
  byId.set(r.rowId, [...(byId.get(r.rowId) ?? []), r.file]);
}

/** Records, in id order, each with the files that show it. */
const records = [...byId.entries()].map(([rowId, files]) => ({ rowId, files }));

/**
 * Clear the packs, KEEP the replies.
 *
 * `reply-NN.txt` now lands in this directory, because that is where the
 * instructions tell a reader to write it. Wiping the whole directory on
 * a re-pack — which is what this used to do, back when a pack was only
 * ever a zip — would silently destroy readings already collected. The
 * cost of re-reading twenty labels is not the upload; it is doing the
 * reading again.
 */
mkdirSync(outDir, { recursive: true });
for (const entry of readdirSync(outDir)) {
  if (/^pack-\d+(\.zip)?$/.test(entry) || entry === 'row-ids.csv') {
    rmSync(join(outDir, entry), { recursive: true, force: true });
  }
}

/**
 * Batched by record, and capped by image count as well.
 *
 * A record's photographs are never split: asking a reader to describe
 * half a disc and call it whole is the misattribution the row ids exist
 * to prevent. But records-only batching ignored how many images that
 * came to — eighteen records of five or twelve photographs each made a
 * pack of 53, which is far past any chat's per-message limit and would
 * fail halfway through an upload.
 *
 * So a batch closes when EITHER cap would be exceeded, and a single
 * record larger than the image cap still gets its own pack whole. The
 * caps bound a browser upload; reading a pack in place has no limit at
 * all, which is the cheaper path anyway.
 */
const batches = [];
let batch = [];
let images = 0;
for (const rec of records) {
  const wouldExceed = batch.length >= batchSize || (images + rec.files.length > maxImages && batch.length);
  if (wouldExceed) { batches.push(batch); batch = []; images = 0; }
  batch.push(rec);
  images += rec.files.length;
}
if (batch.length) batches.push(batch);

const pad = (n) => String(n).padStart(2, '0');
/** What each pack turned out to hold, for the covering instruction. */
const built = [];
for (const [i, batch] of batches.entries()) {
  const name = `pack-${pad(i + 1)}`;
  const stage = join(outDir, name);
  mkdirSync(stage, { recursive: true });

  for (const { rowId, files } of batch) {
    for (const [n, file] of files.entries()) {
      // Downscale on the way in: a 4 MB phone frame uploads slowly and
      // buys nothing, since every chat resizes before the model sees it.
      // Named `<rowId>-<n>` so the reader can see which shots belong
      // together without being told twice.
      const name = files.length > 1 ? `${rowId}-${n + 1}.jpg` : `${rowId}.jpg`;
      execFileSync('sips', ['-Z', String(longEdge), join(photoDir, file), '--out', join(stage, name)],
        { stdio: 'ignore' });
    }
  }

  const ids = batch.map((b) => ({ rowId: b.rowId, photos: b.files.length }));
  const replyPath = join(outDir, `reply-${pad(i + 1)}.txt`);

  // Two files, one contract. PROMPT.txt is what you paste into a
  // browser chat; READ-THIS-FIRST.md is what a session finds when it is
  // handed the directory. The second embeds the first verbatim rather
  // than restating it, because two statements of one contract drift and
  // the copy that drifts is always the one nothing tests.
  writeFileSync(join(stage, 'PROMPT.txt'), `${chatPrompt(ids)}\n`);
  writeFileSync(join(stage, 'READ-THIS-FIRST.md'), `${packInstructions(ids, name, replyPath)}\n`);
  writeFileSync(join(stage, 'manifest.csv'),
    `row_id,original_file\n${batch.flatMap((b) => b.files.map((f) => `${b.rowId},${f}`)).join('\n')}\n`);

  execFileSync('zip', ['-q', '-r', `${name}.zip`, name], { cwd: outDir });
  // The directory STAYS. It is the no-upload path, and deleting it
  // would leave the zip as the only way in — which is the expensive way.
  const shots = batch.reduce((n, b) => n + b.files.length, 0);
  built.push({ name, records: batch.length, images: shots, reply: `reply-${pad(i + 1)}.txt` });
  console.log(`${name}/ and ${name}.zip — ${batch.length} record(s), ${shots} image(s): `
    + `${batch.map((b) => b.rowId).join(', ')}`);
}

// One instruction covering every pack, because the work is the whole
// set and six prompts is six chances to stop after the first.
writeFileSync(join(outDir, 'READ-ALL.md'),
  `${readAllInstructions(built, outDir)}\n`);

writeFileSync(join(outDir, 'row-ids.csv'),
  `row_id,original_file\n${rows.map((r) => `${r.rowId},${r.file}`).join('\n')}\n`);

console.log(`\n${batches.length} pack(s) in ${outDir}: ${records.length} record(s), `
  + `${rows.length} photograph(s).`);
console.log('\nCheapest path — no upload. In a session that has NOT seen');
console.log(`${truthPath}, say:`);
console.log(`\n  Read ${join(outDir, 'READ-ALL.md')} and do what it says.`);
console.log('\nThat one file covers every pack. Pointing at a single pack reads');
console.log('that pack and stops, which is what it was asked for.');
console.log('\nBrowser chat instead: unzip a pack, drag the images in, paste');
console.log('PROMPT.txt above them, save the reply. Either way, then:');
console.log('\n  node tools/photo-import.mjs data/photo-packs/reply-01.txt');
