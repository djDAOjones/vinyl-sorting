// @ts-check
/**
 * M0-IMPORT-ENRICHED — 305 rows with Discogs provenance and an
 * unverified confirmation state, so none of them can feed a decision.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { COLUMNS, SOURCED_FIELDS, makeRow, rowIsDecisionEligible, toCsv, valueIsDecisionEligible } from '../lib/dataset.mjs';

test('the provenance rule blocks guess, legacy and unconfirmed discogs', () => {
  for (const source of ['guess', 'legacy']) {
    assert.equal(valueIsDecisionEligible(source, false), false);
    assert.equal(valueIsDecisionEligible(source, true), false, `${source} must stay blocked even if confirmed`);
  }
  assert.equal(valueIsDecisionEligible('discogs', false), false, 'unconfirmed discogs must be blocked');
  assert.equal(valueIsDecisionEligible('discogs', true), true, 'confirmed discogs may feed a decision');
  assert.equal(valueIsDecisionEligible('shelf', true), true);
  assert.equal(valueIsDecisionEligible('shelf', false), false);
});

test('a value with no source is rejected, so provenance cannot be skipped', () => {
  assert.throws(() => makeRow({ item_id: 'X', title: 'Something' }), /has a value with no source/);
});

test('an unknown source is rejected rather than stored', () => {
  assert.throws(() => makeRow({ item_id: 'X', title: 'T', title_source: 'vibes' }), /unknown source/);
});

test('a source with no value is dropped rather than left dangling', () => {
  assert.equal(makeRow({ item_id: 'X', title_source: 'discogs' }).title_source, '');
});

test('decision_eligible is computed, not asserted by the importer', () => {
  assert.equal(makeRow({ item_id: 'X', title: 'T', title_source: 'discogs', confirmed: 'no' }).decision_eligible, 'no');
  assert.equal(makeRow({ item_id: 'X', title: 'T', title_source: 'discogs', confirmed: 'yes' }).decision_eligible, 'yes');
  assert.equal(makeRow({ item_id: 'X', title: 'T', title_source: 'guess', confirmed: 'yes' }).decision_eligible, 'no');
});

test('rows are rectangular — every column present whatever the importer set', () => {
  const row = makeRow({ item_id: 'X' });
  for (const c of COLUMNS) assert.ok(c in row, `${c} missing`);
});

test('CSV quoting survives the newlines and quotes real track listings contain', () => {
  const row = makeRow({
    item_id: 'X',
    track_listing: 'A1 Adagio\nB1 "Romantic", part 2',
    track_listing_source: 'discogs',
  });
  const csv = toCsv([row]);
  assert.ok(csv.includes('"A1 Adagio\nB1 ""Romantic"", part 2"'));
  // Header plus one record, whose embedded newline does not start a row.
  assert.equal(csv.trimEnd().split('\n').length, 3);
});

const archive = 'Pre August 2026';
test('the enriched import produces 305 rows, none decision-eligible', { skip: !existsSync(archive) }, async () => {
  const { importEnriched } = await import('../lib/import/enriched.mjs');
  const { rows, stats, gazetteer } = importEnriched(archive);

  assert.equal(rows.length, 305, 'the enriched sheet holds 305 data rows');
  assert.deepEqual(stats, { rows: 305, discogsFound: 277, discogsNotFound: 28 });
  assert.equal(gazetteer.length, 98);

  // The done-when: every Discogs-derived field is unverified, so a
  // query for decision-eligible values returns none of them.
  assert.equal(rows.filter((r) => r.decision_eligible === 'yes').length, 0);
  assert.ok(rows.every((r) => r.confirmed === 'no'));
});

test('Discogs provenance lands on exactly the 277 matched rows', { skip: !existsSync(archive) }, async () => {
  const { importEnriched } = await import('../lib/import/enriched.mjs');
  const { rows } = importEnriched(archive);

  for (const field of ['label_raw', 'discogs_id', 'musicians', 'track_listing']) {
    assert.equal(rows.filter((r) => r[`${field}_source`] === 'discogs').length, 277,
      `${field} should be discogs-sourced on the 277 matched rows`);
  }
  // Fields filled on all 305 regardless predate the enrichment.
  for (const field of ['composer', 'title', 'catno_raw']) {
    assert.equal(rows.filter((r) => r[`${field}_source`] === 'discogs').length, 0,
      `${field} was not supplied by Discogs`);
  }
  // No Discogs field leaks onto an unmatched row.
  for (const r of rows.filter((x) => x.discogs_found === 'no')) {
    assert.equal(r.label_raw, '');
    assert.equal(r.discogs_id, '');
  }
});

test('legacy confidence labels are carried for audit, never used as confidence', { skip: !existsSync(archive) }, async () => {
  const { importEnriched } = await import('../lib/import/enriched.mjs');
  const { rows } = importEnriched(archive);
  const exact = rows.filter((r) => r.discogs_confidence_legacy === 'Exact');
  assert.equal(exact.length, 236, '"Exact" is a legacy label, not a verdict');
  // 16 of the wrong matches were labelled Exact, so no confidence
  // label may make a row decision-eligible.
  assert.ok(exact.every((r) => r.decision_eligible === 'no'));
  assert.ok(!SOURCED_FIELDS.includes('discogs_confidence_legacy'),
    'the legacy label must not carry provenance as if it were data');
});
