// @ts-check
/**
 * M1-SCHEMA — the four-entity model, and the provenance rule enforced
 * in the query layer rather than by convention.
 *
 * D1 is SQLite, so this exercises the exact SQL wrangler will apply.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { loadDataset } from '../load-dataset.mjs';

const SCHEMA = readFileSync('schema/001-init.sql', 'utf8');
const fresh = () => { const db = new DatabaseSync(':memory:'); db.exec(SCHEMA); return db; };
const one = (/** @type {any} */ db, /** @type {string} */ sql) => db.prepare(sql).get();
const count = (/** @type {any} */ db, /** @type {string} */ t) => Number(one(db, `SELECT COUNT(*) n FROM ${t}`).n);

test('the schema applies clean and records its version', () => {
  const db = fresh();
  assert.equal(Number(one(db, 'SELECT MAX(version) v FROM schema_migration').v), 1);
});

test('genre-neutrality: an item may have a release and no work at all', () => {
  const db = fresh();
  // A house 12" — the brief's own example.
  db.exec("INSERT INTO release (discogs_id, title) VALUES (12345, 'Untitled')");
  db.exec('INSERT INTO item (release_id) VALUES (1)');
  db.exec("INSERT INTO release_track (release_id, position, title) VALUES (1, 'A1', 'Untitled')");
  assert.equal(count(db, 'item'), 1);
  // work_id, performance_id, composer_id all null and legal.
  assert.equal(one(db, 'SELECT work_id FROM release_track').work_id, null);
  db.exec("INSERT INTO work (title) VALUES ('Symphony No. 5')");
  assert.equal(one(db, 'SELECT composer_id FROM work').composer_id, null);
  db.exec('INSERT INTO performance (work_id) VALUES (1)');
  assert.equal(one(db, 'SELECT conductor FROM performance').conductor, null);
});

test('enumerated columns reject values outside their set', () => {
  const db = fresh();
  db.exec('INSERT INTO item DEFAULT VALUES');
  for (const [sql, why] of [
    ["UPDATE item SET media_grade = 'VG++'", 'Goldmine grade'],
    ["UPDATE item SET decision = 'maybe'", 'decision'],
    ["INSERT INTO field_source (entity, entity_id, field, source) VALUES ('item', 1, 'x', 'vibes')", 'source'],
    ["INSERT INTO field_source (entity, entity_id, field, source) VALUES ('nonsense', 1, 'x', 'shelf')", 'entity'],
    ["INSERT INTO item_photo (item_id, kind, r2_key) VALUES (1, 'selfie', 'k')", 'photo kind'],
  ]) {
    assert.throws(() => db.exec(sql), /CHECK constraint failed/, `${why} should be constrained`);
  }
});

test('a confirmation must name who made it', () => {
  const db = fresh();
  db.exec('INSERT INTO item DEFAULT VALUES');
  assert.throws(
    () => db.exec("INSERT INTO field_source (entity, entity_id, field, source, confirmed_at) VALUES ('item',1,'x','shelf','2026-08-30')"),
    /CHECK constraint failed/,
    'an unattributed confirmation is a script marking its own homework');
});

test('provenance is unique per entity, id and field', () => {
  const db = fresh();
  db.exec('INSERT INTO item DEFAULT VALUES');
  db.exec("INSERT INTO field_source (entity, entity_id, field, source) VALUES ('item',1,'release_id','discogs')");
  assert.throws(
    () => db.exec("INSERT INTO field_source (entity, entity_id, field, source) VALUES ('item',1,'release_id','guess')"),
    /UNIQUE constraint failed/);
});

// ── the query layer is the enforcement point ──────────────────────

test('guess and legacy are unreachable through the confirmed view, even if confirmed', () => {
  const db = fresh();
  db.exec('INSERT INTO item DEFAULT VALUES');
  db.exec(`INSERT INTO field_source (entity, entity_id, field, source, confirmed_by, confirmed_at) VALUES
    ('item',1,'a','guess','joe','2026-08-30'),
    ('item',1,'b','legacy','joe','2026-08-30')`);
  assert.equal(count(db, 'v_confirmed_field'), 0,
    'a confirmed guess is still a guess — it may be displayed, never trusted');
});

test('an unconfirmed discogs value is not decision-eligible', () => {
  const db = fresh();
  db.exec("INSERT INTO release (discogs_id) VALUES (7387168)");
  db.exec('INSERT INTO item (release_id) VALUES (1)');
  db.exec("INSERT INTO field_source (entity, entity_id, field, source) VALUES ('item',1,'release_id','discogs')");
  assert.equal(count(db, 'v_decision_eligible_item'), 0);
});

test('confirming makes it eligible — the view discriminates, it is not merely empty', () => {
  const db = fresh();
  db.exec("INSERT INTO release (discogs_id) VALUES (7387168)");
  db.exec('INSERT INTO item (release_id) VALUES (1)');
  db.exec("INSERT INTO field_source (entity, entity_id, field, source) VALUES ('item',1,'release_id','discogs')");
  assert.equal(count(db, 'v_decision_eligible_item'), 0);

  db.exec("UPDATE field_source SET confirmed_by='joe', confirmed_at='2026-08-30' WHERE entity='item'");
  assert.equal(count(db, 'v_decision_eligible_item'), 1, 'a person confirmed it, so now it may feed a decision');
});

