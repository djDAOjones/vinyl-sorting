import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparableEdition, findSimilarPrice, runPriceBatch, PRICE_INDEX_KEY, readPriceIndex } from '../../worker/pricing.ts';
import { DiscogsClient } from '../../worker/discogs.ts';
import { makeEnv } from './helpers/bindings.mjs';
import { createApp } from '../../worker/index.ts';

const now = () => Date.parse('2026-09-15T14:00:00Z');
const release = (id = 100, extra = {}) => ({ id, master_id: 50, country: 'UK', year: 1970,
  formats: [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album', 'Stereo'] }],
  tracklist: [{ type_: 'track', title: 'First Song' }, { type_: 'track', title: 'Second Song' }],
  lowest_price: null, num_for_sale: 0, ...extra });
const version = (id, extra = {}) => ({ id, country: 'UK', major_formats: ['Vinyl'], released: '1970', ...extra });
const client = (releases, versions = []) => ({
  budgetSpent: () => false,
  getRelease: async id => { if (!releases[id]) throw new Error('provider failed'); return releases[id]; },
  getVersions: async () => ({ versions }),
});
const seed = (n = 1) => {
  const env = makeEnv();
  for (let i = 1; i <= n; i++) env.DB.raw.exec(`
    INSERT INTO release (id, discogs_id) VALUES (${i}, ${99 + i});
    INSERT INTO item (id, release_id) VALUES (${i}, ${i});
    INSERT INTO capture (item_id, title_raw) VALUES (${i}, 'Human reading');
    INSERT INTO field_source (entity, entity_id, field, source, confirmed_by, confirmed_at)
      VALUES ('item', ${i}, 'release_id', 'discogs', 'Joe', '2026-09-15');
  `);
  return env;
};

test('comparability rejects CD, box sets, another master, different programmes and explicit mono/stereo conflicts', () => {
  const a = release();
  assert.equal(comparableEdition(a, release(200, { country: 'Germany', year: 1980 })), true);
  for (const extra of [
    { master_id: 51 }, { formats: [{ name: 'CD', qty: '1' }] },
    { formats: [{ ...a.formats[0], qty: '2' }] },
    { formats: [{ ...a.formats[0], descriptions: ['LP', 'Album', 'Mono'] }] },
    { formats: [{ ...a.formats[0], descriptions: ['12"', '45 RPM', 'Single'] }] },
    { tracklist: [] }, { tracklist: [{ type_: 'track', title: 'First Song (Remix)' }] },
  ]) assert.equal(comparableEdition(a, release(200, extra)), false, JSON.stringify(extra));
});

test('fallback prefers same-country vinyl and checks actual release details, not summary prices', async () => {
  const c = client({ 200: release(200, { lowest_price: 7.5, num_for_sale: 2 }) },
    [version(300, { country: 'US' }), version(900, { major_formats: ['CD'] }), version(200)]);
  const result = await findSimilarPrice(release(), c, now);
  assert.deepEqual(result, { amount: 7.5, currency: 'GBP', sourceReleaseId: 200, masterId: 50,
    checkedAt: '2026-09-15T14:00:00.000Z', country: 'UK', year: 1970, forSale: 2 });
});

test('fallback is bounded to two version pages and four release requests', async () => {
  let pages = 0, details = 0;
  const c = { budgetSpent: () => false,
    getVersions: async (_, page) => { pages++; return { pagination: { pages: 100 }, versions: Array.from({ length: 50 }, (_, i) => version(200 + i + page * 100)) }; },
    getRelease: async id => { details++; return release(id); },
  };
  assert.equal(await findSimilarPrice(release(), c, now), null);
  assert.equal(pages, 2); assert.equal(details, 4);
});

test('exact prices win and fresh checks are reused without requests', async () => {
  const env = seed(); let calls = 0;
  const c = client({ 100: release(100, { lowest_price: 12, num_for_sale: 3 }) });
  c.getVersions = async () => { throw new Error('must not discover editions for a priced release'); };
  const get = c.getRelease; c.getRelease = async id => { calls++; return get(id); };
  assert.deepEqual(await runPriceBatch(env, c, now), { checked: 1, similar: 0, failed: 0 });
  assert.equal(env.DB.raw.prepare('SELECT lowest_price FROM release').get().lowest_price, 12);
  await runPriceBatch(env, c, now); assert.equal(calls, 1);
});

test('fallback persists separately, API links it only to the confirmed release, and identity/capture stay unchanged', async () => {
  const env = seed();
  const before = env.DB.raw.prepare('SELECT * FROM capture').all();
  const provenance = env.DB.raw.prepare('SELECT * FROM field_source').all();
  const c = client({ 100: release(), 200: release(200, { lowest_price: 5, num_for_sale: 4 }) }, [version(200)]);
  assert.deepEqual(await runPriceBatch(env, c, now), { checked: 1, similar: 1, failed: 0 });
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM capture').all(), before);
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM field_source').all(), provenance);
  assert.equal(env.DB.raw.prepare('SELECT release_id FROM item').get().release_id, 1);
  assert.equal(env.DB.raw.prepare('SELECT lowest_price FROM release').get().lowest_price, null);
  const app = createApp();
  const list = await (await app.request('/api/items', {}, env)).json();
  const detail = await (await app.request('/api/items/1', {}, env)).json();
  assert.equal(list.items[0].similar_price.amount, 5);
  assert.deepEqual(detail.release.similar_price, list.items[0].similar_price);
  env.DB.raw.exec('UPDATE release SET lowest_price = 8');
  assert.equal((await (await app.request('/api/items', {}, env)).json()).items[0].similar_price, null);
  env.DB.raw.exec('UPDATE release SET lowest_price = NULL; UPDATE field_source SET confirmed_at = NULL, confirmed_by = NULL');
  assert.equal((await (await app.request('/api/items', {}, env)).json()).items[0].similar_price, null);
  assert.equal((await (await app.request('/api/items/1', {}, env)).json()).release.similar_price, null);
});

test('failed checks preserve existing prices and estimates; no price response is not no listings', async () => {
  const env = seed();
  env.DB.raw.exec("UPDATE release SET lowest_price = 15, price_checked_at = '2026-01-01'");
  const estimate = { amount: 9, currency: 'GBP', sourceReleaseId: 200 };
  await env.CACHE.put(PRICE_INDEX_KEY, JSON.stringify({ 100: { retryAt: 0, estimate } }));
  const result = await runPriceBatch(env, client({ 100: { id: 100 } }), now);
  assert.equal(result.failed, 1);
  assert.equal(env.DB.raw.prepare('SELECT lowest_price FROM release').get().lowest_price, 15);
  assert.deepEqual((await readPriceIndex(env))[100].estimate, estimate);
});

test('unconfirmed releases never trigger pricing and five-record limit gives progress without an unbounded job', async () => {
  const env = seed(7);
  env.DB.raw.exec('UPDATE field_source SET confirmed_at = NULL, confirmed_by = NULL WHERE entity_id = 1');
  const c = client(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [100 + i, release(100 + i, { lowest_price: 1 })])));
  assert.equal((await runPriceBatch(env, c, now)).checked, 5);
  assert.equal(env.DB.raw.prepare('SELECT price_checked_at FROM release WHERE id = 1').get().price_checked_at, null);
});

test('edition requests use the central limiter and candidate prices explicitly request GBP', async () => {
  const seen = []; let tokens = 0;
  const c = new DiscogsClient('test-token', { take: async () => { tokens++; return { allowed: true }; } },
    async url => { seen.push(new URL(url)); return new Response('{}'); });
  await c.getVersions(50, 2); await c.getRelease(200);
  assert.equal(tokens, 2);
  assert.equal(seen[0].pathname, '/masters/50/versions');
  assert.equal(seen[0].searchParams.get('page'), '2');
  assert.equal(seen[1].searchParams.get('curr_abbr'), 'GBP');
});
