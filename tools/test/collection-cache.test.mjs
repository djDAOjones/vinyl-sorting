import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../worker/index.ts';
import { collectionCacheKey, allowanceReset } from '../../worker/collection-cache.ts';
import { makeEnv } from './helpers/bindings.mjs';
import { PRICE_DUE_SQL, runPriceBatch } from '../../worker/pricing.ts';
const app = createApp();
const quota = () => { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."); };
const unavailable = env => ({ ...env, DB: { prepare: quota } });

test('a successful collection read is saved and a quota failure serves it with a date', async () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO item (id, list) VALUES(1,'classical'); INSERT INTO capture(item_id,title_raw) VALUES(1,'Saved title')");
  const path = '/api/items?limit=500&after=0';
  const fresh = await (await app.request(path, {}, env)).json();
  assert.equal(fresh.snapshot, undefined);
  const response = await app.request(path, {}, unavailable(env));
  const cached = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(cached.items, fresh.items);
  assert.equal(cached.snapshot.reason, 'daily-read-limit');
  assert.ok(Number.isFinite(Date.parse(cached.snapshot.savedAt)));
  assert.ok(cached.snapshot.resumesAt.endsWith('T00:00:00.000Z'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('snapshots are page-specific, missing pages stay explicit errors and recovery returns fresh data', async () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO item (id) VALUES(1),(2)");
  await app.request('/api/items?limit=1&after=0', {}, env);
  const missing = await app.request('/api/items?limit=1&after=1', {}, unavailable(env));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, 'daily-read-limit');
  env.DB.raw.exec("UPDATE item SET crate='Updated' WHERE id=1");
  const restored = await (await app.request('/api/items?limit=1&after=0', {}, env)).json();
  assert.equal(restored.items[0].crate, 'Updated');
  assert.equal(restored.snapshot, undefined);
});

test('list definitions survive quota errors, while writes and record details never use snapshots', async () => {
  const env = makeEnv();
  const lists = await (await app.request('/api/lists', {}, env)).json();
  assert.deepEqual((await (await app.request('/api/lists', {}, unavailable(env))).json()).lists, lists.lists);
  assert.equal((await app.request('/api/items/1', {}, unavailable(env))).status, 503);
  const write = await app.request('/api/captures', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'quota-capture', catnoRaw: 'ABC1' }) }, unavailable(env));
  assert.equal(write.status, 503);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM item').get().n, 0);
});

test('snapshot storage faults cannot break live reads; absent cache cannot hide service errors', async () => {
  const env = makeEnv(); env.PHOTOS.put = async () => { throw new Error('storage failed'); };
  assert.equal((await app.request('/api/items', {}, env)).status, 200);
  assert.equal((await app.request('/api/items', {}, unavailable(env))).status, 503);
  assert.equal(collectionCacheKey('/api/items/1', {}), null);
  assert.equal(collectionCacheKey('/api/items', { after: '../1' }), '_system/collection-cache/v1/items-0-100.json');
  assert.equal(collectionCacheKey('/api/items', { after: '-1' }), null);
  assert.equal(allowanceReset(Date.parse('2026-09-15T16:00:00Z')), '2026-09-16T00:00:00.000Z');
});

test('pricing selection uses one indexed confirmation pass and deduplicates physical copies', async () => {
  const env = makeEnv();
  const plan = env.DB.raw.prepare('EXPLAIN QUERY PLAN ' + PRICE_DUE_SQL).all().map(r => r.detail).join('\n');
  assert.doesNotMatch(plan, /CORRELATED|SCAN [ir]\b/,
    'must not rescan every confirmation for each release or scan every item');
  env.DB.raw.exec(`INSERT INTO release (id,discogs_id) VALUES(1,100);
    INSERT INTO item (id,release_id) VALUES(1,1),(2,1);
    INSERT INTO field_source (entity,entity_id,field,source,confirmed_by,confirmed_at)
      VALUES('item',1,'release_id','discogs','Joe','2026-09-15'),('item',2,'release_id','discogs','Joe','2026-09-15')`);
  const result = await runPriceBatch(env, { budgetSpent: () => false,
    getRelease: async () => ({ id: 100, lowest_price: 5, num_for_sale: 2 }), getVersions: async () => { throw new Error('not needed'); } });
  assert.equal(result.checked, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM item').get().n, 2);
});
