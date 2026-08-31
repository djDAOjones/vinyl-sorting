// @ts-check
/**
 * APP-SETTINGS and MATCH-REVERIFY-SWEEP.
 *
 * The settings page sits on a URL with no sign-in, so most of what is
 * asserted here is a REFUSAL: what the passphrase gates, what the
 * defaults are when nothing can be read, and — the one with teeth —
 * that the sweep cannot loop on the same rows for ever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, EXPORT_TABLES, exportCsv, exportJson, parseSettings,
} from '../../worker/admin.ts';
import { pendingRows } from '../../worker/match/run.ts';
import { createApp } from '../../worker/index.ts';
import { makeEnv } from './helpers/bindings.mjs';

// ── settings ──────────────────────────────────────────────────────

test('the sweep is OFF unless something explicitly says otherwise', () => {
  // An unconditional sweep is an infinite loop with a rate limit
  // attached, and every row it cannot settle lands in the maintainer's
  // review queue. So absent, malformed and unreadable all mean off.
  assert.equal(DEFAULTS.reverify, false);
  assert.equal(parseSettings({}).reverify, false);
  assert.equal(parseSettings(null).reverify, false);
  assert.equal(parseSettings('nonsense').reverify, false);
  assert.equal(parseSettings({ reverify: 'yes' }).reverify, false,
    'only a real boolean turns it on — a truthy string is a half-written record');
  assert.equal(parseSettings({ reverify: true }).reverify, true);
});

test('every number is clamped rather than trusted or refused', () => {
  // This is a preference screen, not an API: 10000 days is somebody
  // meaning "never", and storing the maximum is a better answer than a
  // 400 they cannot see.
  assert.equal(parseSettings({ reverifyMinDays: 99999 }).reverifyMinDays, 3650);
  assert.equal(parseSettings({ reverifyMinDays: -5 }).reverifyMinDays, 1);
  assert.equal(parseSettings({ reverifyMaxPerDay: 9999 }).reverifyMaxPerDay, 500);
  assert.equal(parseSettings({ reverifyMaxPerDay: 0 }).reverifyMaxPerDay, 0, 'zero is a real answer');
  assert.equal(parseSettings({ reverifyMinDays: 'soon' }).reverifyMinDays, DEFAULTS.reverifyMinDays);
});

// ── export ────────────────────────────────────────────────────────

const seed = (env) => {
  env.DB.raw.exec(`
    INSERT INTO item (crate, position) VALUES ('B4','12'),('B4','13');
    INSERT INTO capture (item_id, catno_raw, label_raw, title_raw) VALUES
      (1, 'SXL 6113', 'Decca', 'Symphony No. 5'),
      (2, 'CFP 40001', NULL, 'A title with a "quote" and, a comma');
  `);
};

test('an export names its tables and carries the schema version', async () => {
  const env = makeEnv();
  seed(env);
  const dump = await exportJson(env);
  for (const t of EXPORT_TABLES) assert.ok(Array.isArray(dump[t]), `${t} is present`);
  assert.equal(dump.item.length, 2);
  // A dump that cannot say which schema it came from is a dump nobody
  // can safely load.
  assert.ok(dump.schema_migration.length, 'the schema version travels with the data');
  assert.ok(!('_rowid' in dump.item[0]), 'the paging key is not part of the data');
});

test('the CSV quotes what would otherwise break a spreadsheet', async () => {
  const env = makeEnv();
  seed(env);
  const csv = await exportCsv(env);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3, 'a header and one row per record');
  assert.ok(lines[0].startsWith('id,crate,position'));
  assert.ok(csv.includes('""quote""'), 'a quote is doubled, not dropped');
  assert.ok(/"A title with a ""quote"" and, a comma"/.test(csv), 'a comma stays inside its cell');
});

test('both exports are behind the passphrase, and say so rather than 404', async () => {
  const env = Object.assign(makeEnv(), { EDIT_TOKEN: 'open-sesame' });
  seed(env);
  const app = createApp();
  const get = (headers = {}) =>
    app.fetch(new Request('https://x/api/export?format=csv', { headers }), env, {
      waitUntil() {}, passThroughOnException() {},
    });

  assert.equal((await get()).status, 401, 'the whole collection in one response is not open');
  const ok = await get({ 'x-edit-token': 'open-sesame' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(ok.headers.get('content-disposition') ?? '', /attachment; filename=/);
});

// ── the sweep ─────────────────────────────────────────────────────

test('a never-matched row always outranks a re-verification', async () => {
  const env = makeEnv();
  env.DB.raw.exec(`
    INSERT INTO item (crate) VALUES ('A'),('B');
    INSERT INTO capture (item_id, catno_raw) VALUES (1,'AAA 1'),(2,'BBB 2');
    -- Item 1 was matched long ago; item 2 has never been looked at.
    INSERT INTO match_run (item_id, state, ran_at) VALUES (1,'needs-review','2020-01-01 00:00:00');
  `);
  const rows = await pendingRows(env, 5, { reverifyOlderThanDays: 30 });
  assert.equal(rows[0].itemId, 2, 'the row nothing has ever seen comes first');
  assert.equal(rows.length, 2);
  assert.ok(!rows[0].lastRunAt, 'a first pass is not marked as a sweep');
  assert.equal(rows[1].itemId, 1);
  assert.ok(rows[1].lastRunAt, 'and a sweep is, so the run can record why it came back');
});

test('the sweep orders by the last MATCH RUN, which is the thing that advances', async () => {
  // THE INFINITE LOOP THIS AVOIDS: `last_verified_at` is written only
  // by resolveRun — when a PERSON settles a row — so the matcher never
  // changes it. Ordering by it would hand back the same oldest rows
  // every five minutes for ever, spending the shared Discogs budget and
  // reaching nothing new. `ran_at` is written on every pass.
  const env = makeEnv();
  env.DB.raw.exec(`
    INSERT INTO item (crate) VALUES ('A'),('B');
    INSERT INTO capture (item_id, catno_raw) VALUES (1,'AAA 1'),(2,'BBB 2');
    INSERT INTO match_run (item_id, state, ran_at) VALUES
      (1,'needs-review','2021-06-01 00:00:00'),
      (2,'needs-review','2020-01-01 00:00:00');
  `);
  const first = await pendingRows(env, 1, { reverifyOlderThanDays: 30 });
  assert.equal(first[0].itemId, 2, 'the row matched longest ago goes first');

  // Re-running it writes a newer run, which must send it to the back.
  env.DB.raw.exec(
    "INSERT INTO match_run (item_id, state, ran_at) VALUES (2,'needs-review','2026-09-01 00:00:00')");
  const next = await pendingRows(env, 1, { reverifyOlderThanDays: 30 });
  assert.equal(next[0].itemId, 1, 'so the queue advances instead of looping');
});

test('a row a person confirmed is never swept', async () => {
  // Re-running it can only produce a queue item contradicting a human
  // decision, which is worse than not running at all.
  const env = makeEnv();
  env.DB.raw.exec(`
    INSERT INTO item (crate) VALUES ('A');
    INSERT INTO capture (item_id, catno_raw) VALUES (1,'AAA 1');
    INSERT INTO match_run (item_id, state, ran_at) VALUES (1,'auto-accepted','2020-01-01 00:00:00');
    INSERT INTO field_source (entity, entity_id, field, source, confirmed_by, confirmed_at)
      VALUES ('item', 1, 'release_id', 'discogs', 'Joe', '2026-01-01 00:00:00');
  `);
  assert.deepEqual(await pendingRows(env, 5, { reverifyOlderThanDays: 30 }), []);
});

test('nothing is swept unless the sweep is asked for', async () => {
  const env = makeEnv();
  env.DB.raw.exec(`
    INSERT INTO item (crate) VALUES ('A');
    INSERT INTO capture (item_id, catno_raw) VALUES (1,'AAA 1');
    INSERT INTO match_run (item_id, state, ran_at) VALUES (1,'needs-review','2020-01-01 00:00:00');
  `);
  assert.deepEqual(await pendingRows(env, 5), [], 'the default is the shipped default: off');
  assert.deepEqual(await pendingRows(env, 5, { reverifyOlderThanDays: 999999 }), [],
    'and a row inside the minimum age is left alone');
});
