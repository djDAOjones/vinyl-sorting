import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemStatus } from '../../src/item-status.ts';
import { createApp } from '../../worker/index.ts';
import { makeEnv } from './helpers/bindings.mjs';

const now = Date.parse('2026-09-15T12:00:00Z');
test('current confirmation and decisions outrank the preserved machine result', () => {
  for (const state of ['needs-review', 'auto-accepted', 'error', 'pending']) {
    assert.equal(itemStatus({ confirmed: true, state, incomplete: true }, now), 'confirmed');
  }
  assert.equal(itemStatus({ state: 'needs-review', choice: 'skip' }), 'deferred');
  assert.equal(itemStatus({ state: 'needs-review', choice: 'none' }), 'not-identified');
  assert.equal(itemStatus({ state: 'auto-accepted' }), 'check-match', 'a machine result never fabricates confirmation');
  assert.equal(itemStatus({ state: 'needs-review' }), 'needs-review');
});

test('missing input, old empty attempts and incomplete searches are different work', () => {
  assert.equal(itemStatus({ state: 'rejected', queriesRun: 0, searchable: true }), 'ready-to-search');
  assert.equal(itemStatus({ state: 'rejected', queriesRun: 0, searchable: false }), 'needs-details');
  assert.equal(itemStatus({ state: 'rejected', queriesRun: 5, searchable: true }), 'not-identified');
  assert.equal(itemStatus({ state: 'needs-review', incomplete: true }), 'search-incomplete');
  assert.equal(itemStatus({ state: 'auto-accepted', queryErrors: 2 }), 'search-incomplete');
  assert.equal(itemStatus({ state: 'error', queryErrors: 8 }), 'search-failed');
  assert.equal(itemStatus({ state: 'needs-review', manualReview: true }), 'not-identified');
  assert.equal(itemStatus({ searchable: false }), 'needs-details');
  assert.equal(itemStatus({ searchable: true }), 'waiting');
});

test('a queued request is waiting; a stale running request is not still searching', () => {
  assert.equal(itemStatus({ state: 'pending', retry: 'queued', ranAt: '2026-09-14 12:00:00' }, now), 'waiting');
  assert.equal(itemStatus({ state: 'pending', ranAt: '2026-09-15 11:59:00' }, now), 'searching');
  assert.equal(itemStatus({ state: 'pending', ranAt: '2026-09-15T11:59:00Z' }, now), 'searching');
  assert.equal(itemStatus({ state: 'pending', ranAt: '2026-09-15 11:45:00' }, now), 'search-failed');
  assert.equal(itemStatus({ state: 'pending', ranAt: 'bad' }, now), 'search-failed');
});

const app = createApp();
const get = async (env, path) => {
  const response = await app.request(path, {}, env);
  assert.equal(response.status, 200);
  return response.json();
};
test('list metadata follows the latest run and the Home review count matches active decisions', async () => {
  const env = makeEnv(), db = env.DB.raw;
  db.exec(`INSERT INTO item (list) VALUES ('classical'),('classical'),('classical'),('classical');
    INSERT INTO match_run (item_id,state,queries_json) VALUES
      (1,'needs-review','{}'),(2,'needs-review','{}'),(3,'needs-review','{}'),(4,'needs-review','{}');
    INSERT INTO review_decision (match_run_id,item_id,choice,decided_by,discogs_id) VALUES
      (1,1,'candidate','Joe',123),(2,2,'skip','Joe',NULL),(3,3,'none','Joe',NULL);
    INSERT INTO release (discogs_id) VALUES (123);
    UPDATE item SET release_id=1 WHERE id=1;
    INSERT INTO field_source (entity,entity_id,field,source,confirmed_by,confirmed_at)
      VALUES ('item',1,'release_id','discogs','Joe',datetime('now'));`);
  const { items } = await get(env, '/api/items');
  assert.equal(items[0].match_state, 'needs-review', 'original evidence is preserved');
  assert.equal(items[0].release_confirmed, 1);
  assert.deepEqual(items.map(r => r.review_choice), ['candidate','skip','none',null]);
  assert.deepEqual((await get(env, '/api/review-queue')).queue.map(r => r.item_id), [4]);
  assert.equal((await get(env, '/api/match-stats')).itemsNeedingReview, 1);
  const specific = (await get(env, '/api/review-queue?item=1')).queue[0];
  assert.equal(specific.release_confirmed, 1, 'opening history knows the record is confirmed');
  db.exec(`INSERT INTO match_run (item_id,state,queries_json) VALUES
    (2,'pending','{"retry":"queued","queriesRun":0,"queryErrors":0,"incomplete":false}');`);
  const row = (await get(env, '/api/items')).items[1];
  assert.equal(row.review_choice, null, 'an old skip does not classify a new run');
  assert.equal(row.match_state, 'pending');
  assert.equal(row.match_retry, 'queued');
  assert.equal(row.match_queries_run, 0);
});

test('review pagination reaches entries beyond 200 without duplicate or missing records', async () => {
  const env = makeEnv(), db = env.DB.raw;
  for (let id = 1; id <= 203; id++) {
    db.prepare("INSERT INTO item (id,list) VALUES (?,?)").run(id, id === 202 ? 'dance' : 'classical');
    db.prepare("INSERT INTO match_run (item_id,state) VALUES (?,'needs-review')").run(id);
  }
  const first = await get(env, '/api/review-queue?limit=200&list=classical');
  assert.equal(first.queue.length, 200);
  assert.equal(first.nextAfter, 200);
  const second = await get(env, '/api/review-queue?limit=200&list=classical&after='+first.nextAfter);
  assert.deepEqual(second.queue.map(r => r.item_id), [201,203]);
  assert.equal(second.nextAfter, null);
  assert.equal(new Set([...first.queue,...second.queue].map(r => r.item_id)).size,202);
});
