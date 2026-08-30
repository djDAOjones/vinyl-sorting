// @ts-check
/** M0-ARCHIVE-FREEZE — the manifest is the fixed starting point every later import cites. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('data/archive-manifest.json', 'utf8'));
const byPath = new Map(manifest.files.map((/** @type {any} */ f) => [f.path, f]));

/** Named in the M0 records as the sources the imports actually read. */
const SOURCES = [
  'Vinyl Records Record 2 Jen.xlsx',
  '1st load to add.xlsx',
  '2nd load to add.xlsx',
  'classical vinyl list in progress.csv',
];

test('every source the M0 imports read is frozen with a digest', () => {
  for (const src of SOURCES) {
    const entry = byPath.get(src);
    assert.ok(entry, `${src} missing from the manifest`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${src} has no usable digest`);
    assert.ok(entry.bytes > 0, `${src} recorded as empty`);
  }
});

test('secrets are listed but never digested into the committed manifest', () => {
  const secrets = manifest.files.filter((/** @type {any} */ f) =>
    manifest.redacted.some((/** @type {string} */ p) => f.path.includes(p)));
  assert.ok(secrets.length > 0, 'expected the archived Discogs token to be listed');
  for (const s of secrets) {
    assert.equal(s.sha256, 'REDACTED-SECRET', `${s.path} leaked a digest`);
  }
});

test('exclusions are declared, so what is absent is auditable', () => {
  assert.ok(manifest.excluded.length > 0);
  for (const e of manifest.excluded) {
    assert.ok(e.pattern && e.why, 'each exclusion states a pattern and a reason');
  }
  const patterns = manifest.excluded.map((/** @type {any} */ e) => e.pattern);
  assert.ok(patterns.includes('.venv/'), 'the 9,106-file venv must be excluded by declaration');
});

test('no manifest entry points outside the archive', () => {
  for (const f of manifest.files) {
    assert.ok(!f.path.startsWith('/') && !f.path.includes('..'), `escaping path: ${f.path}`);
  }
});
