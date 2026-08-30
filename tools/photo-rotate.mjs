#!/usr/bin/env node
// @ts-check

/**
 * photo-rotate.mjs — stand turned photographs upright.
 *
 * Reads the rotations a reading reported and applies them, so a batch
 * that arrived sideways can be corrected and read again rather than
 * re-photographed. Correcting is cheap; walking back to the crate is
 * not, and the disc has already been handled once.
 *
 * IT ROTATES ONLY WHAT THE READER ASKED FOR. Nothing here detects an
 * angle — detection was deliberately not built, because a reading
 * already reports one and a heuristic that disagreed with it would give
 * two answers and no way to choose.
 *
 * IT NEVER TOUCHES THE DATABASE, and a test asserts it cannot.
 *
 * IT IS IDEMPOTENT BY LEDGER, not by inspection. A rotated JPEG looks
 * exactly like one that was always upright, so re-running against the
 * same reading would turn a corrected photograph a second time. Every
 * applied rotation is recorded, and an already-applied one is skipped.
 *
 * Usage:
 *   node tools/photo-rotate.mjs [--extract data/photo-extract.json]
 *                               [--photos data/label-photos] [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, basename } from 'node:path';
import { ROTATIONS } from './lib/photo-fields.mjs';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const extractPath = argOf('--extract', 'data/photo-extract.json');
const photoDir = argOf('--photos', 'data/label-photos');
const ledgerPath = join(photoDir, 'rotations-applied.json');
const dryRun = args.includes('--dry-run');

if (!existsSync(extractPath)) {
  console.error(`No reading at ${extractPath} — import one first:`);
  console.error('  node tools/photo-import.mjs data/photo-packs/reply-01.txt');
  process.exit(2);
}

const run = JSON.parse(readFileSync(extractPath, 'utf8'));
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};

const IMAGE = /^\.(jpe?g|png|webp)$/i;
/** Every file that belongs to a row: `448.jpg`, or `448-1.jpg` and kin. */
const filesFor = (rowId) => readdirSync(photoDir)
  .filter((f) => IMAGE.test(extname(f)))
  .filter((f) => {
    const stem = basename(f, extname(f));
    return stem === rowId || stem.startsWith(`${rowId}-`);
  })
  .sort();

let turned = 0;
let skipped = 0;
const problems = [];

for (const [rowId, result] of Object.entries(run.results ?? {})) {
  const deg = Number(result?.fields?.rotate_cw ?? 0) || 0;
  if (!deg) continue;
  if (!ROTATIONS.includes(deg)) {
    problems.push(`${rowId}: ${deg}° is not one of ${ROTATIONS.join(', ')} — skipped`);
    continue;
  }

  const files = filesFor(rowId);
  if (!files.length) { problems.push(`${rowId}: no image on disk`); continue; }

  for (const file of files) {
    // The ledger, not the pixels, is what makes this safe to re-run:
    // a corrected photograph is indistinguishable from one that was
    // always upright.
    if (ledger[file]) { skipped += 1; continue; }
    console.log(`  ${file} — ${deg}° clockwise`);
    if (!dryRun) {
      // `sips -r` turns clockwise, which is the same direction the
      // reading reports, so the number passes straight through.
      execFileSync('sips', ['-r', String(deg), join(photoDir, file)], { stdio: 'ignore' });
      ledger[file] = { deg, rowId };
    }
    turned += 1;
  }
}

if (!dryRun && turned) writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(`\n${turned} image(s) ${dryRun ? 'would be' : ''} turned upright.`);
if (skipped) console.log(`${skipped} already corrected by an earlier run, left alone.`);
if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log(`  ${p}`);
}
if (turned && !dryRun) {
  console.log('\nRe-pack and read those rows again — the reading you have describes');
  console.log('the photographs as they were, not as they now are:');
  console.log('\n  node tools/photo-pack.mjs');
}
