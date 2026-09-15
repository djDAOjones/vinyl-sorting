import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/bindings.mjs';
import { previewMusicBrainz, musicbrainzCandidate, musicbrainzQueries } from '../../worker/musicbrainz.ts';
import { musicbrainzResultsHtml } from '../../src/musicbrainz-panel.ts';
import { createApp } from '../../worker/index.ts';

const id = '20d365ff-0752-4cab-9978-6cdeab8d3bea';
const input = { catnoRaw: 'CB 391-12', labelRaw: 'Charisma', titleRaw: 'Keep It Dark', nameRaw: 'Genesis' };
const release = { id, title: 'Keep It Dark', 'artist-credit': [{ name: 'Genesis' }],
  'label-info': [{ 'catalog-number': 'CB 391/12', label: { name: 'Charisma' } }], media: [{ format: '12" Vinyl', 'track-count': 3 }] };
const response = (releases = [release], count = releases.length) => Response.json({ count, releases });

// Strong conditional-put contract rather than the photo fixture's permissive put.
function leaseBucket() {
  let object = null, sequence = 0;
  return {
    get: async () => object ? { ...object, json: async () => JSON.parse(object.body) } : null,
    put: async (_key, body, opts = {}) => {
      if (opts.onlyIf?.etagMatches && opts.onlyIf.etagMatches !== object?.etag) return null;
      if (opts.onlyIf?.etagDoesNotMatch === '*' && object) return null;
      object = { body, etag: String(++sequence) };
      return { ...object };
    },
  };
}
function setup() {
  const env = makeEnv(); env.PHOTOS = leaseBucket();
  let time = 1_000_000;
  const clock = { now: () => time, sleep: async ms => { time += ms; } };
  return { env, clock, advance: ms => { time += ms; } };
}

test('MusicBrainz queries retain alternate numbers and exclude uncertain catalogue numbers', () => {
  const q = musicbrainzQueries({ ...input, otherNumbers: 'CB 392\nCB 393' });
  assert.ok(q[0].query.includes('CB 392')); assert.ok(q[0].query.includes('CB 393'));
  assert.ok(!musicbrainzQueries({ ...input, catnoRaw: '?' }).some(q => q.kind === 'Catalogue numbers'));
  assert.deepEqual(musicbrainzQueries({ catnoRaw: '?' }), []);
  assert.ok(musicbrainzQueries({ titleRaw: 'x" OR artist:*', nameRaw: 'Unknown' }).every(q => !q.query.includes('artist:*')));
});

test('number agreement alone does not hide unrelated content or format/label differences', () => {
  const c = musicbrainzCandidate({ ...release, title: 'Different album', 'artist-credit': [{ name: 'Other person' }],
    'label-info': [{ 'catalog-number': 'CB 391-12', label: { name: 'Other Label' } }], media: [{ format: 'CD', 'track-count': 3 }] }, input);
  assert.deepEqual(c.agreements, ['Catalogue number']);
  assert.ok(c.differences.includes('Other format: context only'));
  assert.ok(c.differences.some(d => d.startsWith('Label differs')));
  assert.equal(musicbrainzCandidate({ ...release, id: '"><script>' }, input), null);
});

test('serial source searches are paced, cached, and leave every catalogue table unchanged', async () => {
  const { env, clock, advance } = setup();
  const before = env.DB.raw.prepare('SELECT * FROM field_source').all();
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ time: clock.now(), url: String(url), opts }); return response(); };
  const p = await previewMusicBrainz(env, input, { ...clock, fetchImpl });
  assert.equal(calls.length, 2); assert.ok(calls[1].time - calls[0].time >= 1000);
  assert.match(calls[0].opts.headers['User-Agent'], /VinylSorter.*github/);
  assert.equal(p.candidates.length, 1); assert.equal(p.incomplete, false);
  assert.deepEqual(env.DB.raw.prepare('SELECT * FROM field_source').all(), before);
  for (const table of ['item','capture','release','match_run','raw_value','review_decision']) assert.equal(env.DB.raw.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal((await previewMusicBrainz(env, input, { ...clock, fetchImpl })).cached, true);
  assert.equal(calls.length, 2);
  advance(2000);
  await previewMusicBrainz(env, { ...input, titleRaw: 'Updated title' }, { ...clock, fetchImpl });
  assert.equal(calls.length, 4, 'new input cannot receive old cache');
});

