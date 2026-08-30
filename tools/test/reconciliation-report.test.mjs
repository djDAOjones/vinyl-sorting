// @ts-check
/**
 * M0-RECONCILIATION-REPORT — the done-when is that both files exist and
 * their counts reconcile against the frozen manifest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const CSV = 'data/deep-groove-v1.csv';
const REPORT = 'data/reconciliation-report.md';
const MANIFEST = 'data/archive-manifest.json';
const archive = 'Pre August 2026';

test('both M0 artefacts exist — the acceptance criterion', () => {
  assert.ok(existsSync(CSV), 'the reconciled CSV is missing');
  assert.ok(existsSync(REPORT), 'the reconciliation report is missing');
});

/** Count CSV records, honouring the newlines inside quoted track listings. */
function countRecords(text) {
  let n = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (c === '\n' && !quoted) n++;
  }
  return n - 1; // header
}

const summaryOf = (/** @type {string} */ md) => {
  const m = /```json\n([\s\S]*?)\n```/.exec(md);
  assert.ok(m, 'the report carries no machine-readable summary');
  return JSON.parse(m[1]);
};

test('the report quotes digests that match the frozen manifest', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const md = readFileSync(REPORT, 'utf8');
  const byPath = new Map(manifest.files.map((/** @type {any} */ f) => [f.path, f]));

  const quoted = [...md.matchAll(/^\| `([^`]+\.(?:xlsx|csv))` \| [^|]*\| `([0-9a-f]{12})…` \|/gm)];
  assert.ok(quoted.length >= 5, `expected every input read to quote a digest, found ${quoted.length}`);
  for (const [, path, prefix] of quoted) {
    const entry = byPath.get(path);
    assert.ok(entry, `${path} is quoted by the report but absent from the manifest`);
    assert.ok(entry.sha256.startsWith(prefix), `${path}: report digest does not match the manifest`);
  }
});

test('the report counts equal a fresh build from the frozen inputs', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { rows, stats, droppedIds } = buildDataset(archive);
  const s = summaryOf(readFileSync(REPORT, 'utf8'));

  assert.equal(s.datasetRows, rows.length);
  assert.equal(s.byBatch['M0-IMPORT-ENRICHED'], stats['M0-IMPORT-ENRICHED'].rows);
  assert.equal(s.byBatch['M0-IMPORT-REMEDIAL'], stats['M0-IMPORT-REMEDIAL'].imported);
  assert.equal(s.byBatch['M0-MERGE-LOAD-FILES'], stats['M0-MERGE-LOAD-FILES'].merged);
  assert.equal(s.dropped.remedialPlaceholders, droppedIds['M0-IMPORT-REMEDIAL'].length);
  assert.equal(s.dropped.loadFileDuplicates, stats['M0-MERGE-LOAD-FILES'].duplicates);
  assert.deepEqual(s.splitOutcomes, stats['M0-IMPORT-REMEDIAL'].splitOutcomes);
  assert.equal(s.decisionEligibleRows, 0);
});

test('the CSV on disk holds exactly the rows the report describes', () => {
  const s = summaryOf(readFileSync(REPORT, 'utf8'));
  assert.equal(countRecords(readFileSync(CSV, 'utf8')), s.datasetRows);
});

test('every source row is either imported, dropped or explained', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { stats } = buildDataset(archive);
  const e = stats['M0-IMPORT-ENRICHED'], r = stats['M0-IMPORT-REMEDIAL'], l = stats['M0-MERGE-LOAD-FILES'];

  assert.equal(r.imported + r.droppedPlaceholders, r.sheetRows, 'the Remedial sheet balances');
  const loadPlaceholders = l.sheetRows - l.usable;
  assert.equal(l.merged + l.duplicates + l.ambiguous + loadPlaceholders, l.sheetRows, 'the load files balance');
  assert.equal(e.discogsFound + e.discogsNotFound, e.rows, 'the enriched sheet balances');
});

test('the report lists every dropped ID, so no row vanishes unaccounted', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { droppedIds } = buildDataset(archive);
  const md = readFileSync(REPORT, 'utf8');
  // Take the section up to the next heading and read every bare
  // numeric token out of it, so the assertion does not depend on which
  // paragraph the list happens to occupy.
  const section = (md.split('## Dropped placeholder IDs')[1] ?? '').split('\n## ')[0];
  const listed = section.split(/[,\s]+/).map((t) => t.trim())
    .filter((t) => /^\d+$/.test(t) && t.length >= 4);

  assert.equal(listed.length, 210);
  assert.deepEqual(new Set(listed), new Set(droppedIds['M0-IMPORT-REMEDIAL']));
});

test('the report records a decision for every load-file row it considered', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { mergeDecisions, stats } = buildDataset(archive);
  assert.equal(mergeDecisions.length, stats['M0-MERGE-LOAD-FILES'].usable);
  const md = readFileSync(REPORT, 'utf8');
  assert.ok(md.includes(`## Duplicate decisions (${mergeDecisions.length})`));
});

test('the report states the rules, not just the numbers', () => {
  const md = readFileSync(REPORT, 'utf8');
  for (const rule of [
    'no value in any column other than ID',
    'with multiplicity',
    'A wrong label is worse than an absent one',
    'There are no AI ratings',
    'Expect these totals to move',
  ]) {
    assert.ok(md.includes(rule), `the report should state: ${rule}`);
  }
});
