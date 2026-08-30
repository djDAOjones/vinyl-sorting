// @ts-check
/**
 * M2-REVIEW-QUEUE — the only place a value becomes decision-eligible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/bindings.mjs';
import { createApp } from '../../worker/index.ts';
import { parseResolve } from '../../worker/review.ts';

const app = createApp();
const json = (env, path, body, method = 'POST') => app.request(path,
  { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);

/** An item with a needs-review run and two candidates. */
async function seed(env) {
  const db = env.DB.raw;
  db.exec("INSERT INTO item (crate) VALUES ('B4')");
  db.exec("INSERT INTO capture (item_id, catno_raw, label_raw) VALUES (1, 'SXL 6113', 'Decca')");
  db.exec("INSERT INTO match_run (item_id, state, queries_json) VALUES (1, 'needs-review', '{\"reason\":\"only 1 signal family\"}')");
  db.exec(`INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json) VALUES
    (1, 1, 111, 73, '{"families":["identifier"],"signals":{"identifier":"exact catno SXL 6113"}}'),
    (1, 2, 222, 40, '{"families":["label"],"signals":{"label":"decca"}}')`);
  return 1;
}

test('a confirmation must say who made it', () => {
  assert.equal(parseResolve({ choice: 'none' }).ok, false);
  assert.match(parseResolve({ choice: 'none' }).error, /decidedBy is required/);
  assert.equal(parseResolve({ choice: 'none', decidedBy: '  ' }).ok, false);
});

test('a choice naming a release must name a valid one', () => {
  assert.equal(parseResolve({ choice: 'candidate', decidedBy: 'joe' }).ok, false);
  assert.equal(parseResolve({ choice: 'manual', decidedBy: 'joe', discogsId: 0 }).ok, false);
  assert.equal(parseResolve({ choice: 'candidate', decidedBy: 'joe', discogsId: 111 }).ok, true);
  // And a choice that names none must not smuggle one in.
  assert.equal(parseResolve({ choice: 'none', decidedBy: 'joe', discogsId: 111 }).ok, false);
});

test('a URL-shaped id is accepted as the number inside it', () => {
  const r = parseResolve({ choice: 'manual', decidedBy: 'joe', discogsId: '7387168' });
  assert.equal(r.ok, true);
  assert.equal(r.value.discogsId, 7387168);
});

test('the queue shows why the matcher refused, and what it weighed', async () => {
  const env = makeEnv();
  await seed(env);
  const { queue } = await (await app.request('/api/review-queue', {}, env)).json();
  assert.equal(queue.length, 1);
  assert.match(queue[0].queries_json, /only 1 signal family/);
  assert.equal(queue[0].candidates.length, 2);
  assert.equal(queue[0].candidates[0].discogs_id, 111);
  assert.match(queue[0].candidates[0].signals_json, /identifier/);
});

test('choosing a candidate is what makes an item decision-eligible', async () => {
  const env = makeEnv();
  await seed(env);
  assert.equal(Number(env.DB.raw.prepare('SELECT COUNT(*) n FROM v_decision_eligible_item').all()[0].n), 0);

  const res = await json(env, '/api/review/1/resolve', { choice: 'candidate', discogsId: 111, decidedBy: 'joe' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.decisionEligible, true, 'a person confirmed it, so it may now feed a decision');

  const fs = env.DB.raw.prepare("SELECT * FROM field_source WHERE entity='item' AND field='release_id'").all()[0];
  assert.equal(fs.source, 'discogs');
  assert.equal(fs.confirmed_by, 'joe');
  assert.ok(fs.confirmed_at);
});

test('resolving never touches what a human read off the disc', async () => {
  const env = makeEnv();
  await seed(env);
  const before = env.DB.raw.prepare('SELECT * FROM capture').all();
  await json(env, '/api/review/1/resolve', { choice: 'candidate', discogsId: 111, decidedBy: 'joe' });
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM capture').all(), before,
    'Discogs data lands in release; capture stays what a person read');
});

