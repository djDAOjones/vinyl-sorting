import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/bindings.mjs';
import { prepareSource, sourcePreparation, runSourcePreparation, sourceInputKey } from '../../worker/source-preparation.ts';
import { loadMatchRow } from '../../worker/match/input.ts';
import { createApp } from '../../worker/index.ts';
import { sourcePreparationHtml } from '../../src/musicbrainz-panel.ts';

function setup(count = 1) {
  const env = makeEnv(), objects = new Map(); let sequence = 0;
  env.PHOTOS = {
    get: async key => {
      const o = objects.get(key); return o ? { ...o, json: async () => JSON.parse(o.body) } : null;
    },
    put: async (key, body, opts = {}) => {
      const old = objects.get(key);
      if (opts.onlyIf?.etagMatches && opts.onlyIf.etagMatches !== old?.etag) return null;
      if (opts.onlyIf?.etagDoesNotMatch === '*' && old) return null;
      const o = { body, etag: String(++sequence) }; objects.set(key, o); return o;
    },
  };
  for (let n = 1; n <= count; n++) env.DB.raw.exec(`INSERT INTO item DEFAULT VALUES;
    INSERT INTO capture(item_id, catno_raw) VALUES(${n}, 'TEST ${n}001');`);
  let time = Date.now(), calls = 0;
  const opts = { now: () => time, sleep: async ms => { time += ms; }, fetchImpl: async () => {
    calls++; return Response.json({ count: 0, releases: [] });
  } };
  return { env, opts, objects, calls: () => calls, advance: ms => { time += ms; } };
}
const key = n => `_system/source-preparation/${n}.json`;
const run = (env, n, state = 'rejected', meta = {}) => env.DB.raw.prepare(`INSERT INTO match_run
  (item_id,state,ran_at,queries_json) VALUES(?,?,datetime('now','-1 day'),?)`).run(n, state, JSON.stringify(meta));

test('background preparation skips confirmed, accepted and unreadable records, with one search per tick', async () => {
  const { env, opts, calls } = setup(5);
  env.DB.raw.exec(`INSERT INTO field_source(entity,entity_id,field,source,confirmed_by,confirmed_at)
    VALUES('item',1,'release_id','shelf','Joe',datetime('now'));
    UPDATE capture SET catno_raw='?' WHERE item_id=3;`);
  run(env, 2, 'auto-accepted'); run(env, 4);
  const before = env.DB.raw.prepare('SELECT * FROM capture').all();
  assert.deepEqual(await runSourcePreparation(env, opts), { inspected: 2, prepared: 1, retriesQueued: 0 });
  assert.equal(calls(), 1);
  assert.equal((await sourcePreparation(env, 4, await loadMatchRow(env, 4))).status, 'ready');
  assert.equal((await sourcePreparation(env, 1, await loadMatchRow(env, 1), true)).status, 'settled');
  assert.equal((await sourcePreparation(env, 3, await loadMatchRow(env, 3))).status, 'needs-details');
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM capture').all(), before);
  assert.equal(env.DB.raw.prepare('SELECT count(*) n FROM release').get().n, 0);
  assert.equal(env.DB.raw.prepare('SELECT count(*) n FROM review_decision').get().n, 0);
});

test('persistent results survive cache expiry; changed inputs invalidate evidence and queue exactly one preserved Discogs retry', async () => {
  const { env, opts, advance, calls } = setup(); const input = await loadMatchRow(env, 1);
  run(env, 1, 'rejected', { input, queriesRun: 2 });
  await runSourcePreparation(env, opts); advance(2 * 86_400_000);
  await env.CACHE.put('source-preparation:cursor:v1', '0');
  await runSourcePreparation(env, opts); assert.equal(calls(), 1);
  env.DB.raw.exec("UPDATE capture SET catno_raw='NEW 456' WHERE item_id=1");
  const changed = await loadMatchRow(env, 1);
  assert.equal((await sourcePreparation(env, 1, changed)).status, 'waiting');
  await env.CACHE.put('source-preparation:cursor:v1', '0');
  assert.equal((await runSourcePreparation(env, opts)).retriesQueued, 1);
  assert.equal(calls(), 2);
  await env.CACHE.put('source-preparation:cursor:v1', '0'); await runSourcePreparation(env, opts);
  const runs = env.DB.raw.prepare('SELECT * FROM match_run ORDER BY id').all();
  assert.equal(runs.length, 2); assert.equal(runs[0].state, 'rejected'); assert.equal(runs[1].state, 'pending');
  assert.equal(JSON.parse(runs[1].queries_json).requestedBy, 'Automatic source preparation');
});

