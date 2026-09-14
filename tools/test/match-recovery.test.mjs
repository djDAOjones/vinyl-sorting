import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/bindings.mjs';
import { createApp, runMatchBatch } from '../../worker/index.ts';
import { claimRow, matchRow, pendingRows, persistRun } from '../../worker/match/run.ts';
import { requestMatch, claimRetry } from '../../worker/match/recovery.ts';
import { loadMatchRow } from '../../worker/match/input.ts';
import { parseDiscogsReleaseId } from '../../src/discogs-id.ts';
import { parseResolve } from '../../worker/review.ts';
import { buildQueries } from '../../worker/match/queries.ts';

const app = createApp();
function seed(state = 'rejected') {
  const env = makeEnv();
  env.DB.raw.exec(`INSERT INTO item (crate, list) VALUES ('A1', 'classical');
    INSERT INTO capture (item_id, catno_raw, label_raw) VALUES (1, 'ABC 123', 'Decca');`);
  if (state) env.DB.raw.prepare(`INSERT INTO match_run (item_id, state, ran_at, queries_json)
    VALUES (1, ?, datetime('now', '-1 day'), '{"reason":"Old attempt"}')`).run(state);
  return env;
}
const readQueue = async (env, q = '') => (await (await app.request(`/api/review-queue${q}`, {}, env)).json()).queue;
const decision = (env, run, body) => app.request(`/api/review/${run}/resolve`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decidedBy: 'Joe', ...body }),
}, env);

test('a retry preserves the failed attempt, capture and decisions and is claimed exactly once', async () => {
  const env = seed();
  const before = env.DB.raw.prepare('SELECT * FROM capture').all();
  const old = env.DB.raw.prepare('SELECT * FROM match_run').all()[0];
  const result = await requestMatch(env, 1, 'Joe');
  assert.equal(result.status, 202);
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM match_run WHERE id=1').get(), old);
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM capture').all(), before);
  assert.equal((await requestMatch(env, 1, 'Joe')).status, 409);
  const pending = await pendingRows(env, 10);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].queuedRunId, result.runId);
  const claims = await Promise.all([claimRetry(env, result.runId), claimRetry(env, result.runId)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await pendingRows(env, 10)).length, 0);
  const matched = await matchRow(pending[0], { search: async () => [], getRelease: async () => ({}) });
  await persistRun(env, pending[0], matched, result.runId);
  const audit = JSON.parse(env.DB.raw.prepare('SELECT queries_json FROM match_run WHERE id=?').get(result.runId).queries_json);
  assert.equal(audit.requestedBy, 'Joe');
  assert.equal(audit.retry, 'finished');
  assert.equal(audit.attempts.length, matched.outcome.queriesRun);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM match_run').get().n, 2);
});

test('retry HTTP operation requires both edit passphrase and known person and makes no upstream request', async () => {
  const env = seed();
  env.EDIT_TOKEN = 'local-fixture-only';
  const path = '/api/items/1/retry-match';
  assert.equal((await app.request(path, { method: 'POST' }, env)).status, 401);
  assert.equal((await app.request(path, { method: 'POST', headers: { 'x-edit-token': env.EDIT_TOKEN } }, env)).status, 401);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('HTTP retry must never reach upstream'); };
  try {
    const response = await app.request(path, { method: 'POST', headers: { 'x-edit-token': env.EDIT_TOKEN, 'x-capturer': 'Joe' } }, env);
    assert.equal(response.status, 202);
  } finally { globalThis.fetch = oldFetch; }
});

test('missing evidence, absent records, confirmed releases and rapid repeats are refused', async () => {
  const env = seed();
  assert.equal((await requestMatch(env, 999, 'Joe')).status, 404);
  env.DB.raw.exec("UPDATE capture SET catno_raw='?', label_raw=NULL");
  assert.equal((await requestMatch(env, 1, 'Joe')).status, 422);
  env.DB.raw.exec("UPDATE capture SET catno_raw='ABC 123'");
  assert.equal((await decision(env, 1, { choice: 'manual', discogsId: 123 })).status, 200);
  assert.equal((await requestMatch(env, 1, 'Joe')).status, 409);
  assert.equal((await pendingRows(env, 10)).length, 0);
  assert.equal(await claimRow(env, 1), null);
  const fresh = seed();
  fresh.DB.raw.exec("UPDATE match_run SET ran_at=datetime('now')");
  assert.equal((await requestMatch(fresh, 1, 'Joe')).status, 409);
});

