// @ts-check
/**
 * M0-IMPORT-AI-WORKS — the done-when is that every AI-derived value
 * carries guess provenance AND a query for decision-eligible values
 * returns none of them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { SOURCED_FIELDS, makeRow, rowIsDecisionEligible } from '../lib/dataset.mjs';

const AI_FIELDS = SOURCED_FIELDS.filter((f) => f.startsWith('ai_'));

test('a guessed value cannot feed a decision even when confirmed', () => {
  for (const field of AI_FIELDS) {
    const row = makeRow({ item_id: 'X', [field]: 'something', [`${field}_source`]: 'guess', confirmed: 'yes' });
    assert.equal(rowIsDecisionEligible(row), false, `${field} became eligible`);
    assert.equal(row.decision_eligible, 'no');
  }
});

test('a guessed value beside a confirmed sourced value does not contaminate it', () => {
  const row = makeRow({
    item_id: 'X',
    title: 'Symphony No. 5', title_source: 'shelf',
    ai_remarks: 'probably the 1962 pressing', ai_remarks_source: 'guess',
    confirmed: 'yes',
  });
  assert.equal(row.decision_eligible, 'yes', 'the shelf-sourced value is eligible');
  assert.equal(row.ai_remarks_source, 'guess', 'the guess stays a guess');
});

const archive = 'Pre August 2026';
const built = async () => {
  const { buildDataset } = await import('../build-dataset.mjs');
  return buildDataset(archive);
};

test('AI values attach to all 305 enriched rows and add no rows', { skip: !existsSync(archive) }, async () => {
  const { rows, stats } = await built();
  const s = stats['M0-IMPORT-AI-WORKS'];
  assert.equal(s.attached, 305);
  assert.equal(s.unmatched, 0, 'every enriched row joined on its source id');
  assert.equal(rows.length, 446, 'the AI pass enriches rows, it never creates them');
});

test('every AI-derived value carries guess provenance — the done-when', { skip: !existsSync(archive) }, async () => {
  const { rows } = await built();
  let values = 0;
  for (const row of rows) {
    for (const field of AI_FIELDS) {
      if (!row[field]) continue;
      values++;
      assert.equal(row[`${field}_source`], 'guess', `${row.item_id}.${field} is not tagged guess`);
    }
  }
  assert.ok(values > 0, 'no AI values were imported at all');
});

test('a query for decision-eligible values returns none of them — the done-when', { skip: !existsSync(archive) }, async () => {
  const { rows } = await built();
  assert.equal(rows.filter((r) => r.decision_eligible === 'yes').length, 0);
  const guessed = rows.flatMap((r) => AI_FIELDS.filter((f) => r[f]).map((f) => ({ r, f })));
  assert.ok(guessed.length > 0);
  for (const { r, f } of guessed) {
    assert.equal(rowIsDecisionEligible({ ...r, [`${f}_source`]: 'guess' }), false);
  }
});

test('AI values never attach to rows the AI pass never covered', { skip: !existsSync(archive) }, async () => {
  const { rows } = await built();
  for (const row of rows.filter((r) => r.import_batch !== 'M0-IMPORT-ENRICHED')) {
    for (const field of AI_FIELDS) assert.equal(row[field], '', `${row.item_id}.${field} should be empty`);
  }
});

test('the AI ratings the brief warns about were never written', { skip: !existsSync(archive) }, async () => {
  const { rows, stats } = await built();
  assert.equal(stats['M0-IMPORT-AI-WORKS'].ratingsFound, 0);
  assert.equal(rows.filter((r) => r.ai_rating).length, 0,
    'Critical Rating is empty in every AI Works file, including "Rating Qualifiers etc"');
  // Track listings, by contrast, are all there.
  assert.equal(stats['M0-IMPORT-AI-WORKS'].trackListingsFound, 305);
  assert.equal(rows.filter((r) => r.ai_track_listing).length, 305);
});

test('AI prose found in the enriched sheet is reclassified from legacy to guess', { skip: !existsSync(archive) }, async () => {
  const { rows, stats } = await built();
  assert.equal(stats['M0-IMPORT-AI-WORKS'].reclassifiedToGuess, 28);

  // Exactly the rows where Discogs found nothing.
  const reclassified = rows.filter((r) => r.track_listing_source === 'guess');
  assert.equal(reclassified.length, 28);
  assert.ok(reclassified.every((r) => r.discogs_found === 'no'),
    'only the unmatched rows carry AI-authored track listings');

  // And the matched rows keep their Discogs provenance.
  assert.equal(rows.filter((r) => r.track_listing_source === 'discogs').length, 277);
});

test('the v2 override was applied and agreed with v1 on every row', { skip: !existsSync(archive) }, async () => {
  const { rows, stats } = await built();
  const s = stats['M0-IMPORT-AI-WORKS'];
  assert.equal(s.v2Agreements, 305);
  assert.equal(s.v2Overrides, 0, 'v2 and v1 Stage 8 agree, so the override changed nothing');
  assert.ok(rows.filter((r) => r.ai_track_listing_origin).every((r) => r.ai_track_listing_origin === 'v1-stage-8=v2'));
});