test('coverage reads only through eligible items', () => {
  const db = fresh();
  db.exec("INSERT INTO release (discogs_id) VALUES (1)");
  db.exec("INSERT INTO work (title) VALUES ('Symphony No. 5')");
  db.exec("INSERT INTO release_track (release_id, work_id, completeness) VALUES (1,1,'complete')");
  db.exec('INSERT INTO item (release_id) VALUES (1)');
  db.exec("INSERT INTO field_source (entity, entity_id, field, source) VALUES ('item',1,'release_id','discogs')");

  assert.equal(count(db, 'v_eligible_work_coverage'), 0,
    'an unverified match must not answer "do I own this work?"');
  db.exec("UPDATE field_source SET confirmed_by='joe', confirmed_at='2026-08-30'");
  assert.equal(count(db, 'v_eligible_work_coverage'), 1);
});

// ── the M0 dataset loads with its provenance intact ───────────────

const csv = 'data/deep-groove-v1.csv';
const loaded = () => loadDataset(':memory:', csv);

test('all 446 M0 rows load', { skip: !existsSync(csv) }, () => {
  const { db, stats, rows } = loaded();
  assert.equal(rows, 446);
  assert.equal(stats.items, 446);
  assert.equal(count(db, 'item'), 446);
  assert.equal(count(db, 'capture'), 446, 'every row carries something a person typed');
  assert.equal(stats.linkedToRelease, 277, 'the Discogs-matched rows');
});

test('capture never holds a machine-written value', { skip: !existsSync(csv) }, () => {
  const { db } = loaded();
  const bad = db.prepare(
    "SELECT COUNT(*) n FROM field_source WHERE entity='capture' AND source IN ('discogs','musicbrainz')").get();
  assert.equal(Number(bad.n), 0,
    'Discogs data lands in release; capture stays what a human read');

  // The 277 Discogs labels went to release, not capture.
  const capturedLabels = Number(one(db, 'SELECT COUNT(*) n FROM capture WHERE label_raw IS NOT NULL').n);
  assert.equal(capturedLabels, 31, 'only the 31 labels split out of the backlog were human-typed');
  assert.equal(Number(one(db, 'SELECT COUNT(*) n FROM release WHERE label IS NOT NULL').n), 267);
});

test('release carries only Discogs-sourced provenance', { skip: !existsSync(csv) }, () => {
  const { db } = loaded();
  const sources = db.prepare(
    "SELECT DISTINCT source FROM field_source WHERE entity='release'").all().map((r) => r.source);
  assert.deepEqual(sources.sort(), ['discogs']);
});

test('two items may share one pressing without duplicating the release', { skip: !existsSync(csv) }, () => {
  const { db, stats } = loaded();
  assert.equal(stats.releases + stats.releasesShared, 277);
  assert.equal(count(db, 'release'), stats.releases);
  const shared = db.prepare(
    'SELECT release_id, COUNT(*) n FROM item WHERE release_id IS NOT NULL GROUP BY release_id HAVING n > 1').all();
  assert.ok(shared.length > 0, 'the collection really does contain repeated pressings');
});

test('nothing is dropped — every unhomed value is kept and tagged by its true source', { skip: !existsSync(csv) }, () => {
  const { db, stats } = loaded();
  const bySource = db.prepare(`
    SELECT fs.source, COUNT(*) n FROM raw_value rv
      JOIN field_source fs ON fs.entity='raw_value' AND fs.entity_id=rv.id
     GROUP BY fs.source`).all();
  const map = Object.fromEntries(bySource.map((r) => [r.source, Number(r.n)]));

  assert.deepEqual(map, stats.rawBySource, 'the tally must match what is actually stored');
  // Three provenances end up here, and the counts say why:
  //  - 1248 guess: the 1220 ai_* values plus M0's 28 reclassified
  //    track listings, which are named like legacy columns and are
  //    guessed in truth.
  //  - 554 discogs: musicians and track listings on the 277 matched
  //    rows, homeless until M3 resolves tracks into works.
  //  - 528 legacy: what a person typed that the model has no slot for.
  assert.deepEqual(map, { guess: 1248, discogs: 554, legacy: 528 });
  assert.equal(Object.values(map).reduce((a, b) => a + b, 0), Number(one(db, 'SELECT COUNT(*) n FROM raw_value').n));

  // Homeless does not mean trusted: none of it is reachable for a decision.
  assert.equal(count(db, 'v_confirmed_field'), 0);
});

test('the loaded dataset is entirely decision-ineligible — the done-when', { skip: !existsSync(csv) }, () => {
  const { db } = loaded();
  assert.equal(count(db, 'v_confirmed_field'), 0);
  assert.equal(count(db, 'v_decision_eligible_item'), 0);
  assert.equal(count(db, 'v_decision_eligible_release'), 0);
  assert.equal(count(db, 'v_eligible_work_coverage'), 0);
  assert.ok(count(db, 'field_source') > 4000, 'provenance was recorded, not skipped');
});
