// @ts-check
/**
 * M0-SPLIT-LABEL-CATNO — the governing rule is that a wrong label is
 * worse than an absent one, so most of these tests assert a REFUSAL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildGazetteer, splitLabelCatno } from '../lib/split-label-catno.mjs';

/** A miniature gazetteer standing in for the 98 attested labels. */
const GAZ = buildGazetteer([
  'EMI', 'EMI Eminence', 'CBS', 'Decca', 'Philips', 'Saga (5)', 'VOX (6)',
  'World Record Club', 'Classics For Pleasure', 'Music For Pleasure',
  'Fidelio', 'Concert Hall', 'Marble Arch', 'Deutsche Grammophon',
  'Supraphon', 'RCA', 'PS (9)',
]);

const split = (/** @type {string} */ s) => splitLabelCatno(s, GAZ);

test('gazetteer strips Discogs disambiguation suffixes', () => {
  assert.ok(GAZ.includes('Saga'), '"Saga (5)" should be usable as "Saga"');
  assert.ok(GAZ.includes('VOX'));
});

test('gazetteer drops two-character labels that collide with catalogue prefixes', () => {
  // "PS" is an attested label AND the prefix of PS 287 and PS5032.
  assert.ok(!GAZ.includes('PS'), 'a 2-char label would split real catalogue numbers in half');
  assert.equal(split('PS5032').outcome, 'bare-catno');
  assert.equal(split('PS5032').labelRaw, '');
});

test('longest attested label wins, so a sub-label is not silently downgraded', () => {
  const r = split('EMI Eminence EMX 2096 (UK)');
  assert.equal(r.labelRaw, 'EMI Eminence');
  assert.equal(r.catnoRaw, 'EMX 2096');
  assert.equal(r.qualifierRaw, 'UK');
});

test('a label prefix followed by a well-formed catalogue number splits', () => {
  for (const [input, label, catno] of /** @type {[string,string,string][]} */ ([
    ['Philips 6308 177 (UK)', 'Philips', '6308 177'],
    ['Decca SPA 315 (UK)', 'Decca', 'SPA 315'],
    ['World Record Club T 30 (UK)', 'World Record Club', 'T 30'],
    ['Deutsche Grammophon 139 420', 'Deutsche Grammophon', '139 420'],
    ['CBS 73045', 'CBS', '73045'],
  ])) {
    const r = split(input);
    assert.equal(r.outcome, 'split', input);
    assert.equal(r.labelRaw, label, input);
    assert.equal(r.catnoRaw, catno, input);
  }
});

test('the label may sit in a trailing parenthetical — the load-file shape', () => {
  const r = split('W-5828 (World Record Club, Tuxen)');
  assert.equal(r.outcome, 'split');
  assert.equal(r.labelRaw, 'World Record Club');
  assert.equal(r.catnoRaw, 'W-5828');
});

test('label casing is normalised to the attested form, not the input', () => {
  assert.equal(split('CFP-160 (Classics for Pleasure, Pritchard)').labelRaw, 'Classics For Pleasure');
});

test('an unattested sub-label is refused rather than truncated to its parent', () => {
  // "Decca" alone is a label this pressing does not carry; emitting it
  // would corroborate a match against the wrong Decca release.
  for (const input of [
    'Decca Ace of Diamonds SDD 538 (UK)',
    'CBS Harmony 30001 (NL)',
    'Philips Fontana SFL 14033 (NL)',
  ]) {
    const r = split(input);
    assert.equal(r.outcome, 'refused', input);
    assert.equal(r.labelRaw, '', `${input} must not emit a partial label`);
    assert.equal(r.reason, 'unattested-sub-label', input);
  }
});

test('two pressings in one cell are refused, never split across each other', () => {
  for (const input of [
    'London (UK) PS 287 / Mono: LL 3287',
    'RCA Red Seal LSC-7054 (US); later RL 42057',
    'CBS [SMSA 2408] (US)',
  ]) {
    const r = split(input);
    assert.equal(r.outcome, 'refused', input);
    assert.equal(r.reason, 'multiple-issues', input);
    assert.equal(r.labelRaw, '');
  }
});

test('a label this collection has never attested is refused, not invented', () => {
  const r = split('Urania URLP 899 (US)');
  assert.equal(r.outcome, 'refused');
  assert.equal(r.reason, 'no-attested-label');
  assert.equal(r.labelRaw, '');
});

test('a bare catalogue number is complete, not a failure', () => {
  const r = split('MFP 2034');
  assert.equal(r.outcome, 'bare-catno');
  assert.equal(r.catnoRaw, 'MFP 2034');
  assert.equal(r.labelRaw, '');
  assert.equal(r.reason, 'no-label-present');
});

test('qualifiers are peeled off in order and kept, not discarded', () => {
  const r = split('Marble Arch MALS 368 (UK) (est.)');
  assert.equal(r.labelRaw, 'Marble Arch');
  assert.equal(r.catnoRaw, 'MALS 368');
  assert.equal(r.qualifierRaw, 'UK; est.');
});

test('no outcome ever loses the input — combinedRaw round-trips', () => {
  for (const input of [
    'Philips 6308 177 (UK)', 'CBS Harmony 30001 (NL)', 'MFP 2034',
    'London (UK) PS 287 / Mono: LL 3287', 'Urania URLP 899 (US)',
  ]) {
    assert.equal(split(input).combinedRaw, input);
  }
});

test('every result carries both fields, so no row is left half-shaped', () => {
  for (const input of ['Philips 6308 177 (UK)', 'MFP 2034', 'CBS [SMSA 2408]', '']) {
    const r = split(input);
    assert.equal(typeof r.catnoRaw, 'string');
    assert.equal(typeof r.labelRaw, 'string');
    assert.ok(['split', 'bare-catno', 'refused'].includes(r.outcome));
  }
});

// Archive-backed: the counts the reconciliation report will quote.
const archive = 'Pre August 2026';
test('the 141 backlog rows split into the counts M0 reports', { skip: !existsSync(archive) }, async () => {
  const { readWorkbook, withHeaders } = await import('../lib/xlsx.mjs');
  const { repairText } = await import('../lib/text-repair.mjs');
  const wb = readWorkbook(`${archive}/Vinyl Records Record 2 Jen.xlsx`);
  const gaz = buildGazetteer(withHeaders(wb.sheets['Classical Master']).records
    .map((r) => repairText(r['Label'] ?? '')).filter(Boolean));
  assert.equal(gaz.length, 98, 'attested label vocabulary changed');

  const backlog = withHeaders(wb.sheets['Classical Remedial']).records
    .filter((r) => Object.keys(r).some((k) => k !== 'ID'));
  assert.equal(backlog.length, 141);

  /** @type {Record<string, number>} */ const tally = {};
  for (const row of backlog) {
    const r = splitLabelCatno(repairText(row['Catalogue #'] ?? ''), gaz);
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    assert.equal(r.combinedRaw, repairText(row['Catalogue #'] ?? ''));
  }
  assert.deepEqual(tally, { split: 31, refused: 37, 'bare-catno': 73 });
});