test('provider failures wait one then six hours, stop after three attempts, and do not starve later records', async () => {
  const { env, opts, advance } = setup(2); let calls = 0;
  opts.fetchImpl = async () => { calls++; return new Response('', { status: 500 }); };
  const input = await loadMatchRow(env, 1);
  const first = await prepareSource(env, 1, input, false, opts);
  assert.equal(first.status, 'incomplete'); assert.equal(Date.parse(first.retryAt) - Date.parse(first.updatedAt), 3_600_000);
  assert.equal(await prepareSource(env, 1, input, false, opts), null);
  assert.equal((await runSourcePreparation(env, opts)).prepared, 1, 'waiting first record does not block second');
  advance(3_600_000);
  const second = await prepareSource(env, 1, input, false, opts); assert.equal(second.attempts, 2);
  assert.equal(Date.parse(second.retryAt) - Date.parse(second.updatedAt), 21_600_000);
  advance(21_600_000);
  assert.equal((await prepareSource(env, 1, input, false, opts)).status, 'paused');
  const before = calls; advance(86_400_000);
  assert.equal(await prepareSource(env, 1, input, false, opts), null); assert.equal(calls, before);
  assert.equal((await prepareSource(env, 1, input, true, opts)).attempts, 1, 'explicit search can restart');
});

test('overlapping manual and scheduled attempts cannot both claim the same record', async () => {
  const { env, opts } = setup(); const input = await loadMatchRow(env, 1); let calls = 0, release, entered;
  const wait = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  opts.fetchImpl = async () => { calls++; entered(); await wait; return Response.json({ count: 0, releases: [] }); };
  const a = prepareSource(env, 1, input, false, opts); await started;
  assert.equal(await prepareSource(env, 1, input, true, opts), null); release(); await a; assert.equal(calls, 1);
});

test('crashed claims recover with a finite attempt budget', async () => {
  const { env, opts, calls, objects } = setup(); const input = await loadMatchRow(env, 1);
  objects.set(key(1), { etag: 'crashed', body: JSON.stringify({ inputKey: await sourceInputKey(input), status: 'running',
    attempts: 3, retryAt: new Date(opts.now() - 1).toISOString(), updatedAt: new Date(opts.now()).toISOString() }) });
  assert.equal((await prepareSource(env, 1, input, false, opts)).status, 'paused'); assert.equal(calls(), 0);
});

test('record GET displays saved evidence without fetching providers or requiring editing credentials', async () => {
  const { env, opts, calls } = setup(); const input = await loadMatchRow(env, 1);
  await prepareSource(env, 1, input, false, opts);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('GET must never call an external provider'); };
  try {
    const res = await createApp().request('/api/items/1', {}, env); assert.equal(res.status, 200);
    const body = await res.json(); assert.equal(body.sourcePreparation.status, 'ready');
    const html = sourcePreparationHtml(body.sourcePreparation); assert.match(html, /ready for review/); assert.match(html, /No candidates returned/);
    assert.equal(calls(), 1);
  } finally { globalThis.fetch = oldFetch; }
  assert.match(sourcePreparationHtml({ status: 'paused', evidence: { error: '<script>' } }), /&lt;script&gt;/);
});