test('"none of these" un-links and un-confirms a previously accepted match', async () => {
  const env = makeEnv();
  await seed(env);
  await json(env, '/api/review/1/resolve', { choice: 'candidate', discogsId: 111, decidedBy: 'joe' });
  assert.equal(Number(env.DB.raw.prepare('SELECT COUNT(*) n FROM v_decision_eligible_item').all()[0].n), 1);

  await json(env, '/api/review/1/resolve', { choice: 'none', decidedBy: 'joe' });
  assert.equal(Number(env.DB.raw.prepare('SELECT COUNT(*) n FROM v_decision_eligible_item').all()[0].n), 0,
    'a rejected match must stop feeding decisions');
  assert.equal(env.DB.raw.prepare('SELECT release_id FROM item').all()[0].release_id, null);
});

test('a resolved item leaves the queue; a skipped one is re-queueable', async () => {
  const env = makeEnv();
  await seed(env);
  await json(env, '/api/review/1/resolve', { choice: 'skip', decidedBy: 'joe' });

  const plain = await (await app.request('/api/review-queue', {}, env)).json();
  assert.equal(plain.queue.length, 0, 'skipped items leave the default queue');

  const withSkipped = await (await app.request('/api/review-queue?include=skipped', {}, env)).json();
  assert.equal(withSkipped.queue.length, 1, 're-verification is a normal operation');
});

test('resolving records when the item was verified and by whom', async () => {
  const env = makeEnv();
  await seed(env);
  await json(env, '/api/review/1/resolve', { choice: 'none', decidedBy: 'jen' });
  const item = env.DB.raw.prepare('SELECT last_verified_at, last_verified_by FROM item').all()[0];
  assert.ok(item.last_verified_at);
  assert.equal(item.last_verified_by, 'jen');
});

test('re-resolving replaces the decision rather than duplicating it', async () => {
  const env = makeEnv();
  await seed(env);
  await json(env, '/api/review/1/resolve', { choice: 'candidate', discogsId: 111, decidedBy: 'joe' });
  await json(env, '/api/review/1/resolve', { choice: 'candidate', discogsId: 222, decidedBy: 'jen' });
  const decisions = env.DB.raw.prepare('SELECT * FROM review_decision').all();
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].discogs_id, 222);
  assert.equal(decisions[0].decided_by, 'jen');
});

test('an unknown run is a 404, not a silent write', async () => {
  const env = makeEnv();
  const res = await json(env, '/api/review/999/resolve', { choice: 'none', decidedBy: 'joe' });
  assert.equal(res.status, 404);
});

test('match stats report progress without reading rows', async () => {
  const env = makeEnv();
  await seed(env);
  await json(env, '/api/review/1/resolve', { choice: 'candidate', discogsId: 111, decidedBy: 'joe' });
  const stats = await (await app.request('/api/match-stats', {}, env)).json();
  assert.equal(stats.reviewed, 1);
  assert.equal(stats.decisionEligible, 1);
  assert.deepEqual(stats.byState, [{ state: 'needs-review', n: 1 }]);
});

test('a page larger than D1 parameter limit still returns its candidates', async () => {
  // D1 allows at most 100 bound parameters per query. The candidate
  // lookup binds one id per run, so an uncapped page returned 500 in
  // production while passing locally — SQLite has no such limit.
  const env = makeEnv();
  const db = env.DB.raw;
  const RUNS = 150;
  for (let i = 1; i <= RUNS; i++) {
    db.exec(`INSERT INTO item (crate) VALUES ('B${i}')`);
    db.exec(`INSERT INTO match_run (item_id, state, queries_json) VALUES (${i}, 'needs-review', '{"reason":"x"}')`);
    db.exec(`INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json)
             VALUES (${i}, 1, ${1000 + i}, 70, '{"families":["identifier"]}')`);
  }

  const body = await (await app.request(`/api/review-queue?limit=${RUNS}`, {}, env)).json();
  assert.equal(body.queue.length, RUNS);
  assert.ok(body.queue.every((q) => q.candidates.length === 1),
    'every run keeps its candidates across the chunk boundary');
  assert.equal(body.queue[0].candidates[0].discogs_id, 1001);
  assert.equal(body.queue[RUNS - 1].candidates[0].discogs_id, 1000 + RUNS);
});
