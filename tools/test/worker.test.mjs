// @ts-check
/**
 * M1-WORKER — named operations only, and a token no route can aim.
 *
 * The Worker is exercised through real HTTP requests against real
 * SQLite, so these are not mocks of the behaviour under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeEnv, makeKv } from './helpers/bindings.mjs';
import { createApp } from '../../worker/index.ts';
import { parseCapture } from '../../worker/capture.ts';
import { BUDGETS, RateLimiter } from '../../worker/rate-limit.ts';

const app = createApp();
const post = (env, body, path = '/api/captures') => app.request(path,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);

// ── the security posture of a Worker with no sign-in ───────────────

test('no route reads DISCOGS_TOKEN — the token is unreachable, not merely unused', () => {
  const files = readdirSync('worker').filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const src = readFileSync(`worker/${f}`, 'utf8');
    // Strip comments: the reasoning discusses the token by name.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const reads = code.match(/\benv\s*\.\s*DISCOGS_TOKEN\b/g) ?? [];
    if (f === 'env.ts') {
      assert.equal(reads.length, 0, 'env.ts declares the binding; it must not read it');
      assert.ok(src.includes('DISCOGS_TOKEN'), 'the binding is still declared');
    } else {
      assert.equal(reads.length, 0, `${f} reads DISCOGS_TOKEN — no route may, until M2 revisits auth`);
    }
  }
});

test('the Worker makes no outbound request at all', () => {
  // The strongest form of "no proxy": not that the upstream URL is
  // hard-coded, but that there is no outbound call to hard-code one
  // into. A bare `fetch(` is an outbound request; `something.fetch(`
  // is Hono dispatching an inbound one, which is the entry point.
  for (const f of readdirSync('worker').filter((n) => n.endsWith('.ts'))) {
    const code = readFileSync(`worker/${f}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const outbound = code.match(/(?<![.\w$])fetch\s*\(/g) ?? [];
    assert.equal(outbound.length, 0, `${f} makes an outbound request`);
    assert.doesNotMatch(code, /api\.discogs\.com|musicbrainz\.org/, `${f} names an upstream`);
  }
});

test('an unnamed route is refused rather than falling through', async () => {
  const env = makeEnv();
  for (const path of ['/api/proxy', '/api/discogs/search', '/anything', '/api/items/1/../..']) {
    const res = await app.request(path, {}, env);
    assert.equal(res.status, 404, path);
    assert.equal((await res.json()).error, 'no such operation');
  }
});

// ── capture validation ────────────────────────────────────────────

test('a photo-only capture is valid — photo-first means typing nothing', () => {
  const r = parseCapture({ clientId: 'c1', crate: 'B4', photos: [{ kind: 'label_a', r2Key: 'labels/x.jpg' }] });
  assert.equal(r.ok, true);
  assert.equal(r.value.catnoRaw, undefined);
});

test('a capture with neither photo nor catalogue number is refused', () => {
  const r = parseCapture({ clientId: 'c1', crate: 'B4' });
  assert.equal(r.ok, false);
  assert.match(r.error, /photo or a catalogue number/);
});

test('crate is required so the disc can be found again', () => {
  const r = parseCapture({ clientId: 'c1', catnoRaw: 'SXL 6113' });
  assert.equal(r.ok, false);
  assert.match(r.error, /crate is required/);
});

test('clientId is required so a retried queue entry cannot double-write', () => {
  const r = parseCapture({ crate: 'B4', catnoRaw: 'SXL 6113' });
  assert.equal(r.ok, false);
  assert.match(r.error, /clientId is required/);
});

test('grades and photo kinds are constrained at the edge, not only in SQL', () => {
  const base = { clientId: 'c1', crate: 'B4', catnoRaw: 'X' };
  assert.equal(parseCapture({ ...base, mediaGrade: 'VG++' }).ok, false);
  assert.equal(parseCapture({ ...base, mediaGrade: 'VG+' }).ok, true);
  assert.equal(parseCapture({ ...base, photos: [{ kind: 'selfie', r2Key: 'k' }] }).ok, false);
});

test('whitespace-only values are treated as absent, not stored as blanks', () => {
  const r = parseCapture({ clientId: 'c1', crate: 'B4', catnoRaw: 'X', labelRaw: '   ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.labelRaw, undefined);
});

// ── writing a capture ─────────────────────────────────────────────

test('a capture writes item, capture and shelf provenance — unconfirmed', async () => {
  const env = makeEnv();
  const res = await post(env, {
    clientId: 'c1', crate: 'B4', position: '12', catnoRaw: 'SXL 6113',
    labelRaw: 'Decca', nameRaw: 'Solti', mediaGrade: 'VG+', capturedBy: 'joe',
  });
  assert.equal(res.status, 201);

  const q = (sql) => env.DB.raw.prepare(sql).all();
  assert.equal(q('SELECT * FROM item')[0].crate, 'B4');
  assert.equal(q('SELECT * FROM capture')[0].catno_raw, 'SXL 6113');

  const sources = q('SELECT entity, field, source, confirmed_at FROM field_source');
  assert.ok(sources.length > 0);
  assert.ok(sources.every((s) => s.source === 'shelf'), 'a person read these off the disc');
  assert.ok(sources.every((s) => s.confirmed_at === null),
    'reading a label is not verifying a pressing — M2 confirms, not capture');
  assert.equal(Number(q('SELECT COUNT(*) n FROM v_decision_eligible_item')[0].n), 0);
});

test('replaying a queued entry does not create a second disc', async () => {
  const env = makeEnv();
  const body = { clientId: 'same-id', crate: 'B4', catnoRaw: 'SXL 6113' };
  const first = await post(env, body);
  const replay = await post(env, body);

  assert.equal(first.status, 201);
  assert.equal(replay.status, 200, 'a replay is not an error — the client may drop the entry either way');
  assert.equal((await first.json()).itemId, (await replay.json()).itemId);
  assert.equal(Number(env.DB.raw.prepare('SELECT COUNT(*) n FROM item').all()[0].n), 1);
});

test('photos are attached to the item they were captured with', async () => {
  const env = makeEnv();
  await post(env, {
    clientId: 'c1', crate: 'B4',
    photos: [{ kind: 'label_a', r2Key: 'labels/a.jpg' }, { kind: 'label_b', r2Key: 'labels/b.jpg' }],
  });
  const photos = env.DB.raw.prepare('SELECT kind, r2_key FROM item_photo ORDER BY kind').all();
  assert.deepEqual(photos.map((p) => p.kind), ['label_a', 'label_b']);
});

test('malformed JSON is a 400, not a 500', async () => {
  const env = makeEnv();
  const res = await app.request('/api/captures',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }, env);
  assert.equal(res.status, 400);
});

// ── photo upload ──────────────────────────────────────────────────

test('photo upload rejects unsupported types and oversized bodies', async () => {
  const env = makeEnv();
  const put = (headers) => app.request('/api/photos/abc.jpg',
    { method: 'PUT', headers, body: new Uint8Array([1, 2, 3]) }, env);

  assert.equal((await put({ 'content-type': 'application/pdf' })).status, 415);
  assert.equal((await put({ 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024) })).status, 413);

  const ok = await put({ 'content-type': 'image/jpeg' });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).r2Key, 'labels/abc.jpg');
  assert.ok(env.PHOTOS.store.has('labels/abc.jpg'));
});

test('a photo key cannot escape its prefix', async () => {
  const env = makeEnv();
  const res = await app.request('/api/photos/..%2F..%2Fetc%2Fpasswd',
    { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([1]) }, env);
  assert.equal(res.status, 404, 'the route pattern refuses anything but a plain key');
});

// ── reads ─────────────────────────────────────────────────────────

test('items paginate by keyset and report where to continue', async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) await post(env, { clientId: `c${i}`, crate: 'B4', catnoRaw: `X${i}` });

  const page = await (await app.request('/api/items?limit=2', {}, env)).json();
  assert.equal(page.items.length, 2);
  assert.equal(page.nextAfter, page.items[1].id);

  const next = await (await app.request(`/api/items?limit=2&after=${page.nextAfter}`, {}, env)).json();
  assert.equal(next.items[0].id, page.items[1].id + 1);

  const last = await (await app.request('/api/items?limit=100', {}, env)).json();
  assert.equal(last.nextAfter, null, 'a short page means the end');
});

test('item detail carries its provenance, so trust is visible', async () => {
  const env = makeEnv();
  await post(env, { clientId: 'c1', crate: 'B4', catnoRaw: 'SXL 6113' });
  const body = await (await app.request('/api/items/1', {}, env)).json();
  assert.equal(body.item.crate, 'B4');
  assert.equal(body.captures.length, 1);
  assert.ok(body.provenance.length > 0);
  assert.ok(body.provenance.every((p) => p.confirmed_at === null));
});

test('a missing item is a 404', async () => {
  assert.equal((await app.request('/api/items/999', {}, makeEnv())).status, 404);
});

test('the decision-eligible endpoint reads through the views', async () => {
  const env = makeEnv();
  await post(env, { clientId: 'c1', crate: 'B4', catnoRaw: 'SXL 6113' });
  const body = await (await app.request('/api/decision-eligible', {}, env)).json();
  assert.deepEqual(body, { eligibleItems: 0, eligibleCoverage: 0 });
});

// ── central rate limiting ─────────────────────────────────────────

test('the limiter enforces the shared budgets AGENTS.md fixes', () => {
  assert.deepEqual(BUDGETS.discogs, { limit: 50, windowMs: 60_000 });
  assert.deepEqual(BUDGETS.musicbrainz, { limit: 1, windowMs: 1_000 });
});

test('the budget is shared, not per caller', async () => {
  const kv = makeKv();
  let now = 1_000_000;
  // Two limiters standing in for two isolates serving two people.
  const a = new RateLimiter(kv, () => now);
  const b = new RateLimiter(kv, () => now);

  for (let i = 0; i < 50; i++) {
    const who = i % 2 === 0 ? a : b;
    assert.equal((await who.take('discogs')).allowed, true, `request ${i}`);
  }
  const over = await a.take('discogs');
  assert.equal(over.allowed, false, 'two people cataloguing at once must not double the limit');
  assert.ok(over.retryAfterMs > 0 && over.retryAfterMs <= 60_000);
});

test('a new window restores the budget', async () => {
  const kv = makeKv();
  let now = 1_000_000;
  const limiter = new RateLimiter(kv, () => now);
  await limiter.take('musicbrainz');
  assert.equal((await limiter.take('musicbrainz')).allowed, false, '1/sec means one');

  now += 1_000;
  assert.equal((await limiter.take('musicbrainz')).allowed, true);
});

test('remaining counts down and never goes negative', async () => {
  const kv = makeKv();
  const limiter = new RateLimiter(kv, () => 1_000_000);
  assert.equal((await limiter.take('discogs')).remaining, 49);
  assert.equal((await limiter.take('discogs')).remaining, 48);
  for (let i = 0; i < 60; i++) await limiter.take('discogs');
  assert.equal((await limiter.take('discogs')).remaining, 0);
});