test('a stuck running attempt can be retried after fifteen minutes without erasing it', async () => {
  const env = seed('pending');
  assert.equal((await requestMatch(env, 1, 'Joe')).status, 202);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM match_run').get().n, 2);
  assert.equal((await requestMatch(env, 1, 'Joe')).status, 409);
});

test('unmatched records stay ahead of retries and fresh claims cannot overlap', async () => {
  const env = seed();
  await requestMatch(env, 1, 'Joe');
  env.DB.raw.exec("INSERT INTO item (crate) VALUES ('B1'); INSERT INTO capture (item_id, catno_raw) VALUES (2, 'XYZ 456')");
  const rows = await pendingRows(env, 10);
  assert.deepEqual(rows.map(r => r.itemId), [2, 1]);
  assert.ok(await claimRow(env, 2));
  assert.equal(await claimRow(env, 2), null);
});

test('preparation and matching use the same newest capture, with reading fallbacks and no release evidence', async () => {
  const env = seed(null);
  env.DB.raw.exec(`INSERT INTO capture (item_id, catno_raw, label_raw) VALUES (1, 'NEW 456', '');
    INSERT INTO raw_value (item_id, field, value) VALUES (1, 'catno_raw', 'WRONG 789'), (1, 'label_raw', 'Photo label');`);
  const before = env.DB.raw.prepare('SELECT * FROM capture').all();
  const row = await loadMatchRow(env, 1);
  assert.equal(row.catnoRaw, 'NEW 456');
  assert.equal(row.labelRaw, 'Photo label');
  assert.equal((await pendingRows(env, 10)).length, 1);
  const detail = await (await app.request('/api/items/1', {}, env)).json();
  assert.deepEqual(detail.matching.input, { ...row });
  assert.equal(detail.matching.usable, true);
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM capture').all(), before);
});

test('rejected, error and automatic matches can be opened for individual review; pending and older runs cannot', async () => {
  for (const state of ['rejected', 'error', 'auto-accepted']) {
    const env = seed(state);
    assert.equal((await readQueue(env)).length, 0);
    assert.equal((await readQueue(env, '?view=recovery')).length, 1);
    assert.equal((await readQueue(env, '?item=1')).length, 1);
    env.DB.raw.exec("INSERT INTO match_run (item_id, state) VALUES (1, 'pending')");
    assert.equal((await readQueue(env, '?item=1')).length, 0);
    assert.equal((await decision(env, 1, { choice: 'manual', discogsId: 123 })).status, 409);
    assert.equal((await decision(env, 2, { choice: 'manual', discogsId: 123 })).status, 409);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM review_decision').get().n, 0);
  }
});

test('leaving unresolved retains a note and can be revisited, including after deferring', async () => {
  const env = seed();
  assert.equal((await decision(env, 1, { choice: 'none', note: 'Need the mono catalogue number' })).status, 200);
  assert.equal((await readQueue(env, '?view=recovery')).length, 0);
  assert.equal((await readQueue(env, '?view=recovery&include=skipped')).length, 1);
  assert.equal((await readQueue(env, '?item=1')).length, 1);
  assert.equal(env.DB.raw.prepare('SELECT note FROM review_decision').get().note, 'Need the mono catalogue number');
});

