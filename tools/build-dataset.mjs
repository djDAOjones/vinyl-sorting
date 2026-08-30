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
import { importRemedial } from './lib/import/remedial.mjs';

const args = process.argv.slice(2);
const argOf = (/** @type {string} */ n, /** @type {string} */ d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const archive = argOf('--archive', 'Pre August 2026');
const out = argOf('--out', 'data/deep-groove-v1.csv');

/**
 * Import order is fixed, and item_id is allocated here rather than by
 * each importer, so numbering runs unbroken across batches and stays
 * stable as long as the order does.
 * @returns {{rows: Record<string,string>[], stats: Record<string, any>, droppedIds: Record<string, string[]>}}
 */
export function buildDataset(archiveDir = archive) {
  /** @type {Record<string, any>} */ const stats = {};
  /** @type {Record<string, string[]>} */ const droppedIds = {};

  const enriched = importEnriched(archiveDir);
  stats['M0-IMPORT-ENRICHED'] = enriched.stats;

  // The label vocabulary comes from the enriched rows, so every later
  // import splits against labels this collection has actually attested.
  const remedial = importRemedial(archiveDir, enriched.gazetteer);
  stats['M0-IMPORT-REMEDIAL'] = remedial.stats;
  droppedIds['M0-IMPORT-REMEDIAL'] = remedial.droppedIds;

  const rows = [...enriched.rows, ...remedial.rows];
  rows.forEach((r, i) => { r.item_id = `DG-${String(i + 1).padStart(4, '0')}`; });
  return { rows, stats, droppedIds };
}

// pathToFileURL, not string concatenation: this project's path
// contains spaces, which import.meta.url percent-encodes.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rows, stats } = buildDataset();
  writeFileSync(out, toCsv(rows));
  console.log(`build-dataset: wrote ${out} — ${rows.length} rows`);
  for (const [batch, s] of Object.entries(stats)) {
    const flat = Object.entries(s)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
    console.log(`  ${batch}: ${flat}`);
  }
  const eligible = rows.filter((r) => r.decision_eligible === 'yes').length;
  console.log(`  decision-eligible rows: ${eligible} (expected 0 until a person confirms values)`);
}
