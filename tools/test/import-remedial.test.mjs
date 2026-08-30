// @ts-check
/**
 * M0-IMPORT-REMEDIAL — 141 rows needing capture, 210 placeholders
 * dropped and accounted for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { isPlaceholder } from '../lib/import/remedial.mjs';

test('the placeholder rule is mechanical: nothing beyond ID', () => {
  assert.equal(isPlaceholder({ ID: '1141' }), true);
  assert.equal(isPlaceholder({ ID: '1141', Title: '' }), true, 'blank strings do not make a row real');
  assert.equal(isPlaceholder({ ID: '1141', Title: '   ' }), true, 'whitespace does not make a row real');
  assert.equal(isPlaceholder({ ID: '1000', Composer: 'J.S. Bach' }), false);
  assert.equal(isPlaceholder({ ID: '1000', 'Catalogue #': 'PA172' }), false);
});

test('a row with no ID but some content is still real', () => {
  assert.equal(isPlaceholder({ Title: 'Untitled' }), false);
});

const archive = 'Pre August 2026';
const load = async () => {
  const { importEnriched } = await import('../lib/import/enriched.mjs');
  const { importRemedial } = await import('../lib/import/remedial.mjs');
  const { gazetteer } = importEnriched(archive);
  return importRemedial(archive, gazetteer);
};

test('351 rows partition into 141 imported and 210 dropped', { skip: !existsSync(archive) }, async () => {
  const { rows, droppedIds, stats } = await load();
  assert.equal(stats.sheetRows, 351);
  assert.equal(rows.length, 141);
  assert.equal(droppedIds.length, 210);
  assert.equal(rows.length + droppedIds.length, stats.sheetRows, 'every sheet row is either imported or accounted for');
});

test('every dropped placeholder is named, so the report can audit the rule', { skip: !existsSync(archive) }, async () => {
  const { droppedIds } = await load();
  assert.equal(new Set(droppedIds).size, 210, 'dropped IDs are distinct');
  assert.ok(droppedIds.every((id) => id !== ''), 'a dropped row with no ID could not be audited');
});

test('all 141 arrive needing capture, none decision-eligible', { skip: !existsSync(archive) }, async () => {
  const { rows } = await load();
  assert.ok(rows.every((r) => r.capture_state === 'needs-capture'));
  assert.ok(rows.every((r) => r.decision_eligible === 'no'));
  assert.ok(rows.every((r) => r.confirmed === 'no'));
  assert.ok(rows.every((r) => r.import_batch === 'M0-IMPORT-REMEDIAL'));
});

test('no remedial row carries Discogs provenance — none of them was ever matched', { skip: !existsSync(archive) }, async () => {
  const { rows } = await load();
  for (const r of rows) {
    assert.equal(r.discogs_id, '');
    assert.equal(r.discogs_found, 'no');
    for (const f of ['label_raw', 'catno_raw', 'title', 'composer']) {
      assert.notEqual(r[`${f}_source`], 'discogs', `${f} cannot be discogs-sourced here`);
    }
  }
});

test('the split runs on the backlog and every row keeps its combined string', { skip: !existsSync(archive) }, async () => {
  const { rows, stats } = await load();
  assert.deepEqual(stats.splitOutcomes, { split: 31, refused: 37, 'bare-catno': 73 });
  // A refusal must never emit a label, and must never lose the input.
  for (const r of rows.filter((x) => x.split_outcome === 'refused')) {
    assert.equal(r.label_raw, '', 'a refused split must leave label empty');
    assert.notEqual(r.combined_raw, '', 'a refusal must still keep the original string');
  }
  assert.equal(rows.filter((r) => r.label_raw).length, 31);
});

test('the composed dataset is 446 rows with unbroken sequential ids', { skip: !existsSync(archive) }, async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  const { rows, stats, droppedIds } = buildDataset(archive);

  assert.equal(rows.length, 446, '305 enriched + 141 backlog — the brief\'s "446 already catalogued"');
  assert.equal(stats['M0-IMPORT-ENRICHED'].rows, 305);
  assert.equal(stats['M0-IMPORT-REMEDIAL'].imported, 141);
  assert.equal(droppedIds['M0-IMPORT-REMEDIAL'].length, 210);

  assert.equal(new Set(rows.map((r) => r.item_id)).size, 446, 'item ids are unique');
  assert.equal(rows[0].item_id, 'DG-0001');
  assert.equal(rows[445].item_id, 'DG-0446');
  assert.equal(rows.filter((r) => r.decision_eligible === 'yes').length, 0);
});