test('bounded scans advance and wrap, and capped results are retained without automatic retries', async () => {
  const { env, opts, calls } = setup(12);
  env.DB.raw.exec('UPDATE capture SET catno_raw=NULL WHERE item_id <= 10');
  assert.deepEqual(await runSourcePreparation(env, opts), { inspected: 10, prepared: 0, retriesQueued: 0 });
  opts.fetchImpl = async () => Response.json({ count: 100, releases: [] });
  assert.equal((await runSourcePreparation(env, opts)).prepared, 1);
  const p = await sourcePreparation(env, 11, await loadMatchRow(env, 11));
  assert.equal(p.status, 'ready'); assert.equal(p.evidence.preview.incomplete, true);
  assert.equal(await prepareSource(env, 11, await loadMatchRow(env, 11), false, opts), null);
  await runSourcePreparation(env, opts); await runSourcePreparation(env, opts);
  assert.equal(await env.CACHE.get('source-preparation:cursor:v1'), '0');
});

test('a failed explicit refresh retains earlier leads and displays its failure separately', async () => {
  const { env, opts, advance } = setup(); const input = await loadMatchRow(env, 1);
  opts.fetchImpl = async () => Response.json({ count: 1, releases: [{
    id: '20d365ff-0752-4cab-9978-6cdeab8d3bea', title: 'Earlier candidate', media: [{ format: 'Vinyl' }],
  }] });
  const first = await prepareSource(env, 1, input, false, opts);
  advance(86_400_001);
  opts.fetchImpl = async () => { throw new Error('Provider unavailable'); };
  const failed = await prepareSource(env, 1, input, true, opts);
  assert.equal(failed.status, 'incomplete');
  // Transport errors inside the provider client return an incomplete preview.
  assert.equal(failed.preview.incomplete, true);
  const html = sourcePreparationHtml({ status: failed.status, evidence: failed });
  assert.match(html, /provider request failed/); assert.match(html, /Provider unavailable/);
  assert.match(html, /Earlier saved leads/); assert.match(html, /Earlier candidate/);
  assert.equal(failed.retainedPreview.retrievedAt, first.preview.retrievedAt);
});

test('an older in-flight result cannot replace evidence claimed for corrected readings', async () => {
  const { env, opts, objects, advance } = setup(); const input = await loadMatchRow(env, 1);
  let release, entered;
  const wait = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  opts.fetchImpl = async () => { entered(); await wait; return Response.json({ count: 0, releases: [] }); };
  const old = prepareSource(env, 1, input, false, opts); await started;
  const newKey = await sourceInputKey({ ...input, catnoRaw: 'CORRECTED 999' });
  objects.set(key(1), { etag: 'new-owner', body: JSON.stringify({ inputKey: newKey, status: 'ready' }) });
  release(); await old;
  assert.equal(JSON.parse(objects.get(key(1)).body).inputKey, newKey);
});

test('authenticated manual search returns persisted evidence while reusing the source cache', async () => {
  const { env, opts } = setup(); env.EDIT_TOKEN = 'fixture';
  await prepareSource(env, 1, await loadMatchRow(env, 1), false, opts);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Expected source cache reuse'); };
  try {
    const res = await createApp().request('/api/items/1/musicbrainz', { method: 'POST',
      headers: { 'x-edit-token': 'fixture', 'x-capturer': 'Joe' } }, env);
    assert.equal(res.status, 200); const body = await res.json();
    assert.equal(body.cached, true); assert.equal(body.sourcePreparation.status, 'ready');
    assert.equal(body.sourcePreparation.evidence.inputKey, await sourceInputKey(await loadMatchRow(env, 1)));
  } finally { globalThis.fetch = oldFetch; }
});

test('a full scan bounds database reads and writes the shared cursor only once', async () => {
  const { env, opts } = setup(12);
  env.DB.raw.exec('UPDATE capture SET catno_raw=NULL');
  const put = env.CACHE.put, prepare = env.DB.prepare; let cursorWrites = 0, statements = 0;
  env.CACHE.put = async (key, ...args) => {
    if (key === 'source-preparation:cursor:v1') cursorWrites++;
    return put(key, ...args);
  };
  env.DB.prepare = (...args) => { statements++; return prepare(...args); };
  assert.equal((await runSourcePreparation(env, opts)).inspected, 10);
  assert.equal(cursorWrites, 1, 'KV limits writes to one per second per key');
  assert.ok(statements <= 11, 'leave database-call headroom for the Discogs job');
});
