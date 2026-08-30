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
 * BATCHED, because chat interfaces cap images per message — claude.ai
 * takes 20 per turn, and other clients are lower. A pack that exceeds
 * the cap fails halfway through an upload, which is the worst moment
 * to discover it.
 *
 * IT NEVER TOUCHES THE DATABASE. A spike measures; promoting a reading
 * into the store is the decision the measurement exists to inform, and
 * a test asserts this file cannot reach sqlite.
 *
 * Usage:
 *   node tools/photo-pack.mjs [--photos data/label-photos]
 *                             [--out data/photo-packs] [--batch 20]
 *                             [--ids data/label-photos/row-ids.csv]
 *                             [--long-edge 1568]
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { readCsv } from './lib/csv.mjs';
import { chatPrompt } from './lib/photo-fields.mjs';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const photoDir = argOf('--photos', 'data/label-photos');
const outDir = argOf('--out', 'data/photo-packs');
const batchSize = Number(argOf('--batch', '20'));
const idsPath = argOf('--ids', join(photoDir, 'row-ids.csv'));
const longEdge = Number(argOf('--long-edge', '1568'));

const IMAGE = /^\.(jpe?g|png|webp)$/i;

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
const rows = photos.map((file) => ({
  file,
  rowId: safe(mapped.get(file) || basename(file, extname(file))),
}));

// A duplicate id would attribute two records to one row, silently.
const byId = new Map();
for (const r of rows) {
  if (!r.rowId) { console.error(`${r.file} has no usable row id.`); process.exit(2); }
  if (byId.has(r.rowId)) {
    console.error(`Row id "${r.rowId}" is used by both ${byId.get(r.rowId)} and ${r.file}.`);
    console.error(`Give them distinct ids in ${idsPath} (columns: file,row_id).`);
    process.exit(2);
  }
  byId.set(r.rowId, r.file);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const batches = [];
for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));

const pad = (n) => String(n).padStart(2, '0');
for (const [i, batch] of batches.entries()) {
  const name = `pack-${pad(i + 1)}`;
  const stage = join(outDir, name);
  mkdirSync(stage, { recursive: true });

  for (const { file, rowId } of batch) {
    // Downscale on the way in: a 4 MB phone frame uploads slowly and
    // buys nothing, since every chat resizes before the model sees it.
    execFileSync('sips', ['-Z', String(longEdge), join(photoDir, file), '--out', join(stage, `${rowId}.jpg`)],
      { stdio: 'ignore' });
  }

  writeFileSync(join(stage, 'PROMPT.txt'), `${chatPrompt(batch.map((b) => b.rowId))}\n`);
  writeFileSync(join(stage, 'manifest.csv'),
    `row_id,original_file\n${batch.map((b) => `${b.rowId},${b.file}`).join('\n')}\n`);

  execFileSync('zip', ['-q', '-r', `${name}.zip`, name], { cwd: outDir });
  rmSync(stage, { recursive: true, force: true });
  console.log(`${name}.zip — ${batch.length} image(s): ${batch.map((b) => b.rowId).join(', ')}`);
}

writeFileSync(join(outDir, 'row-ids.csv'),
  `row_id,original_file\n${rows.map((r) => `${r.rowId},${r.file}`).join('\n')}\n`);

console.log(`\n${batches.length} pack(s) in ${outDir}, ${rows.length} photo(s) total.`);
console.log('\nFor each pack: unzip it, upload the images to the chat, paste PROMPT.txt');
console.log('above them, and save the reply as a .txt file. Then:');
console.log('\n  node tools/photo-import.mjs data/photo-packs/reply-01.txt');