test('manual URLs must identify an exact Discogs release, and candidate choice must belong to that run', async () => {
  for (const value of ['123', 123, 'https://www.discogs.com/release/123-A-Title', 'https://www.discogs.com/fr/release/123']) {
    assert.equal(parseDiscogsReleaseId(value), 123);
    assert.equal(parseResolve({ choice: 'manual', discogsId: value, decidedBy: 'Joe' }).ok, true);
  }
  for (const value of ['https://www.discogs.com/master/123', 'https://evil.example/release/123', 'record 123 maybe', '123garbage', '1e3', -1, '9007199254740993', 'https://www.discogs.com/artist/123', 'https://discogs.com@evil.example/release/123']) {
    assert.equal(parseDiscogsReleaseId(value), null, String(value));
    assert.equal(parseResolve({ choice: 'manual', discogsId: value, decidedBy: 'Joe' }).ok, false);
  }
  const env = seed();
  assert.equal((await decision(env, 1, { choice: 'candidate', discogsId: 999 })).status, 409);
  assert.equal((await decision(env, 1, { choice: 'manual', discogsId: 999 })).status, 200);
});

test('twelve unrelated hits and a weak label signal cannot stop alternative number searches', async () => {
  const asked = [];
  const result = await matchRow({ itemId: 1, catnoRaw: 'BAD 123', labelRaw: 'Decca', otherNumbers: 'GOOD 456' }, {
    search: async p => {
      asked.push(p);
      return String(p.catno).includes('GOOD') ? [{ id: 999, catno: 'GOOD 456', label: ['Decca'], format: ['Vinyl'] }]
        : Array.from({ length: 15 }, (_, i) => ({ id: i + 1, label: ['Decca'], format: ['Vinyl'] }));
    }, getRelease: async () => ({}),
  });
  assert.ok(asked.some(p => String(p.catno).includes('GOOD')));
  assert.equal(result.outcome.chosenDiscogsId, 999);
  assert.equal(result.outcome.usedFallback, true);
});

test('uncertain numbers are never queried or scored, but a usable alternative can rescue a blank primary', async () => {
  const plan = buildQueries({ catnoRaw: 'ABC 12?', titleRaw: 'A concerto', nameRaw: 'Mozart', otherNumbers: 'XYZ 45?\nDEF 678' });
  assert.ok(!JSON.stringify(plan).includes('?'));
  assert.ok(!plan.variants.includes('ABC 12'));
  const result = await matchRow({ itemId: 1, catnoRaw: '?', otherNumbers: 'DEF 678', labelRaw: 'Decca' }, {
    search: async p => String(p.catno).includes('DEF') ? [{ id: 99, catno: 'DEF 678', label: ['Decca'] }] : [],
    getRelease: async () => ({}),
  });
  assert.equal(result.outcome.chosenDiscogsId, 99);
});

test('incomplete searches preserve useful candidates without automatically linking them', async () => {
  let asked = 0;
  const result = await matchRow({ itemId: 1, catnoRaw: 'ABC 123', labelRaw: 'Decca' }, {
    search: async () => { if (++asked === 1) throw new Error('Temporary refusal'); return [{ id: 99, catno: 'ABC 123', label: ['Decca'] }]; },
    getRelease: async () => ({}),
  });
  assert.equal(result.outcome.verdict, 'needs_review');
  assert.equal(result.outcome.chosenDiscogsId, null);
  assert.equal(result.outcome.incomplete, true);
  assert.equal(result.outcome.attempts.filter(a => a.status === 'error').length, 1);
  assert.ok(result.gate.ranked.some(c => c.id === 99));
});

test('a mixture of successful empty queries and failures is reported accurately', async () => {
  let called = 0;
  const result = await matchRow({ itemId: 1, catnoRaw: 'ABC 123' }, {
    search: async () => { if (++called === 1) throw new Error('Temporary refusal'); return []; }, getRelease: async () => ({}),
  });
  assert.equal(result.outcome.verdict, 'error');
  assert.equal(result.outcome.queryErrors, 1);
  assert.equal(result.queries.length, called);
  assert.doesNotMatch(result.outcome.reason, /all .*queries failed/);
});

