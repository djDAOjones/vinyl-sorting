// @ts-check
/**
 * M0-MERGE-LOAD-FILES — 83 usable rows, de-duplicated against what is
 * already imported.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dedupeKey } from '../lib/import/load-files.mjs';

test('the dedupe key folds case, spacing and Unicode dashes', () => {
  assert.equal(dedupeKey('two-269', 'emi'), dedupeKey('TWO-269', 'EMI'));
  assert.equal(dedupeKey('TWO‑269', 'EMI'), dedupeKey('TWO-269', 'EMI'), 'U+2011 must compare equal to a hyphen');
  assert.equal(dedupeKey('MFP  2034', ''), dedupeKey('MFP 2034', ''));
  assert.equal(dedupeKey(' CFP 187 ', ''), dedupeKey('CFP 187', ''));
});

test('the key separates label from catalogue number, so they cannot swap', () => {
  assert.notEqual(dedupeKey('EMI', 'CFP 187'), dedupeKey('CFP 187', 'EMI'));
});

test('a label difference makes two rows distinct', () => {
  assert.notEqual(dedupeKey('SPA 105', 'Decca'), dedupeKey('SPA 105', ''));
});

const archive = 'Pre August 2026';

test('the 83 usable rows are already present — 0 merged, 83 duplicates', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { rows, stats, mergeDecisions } = buildDataset(archive);
  const s = stats['M0-MERGE-LOAD-FILES'];

  assert.equal(s.sheetRows, 711, '374 + 337 rows across the two load files');
  assert.equal(s.usable, 83, '37 + 46 under the placeholder rule');
  assert.equal(s.duplicates, 83);
  assert.equal(s.merged, 0);
  assert.equal(s.ambiguous, 0);

  // The dataset is unchanged by the merge.
  assert.equal(rows.length, 446);
  assert.equal(rows.filter((r) => r.import_batch === 'M0-MERGE-LOAD-FILES').length, 0);
  assert.equal(mergeDecisions.length, 83, 'every usable row records a decision');
});

test('every duplicate decision names the row it matched', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { rows, mergeDecisions } = buildDataset(archive);
  const byId = new Map(rows.map((r) => [r.item_id, r]));

  const dupes = mergeDecisions.filter((d) => d.decision === 'duplicate-dropped');
  assert.equal(dupes.length, 83);
  for (const d of dupes) {
    assert.ok(byId.has(d.matchedItemId), `${d.sourceFile} row ${d.sourceRowId} names a missing match`);
    assert.ok(d.key, 'a decision without a key could not be audited');
  }
});

test('repeated pressings are absorbed one for one, not collapsed', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { rows, mergeDecisions } = buildDataset(archive);

  // "RTL2075 MCPS" is four separate physical copies in the backlog.
  const key = dedupeKey('RTL2075 MCPS', '');
  const inDataset = rows.filter((r) => dedupeKey(r.catno_raw, r.label_raw) === key);
  const decided = mergeDecisions.filter((d) => d.key === key);

  assert.equal(inDataset.length, 4, 'four copies survive in the dataset');
  assert.equal(decided.length, 4, 'four incoming rows were decided');
  assert.equal(new Set(decided.map((d) => d.matchedItemId)).size, 4,
    'each incoming row matched a different existing copy, not the same one four times');
});

test('duplicates match the backlog rows, not the enriched ones', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { rows, mergeDecisions } = buildDataset(archive);
  const byId = new Map(rows.map((r) => [r.item_id, r]));
  for (const d of mergeDecisions.filter((x) => x.decision === 'duplicate-dropped')) {
    assert.equal(byId.get(d.matchedItemId)?.import_batch, 'M0-IMPORT-REMEDIAL',
      'the load files were already folded into the Remedial sheet');
  }
});
