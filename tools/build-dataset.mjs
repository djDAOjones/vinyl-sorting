#!/usr/bin/env node
// @ts-check

/**
 * build-dataset.mjs — composes the M0 imports into the single
 * reconciled dataset.
 *
 * Reads only from the frozen archive and writes only to data/.
 * `Pre August 2026/` is read-only for the life of the project.
 *
 * Grows one importer at a time as the M0 items land; the counts it
 * prints are the counts the reconciliation report quotes.
 *
 * Usage: node tools/build-dataset.mjs [--archive "Pre August 2026"]
 *                                     [--out data/deep-groove-v1.csv]
 */

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { toCsv } from './lib/dataset.mjs';
import { importEnriched } from './lib/import/enriched.mjs';

const args = process.argv.slice(2);
const argOf = (/** @type {string} */ n, /** @type {string} */ d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const archive = argOf('--archive', 'Pre August 2026');
const out = argOf('--out', 'data/deep-groove-v1.csv');

/** @returns {{rows: Record<string,string>[], stats: Record<string, any>}} */
export function buildDataset(archiveDir = archive) {
  /** @type {Record<string, any>} */ const stats = {};
  const enriched = importEnriched(archiveDir);
  stats['M0-IMPORT-ENRICHED'] = enriched.stats;
  return { rows: enriched.rows, stats };
}

// pathToFileURL, not string concatenation: this project's path
// contains spaces, which import.meta.url percent-encodes.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rows, stats } = buildDataset();
  writeFileSync(out, toCsv(rows));
  console.log(`build-dataset: wrote ${out} — ${rows.length} rows`);
  for (const [batch, s] of Object.entries(stats)) {
    console.log(`  ${batch}: ${Object.entries(s).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  const eligible = rows.filter((r) => r.decision_eligible === 'yes').length;
  console.log(`  decision-eligible rows: ${eligible} (expected 0 until a person confirms values)`);
}