test('a stale matcher result never overwrites a newer human confirmation', async () => {
  const env = seed(null);
  const row = await loadMatchRow(env, 1);
  const stale = await claimRow(env, 1);
  env.DB.raw.exec("INSERT INTO match_run (item_id,state) VALUES (1,'needs-review')");
  await decision(env, 2, { choice: 'manual', discogsId: 123 });
  const before = env.DB.raw.prepare('SELECT release_id FROM item').get();
  const result = await matchRow(row, { search: async () => [{ id: 999, catno: 'ABC 123', label: ['Decca'] }], getRelease: async () => ({}) });
  await persistRun(env, row, result, stale);
  assert.deepEqual(env.DB.raw.prepare('SELECT release_id FROM item').get(), before);
  assert.equal(env.DB.raw.prepare("SELECT confirmed_by FROM field_source WHERE entity='item' AND field='release_id'").get().confirmed_by, 'Joe');
});

test('the scheduled batch consumes an explicit retry with its normal client and preserves history', async () => {
  const env = seed();
  env.DISCOGS_TOKEN = 'local-fixture';
  const requested = await requestMatch(env, 1, 'Joe');
  const originalFetch = globalThis.fetch;
  let clock = Date.now();
  globalThis.fetch = async url => Response.json(String(url).includes('/database/search')
    ? { results: [{ id: 99, catno: 'ABC 123', label: ['Decca'], format: ['Vinyl'] }] } : {});
  try {
    const result = await runMatchBatch(env, { batchSize: 1, now: () => clock, sleep: async ms => { clock += ms; } });
    assert.equal(result.processed, 1);
    const run = env.DB.raw.prepare('SELECT * FROM match_run WHERE id=?').get(requested.runId);
    assert.equal(run.state, 'auto-accepted');
    assert.equal(JSON.parse(run.queries_json).input.catnoRaw, 'ABC 123');
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM match_run').get().n, 2);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM v_decision_eligible_item').get().n, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a retry arriving during manual resolution cannot be bypassed by an earlier stale-page check', async () => {
  const env = seed();
  const batch = env.DB.batch;
  env.DB.batch = async statements => {
    assert.equal((await requestMatch(env, 1, 'Joe')).status, 202);
    return batch(statements);
  };
  assert.equal((await decision(env, 1, { choice: 'manual', discogsId: 123 })).status, 409);
  assert.equal(env.DB.raw.prepare('SELECT release_id FROM item').get().release_id, null);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM review_decision').get().n, 0);
});

test('a crowded early search retains stronger later results and reports the candidate limit', async () => {
  const result = await matchRow({ itemId: 1, catnoRaw: 'BAD 123', labelRaw: 'Decca', otherNumbers: 'GOOD 456' }, {
    search: async p => String(p.catno).includes('GOOD')
      ? [{ id: 999, catno: 'GOOD 456', label: ['Decca'], format: ['Vinyl'] }]
      : Array.from({ length: 150 }, (_, i) => ({ id: i + 1, format: ['Vinyl'] })),
    getRelease: async () => ({}),
  });
  assert.equal(result.gate.ranked[0].id, 999);
  assert.equal(result.outcome.incomplete, true);
  assert.equal(result.outcome.chosenDiscogsId, null);
  assert.match(result.outcome.reason, /candidate limit/);
  assert.equal(result.outcome.candidates, 120);
});

test('a never-searched record with no usable text can enter manual review without upstream work', async () => {
  const env = seed(null);
  env.EDIT_TOKEN = 'local-fixture';
  env.DB.raw.exec("UPDATE capture SET catno_raw=NULL, label_raw=NULL");
  const path = '/api/items/1/start-review';
  assert.equal((await app.request(path, { method: 'POST' }, env)).status, 401);
  const response = await app.request(path, { method: 'POST', headers: { 'x-edit-token': env.EDIT_TOKEN, 'x-capturer': 'Joe' } }, env);
  assert.equal(response.status, 201);
  assert.equal((await readQueue(env, '?item=1')).length, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM v_decision_eligible_item').get().n, 0);
  const repeat = await app.request(path, { method: 'POST', headers: { 'x-edit-token': env.EDIT_TOKEN, 'x-capturer': 'Joe' } }, env);
  assert.equal(repeat.status, 409);
  assert.equal((await decision(env, 1, { choice: 'manual', discogsId: 123 })).status, 200);
});