test('two callers race for one global lease; only one reaches the provider', async () => {
  const { env, clock } = setup();
  let finish, entered;
  const started = new Promise(r => { entered = r; });
  const hold = new Promise(r => { finish = r; });
  let calls = 0;
  const fetchImpl = async () => { calls++; entered(); await hold; return response(); };
  const first = previewMusicBrainz(env, input, { ...clock, fetchImpl });
  await started;
  await assert.rejects(previewMusicBrainz(env, { ...input, titleRaw: 'Other' }, { ...clock, fetchImpl }), /search.*running|search started/);
  assert.equal(calls, 1); finish(); await first;
});

test('503 retries are bounded and partial evidence remains incomplete and briefly cached', async () => {
  const { env, clock } = setup(); let calls = 0;
  const p = await previewMusicBrainz(env, input, { ...clock, fetchImpl: async () => {
    calls++; return calls <= 2 ? new Response('busy', { status: 503 }) : response();
  } });
  assert.equal(calls, 3); assert.equal(p.attempts[0].requests, 2);
  assert.match(p.attempts[0].error, /503/); assert.equal(p.incomplete, true);
  assert.equal(p.candidates.length, 1); assert.equal(Date.parse(p.expiresAt) - Date.parse(p.retrievedAt), 60_000);
});

test('truncated responses and malformed candidates remain incomplete, never no-match verdicts', async () => {
  const { env, clock } = setup();
  const p = await previewMusicBrainz(env, input, { ...clock, fetchImpl: async () => response([release, { id: 'bad' }], 40) });
  assert.equal(p.incomplete, true); assert.equal(p.candidates.length, 1);
  const html = musicbrainzResultsHtml(p); assert.match(html, /Search incomplete/); assert.match(html, /2 of 40/);
});

test('long upstream pause and unavailable coordination fail without uncontrolled traffic', async () => {
  const { env, clock } = setup();let calls = 0;
  const p = await previewMusicBrainz(env, { catnoRaw: 'CB 391' }, { ...clock, fetchImpl: async () => { calls++; return new Response('', { status: 503, headers: { 'retry-after': '60' } }); } });
  assert.equal(calls, 1);assert.match(p.attempts[0].error, /longer pause/);
  env.PHOTOS = undefined;
  await assert.rejects(previewMusicBrainz(env, input, { ...clock, fetchImpl: async () => { throw new Error('unexpected'); } }), /coordination/);
});

test('source route requires edit token and known name; never accepts arbitrary query text', async () => {
  const env = makeEnv();env.EDIT_TOKEN = 'fixture';
  env.DB.raw.exec("INSERT INTO item DEFAULT VALUES; INSERT INTO capture(item_id,catno_raw) VALUES(1,'?');");
  const app = createApp(), path = '/api/items/1/musicbrainz';
  assert.equal((await app.request(path, { method: 'POST' }, env)).status, 401);
  assert.equal((await app.request(path, { method: 'POST', headers: { 'x-edit-token': 'fixture' } }, env)).status, 401);
  const headers = { 'x-edit-token': 'fixture', 'x-capturer': 'Joe' };
  assert.equal((await app.request(path, { method: 'POST', headers, body: JSON.stringify({ query: 'ANYTHING' }) }, env)).status, 422);
  assert.equal((await app.request('/api/items/99/musicbrainz', { method: 'POST', headers }, env)).status, 404);
});

test('rendered source text is escaped and links use validated release identities', async () => {
  const { env, clock } = setup();
  const p = await previewMusicBrainz(env, input, { ...clock, fetchImpl: async () => response([{ ...release, title: '<img src=x onerror=alert(1)>' }]) });
  const html = musicbrainzResultsHtml(p);
  assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes(`https://musicbrainz.org/release/${id}`));
});

test('conditional lease acquisition refuses a simultaneous stale read and expired leases recover', async () => {
  const { env, clock, advance } = setup();
  const store = env.PHOTOS;let readers = 0, unlock;
  const barrier = new Promise(r => { unlock = r; });
  env.PHOTOS = { ...store, get: async key => {
    const snapshot = await store.get(key);
    if (++readers === 2) unlock();
    await barrier; return snapshot;
  } };
  let calls = 0;
  const options = { ...clock, fetchImpl: async () => { calls++; return response(); } };
  const results = await Promise.allSettled([previewMusicBrainz(env, input, options), previewMusicBrainz(env, { ...input, titleRaw: 'Different' }, options)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 2, 'losing conditional writer cannot reach upstream');
  advance(100_000);env.PHOTOS = store;
  await previewMusicBrainz(env, { ...input, titleRaw: 'After expiry' }, options);
  assert.equal(calls, 4);
});
