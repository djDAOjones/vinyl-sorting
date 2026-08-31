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

/** Everything served over HTTP lives inside createApp(). */
function httpSurface() {
  const src = readFileSync('worker/index.ts', 'utf8');
  const start = src.indexOf('export function createApp()');
  const end = src.indexOf('\n  return app;', start);
  assert.ok(start >= 0 && end > start, 'could not locate the app factory');
  return src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('nothing served over HTTP can reach Discogs or the token', () => {
  // M2 gives the Worker a token and an upstream, so the M1 invariant
  // "no outbound call exists" no longer holds. The one that replaces
  // it is stricter about what matters: the HTTP surface cannot reach
  // either. Matching runs from cron, which has no caller.
  const http = httpSurface();
  for (const forbidden of ['DISCOGS_TOKEN', 'DiscogsClient', 'runMatchBatch', 'RateLimiter']) {
    assert.ok(!http.includes(forbidden),
      `a route can reach ${forbidden} — with no sign-in that is a stranger's lever on the rate limit`);
  }
});

test('the token is read on exactly one path, and it is the cron path', () => {
  const files = readdirSync('worker').filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const src = readFileSync(`worker/${f}`, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const reads = (code.match(/\benv\s*\.\s*DISCOGS_TOKEN\b/g) ?? []).length;
    if (f === 'index.ts') {
      assert.ok(reads > 0, 'runMatchBatch reads the token');
      assert.ok(!httpSurface().includes('DISCOGS_TOKEN'), 'but no route does');
    } else if (f === 'env.ts') {
      assert.equal(reads, 0, 'env.ts declares the binding; it must not read it');
      assert.ok(src.includes('DISCOGS_TOKEN'), 'the binding is still declared');
    } else {
      assert.equal(reads, 0, `${f} must not read the token directly`);
    }
  }
});

test('outbound requests exist in exactly one file, and it is the rate-limited client', () => {
  const withOutbound = [];
  for (const f of readdirSync('worker').filter((n) => n.endsWith('.ts'))) {
    const code = readFileSync(`worker/${f}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // A bare `fetch(` is outbound; `something.fetch(` is Hono
    // dispatching an inbound request, which is the entry point.
    if ((code.match(/(?<![.\w$])fetch\s*\(/g) ?? []).length) withOutbound.push(f);
  }
  assert.deepEqual(withOutbound, ['discogs.ts'],
    'every upstream call must go through the one client that rate-limits');

  const client = readFileSync('worker/discogs.ts', 'utf8');
  assert.match(client, /limiter\W+take\('discogs'\)|#limiter\.take\('discogs'\)/,
    'the client takes from the shared budget before every request');
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

test('crate is optional, because a required location gets filled with filler', () => {
  // It WAS required, on the reasoning that a session card has to say
  // where to find the disc. That assumed stable storage; the collection
  // does not have any, so the box was answered with placeholders — item
  // 448 arrived as crate "1", position "1". A database asserting a
  // location that is untrue is worse than one admitting it does not
  // know, and nothing downstream can tell the two apart.
  const r = parseCapture({ clientId: 'c1', catnoRaw: 'SXL 6113' });
  assert.equal(r.ok, true);
  assert.equal(r.value.crate, null, 'absent, not an empty string');
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

test('DATASET-VIEWER: an item with two captures is still ONE row', async () => {
  // The list used to LEFT JOIN `capture` unaggregated, so a second
  // capture row on one item returned the item twice — a screen that
  // counts its own collection wrong. One capture per item holds today
  // and nothing enforces it, so this is fixed before a duplicate
  // teaches it rather than after.
  const env = makeEnv();
  await post(env, { clientId: 'c1', crate: 'B4', catnoRaw: 'SXL 6113' });
  env.DB.raw.exec(
    "INSERT INTO capture (item_id, catno_raw, label_raw, captured_at) "
    + "VALUES (1, 'SXL 6113A', 'Decca', '2030-01-01T00:00:00Z')",
  );

  const page = await (await app.request('/api/items?limit=100', {}, env)).json();
  assert.equal(page.items.length, 1, 'one item, one row');
  assert.equal(page.items[0].catno_raw, 'SXL 6113A', 'and it is the newest capture');
  assert.equal(page.items[0].label_raw, 'Decca');
});

test('DATASET-VIEWER: the list carries what the screen filters on', async () => {
  const env = makeEnv();
  await post(env, {
    clientId: 'c1', crate: 'B4', catnoRaw: 'SXL 6113',
    photos: [{ kind: 'other', r2Key: 'labels/c1-1.jpg' }],
  });
  await post(env, { clientId: 'c2', crate: 'B4', catnoRaw: 'CFP 40001' });
  env.DB.raw.exec("INSERT INTO match_run (item_id, state, queries_json) VALUES (1, 'needs-review', '{}')");

  const { items } = await (await app.request('/api/items?limit=100', {}, env)).json();
  const [one, two] = items;
  assert.equal(one.photo_count, 1);
  assert.equal(two.photo_count, 0, 'a row with no photograph says zero, not null');
  assert.equal(one.match_state, 'needs-review');
  assert.equal(two.match_state, null, 'never matched is the absence of a run, not a state');
  assert.equal(one.release_confirmed, 0, 'nothing is confirmed by capture alone');
});

test('DATASET-VIEWER: the newest match run wins the list column', async () => {
  const env = makeEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  env.DB.raw.exec(`
    INSERT INTO match_run (item_id, state, queries_json) VALUES (1, 'rejected', '{}');
    INSERT INTO match_run (item_id, state, queries_json) VALUES (1, 'needs-review', '{}');`);
  const { items } = await (await app.request('/api/items?limit=100', {}, env)).json();
  assert.equal(items[0].match_state, 'needs-review', 're-verification is a normal operation');
});

test('BROWSE-PHOTOS: a photograph and its key need a name, and R2 never sees an invented key', async () => {
  // Signed off 2026-08-31: serve them, behind the typed name. The gate
  // is a speed bump, not access control — the roster ships in the
  // client bundle and src/who.ts says so — but it must at least be the
  // speed bump it claims, on BOTH the photograph and its address.
  const env = makeEnv();
  await post(env, {
    clientId: 'c1', catnoRaw: 'SXL 6113',
    photos: [{ kind: 'other', r2Key: 'labels/c1-1.jpg' }],
  });
  await env.PHOTOS.put('labels/c1-1.jpg', new Blob(['jpeg-bytes']).stream(),
    { httpMetadata: { contentType: 'image/jpeg' } });

  const named = { headers: { 'x-capturer': 'joe' } };   // case is forgiven

  assert.equal((await app.request('/api/photos/labels/c1-1.jpg', {}, env)).status, 401,
    'an unnamed caller gets no photograph');
  assert.equal((await app.request('/api/photos/labels/c1-1.jpg', { headers: { 'x-capturer': 'Mallory' } }, env)).status,
    401, 'and a name that is not on the roster is not a name');

  // THE REQUEST A BROWSER ACTUALLY MAKES. `<img src>` sends cookies and
  // cannot send headers, so gating on the header alone made every
  // photograph a broken image while curl with a header passed. Both
  // callers must work: fetch sets the header, an image sends the cookie.
  const byCookie = await app.request('/api/photos/labels/c1-1.jpg',
    { headers: { cookie: 'other=1; dg_who=Joe; more=2' } }, env);
  assert.equal(byCookie.status, 200, 'an <img> carries a cookie, never a header');
  assert.equal(await byCookie.text(), 'jpeg-bytes');

  assert.equal((await app.request('/api/photos/labels/c1-1.jpg',
    { headers: { cookie: 'dg_who=Mallory' } }, env)).status, 401,
  'a cookie naming nobody on the roster is not a name');

  const ok = await app.request('/api/photos/labels/c1-1.jpg', named, env);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/jpeg/);
  // THE BYTES, not just the status. A 200 carrying an empty body looked
  // identical to a served photograph until the R2 double was made to
  // keep what it was given.
  assert.equal(await ok.text(), 'jpeg-bytes', 'the photograph itself must come back');
  assert.match(ok.headers.get('cache-control'), /private/,
    'a household photograph must not sit in a shared cache');

  // The key is the photograph's address. Gating one and not the other
  // would protect nothing.
  const anon = await (await app.request('/api/items/1', {}, env)).json();
  assert.equal(anon.photos.length, 1, 'that a photograph exists is not the secret');
  assert.equal(anon.photos[0].r2_key, undefined, 'but its address is');
  const seen = await (await app.request('/api/items/1', named, env)).json();
  assert.equal(seen.photos[0].r2_key, 'labels/c1-1.jpg');

  // parseCapture only trims r2Key, so a stored key can be any string —
  // one that reaches R2 unchecked is a path the caller controls.
  assert.equal((await app.request('/api/photos/labels/not-a-real-key.jpg', named, env)).status, 404,
    'a key the database does not know never reaches R2');
});

test('DATASET-VIEWER: item detail carries the match history and the readings', async () => {
  const env = makeEnv();
  await post(env, {
    clientId: 'c1', catnoRaw: 'SXL 6113',
    photos: [{ kind: 'other', r2Key: 'labels/c1-1.jpg' }],
  });
  env.DB.raw.exec(`
    INSERT INTO match_run (item_id, state, queries_json)
      VALUES (1, 'needs-review', '{"reason":"only 1 signal family"}');
    INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json)
      VALUES (1, 1, 1451234, 73, '{"families":["identifier"]}'),
             (1, 2, 2298871, 23, '{"families":["label"]}');
    INSERT INTO review_decision (match_run_id, item_id, choice, discogs_id, decided_by)
      VALUES (1, 1, 'candidate', 1451234, 'Joe');
    INSERT INTO raw_value (item_id, field, value) VALUES (1, 'catno_raw', 'SXL 6113');
    INSERT INTO field_source (entity, entity_id, field, source)
      VALUES ('raw_value', 1, 'catno_raw', 'vision');`);

  // Named, so the detail carries the photo keys. The unnamed case is
  // asserted below — the key is the photograph's address, so it moved
  // behind the same header the photo route uses.
  const named = { headers: { 'x-capturer': 'Joe' } };
  const body = await (await app.request('/api/items/1', named, env)).json();
  assert.equal(body.photos.length, 1);
  assert.equal(body.photos[0].r2_key, 'labels/c1-1.jpg');

  assert.equal(body.runs.length, 1);
  assert.equal(body.runs[0].state, 'needs-review');
  assert.deepEqual(body.runs[0].candidates.map((c) => c.rank), [1, 2], 'ranked, so a wrong match is explicable');
  assert.equal(body.runs[0].decision.choice, 'candidate');
  assert.equal(body.runs[0].decision.decided_by, 'Joe');

  // A photo reading is DISPLAYED — the provenance rule permits that —
  // and marked as what it is.
  assert.deepEqual(body.readings, [{ id: 1, field: 'catno_raw', value: 'SXL 6113' }]);
  assert.ok(body.provenance.some((p) => p.entity === 'raw_value' && p.source === 'vision'),
    'the reading arrives with its provenance, not bare');

  // …and it is still unreachable from anything that decides.
  const confirmed = env.DB.raw.prepare(
    "SELECT COUNT(*) AS n FROM v_confirmed_field WHERE source = 'vision'").get();
  assert.equal(confirmed.n, 0);
});

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
  // Named, so the detail carries the photo keys. The unnamed case is
  // asserted below — the key is the photograph's address, so it moved
  // behind the same header the photo route uses.
  const named = { headers: { 'x-capturer': 'Joe' } };
  const body = await (await app.request('/api/items/1', named, env)).json();
  assert.equal(body.item.crate, 'B4');
  assert.equal(body.captures.length, 1);
  assert.ok(body.provenance.length > 0);
  assert.ok(body.provenance.every((p) => p.confirmed_at === null));
});

// -- correcting a reading, behind the passphrase -------------------

const SECRET = 'a shared household passphrase';
const editEnv = () => Object.assign(makeEnv(), { EDIT_TOKEN: SECRET });
const edit = (env, id, body, token = SECRET, path = 'field') => app.request(
  `/api/items/${id}/${path}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-edit-token': token } : {}) },
    body: JSON.stringify(body),
  }, env);

test('DATASET-EDIT: a write without the passphrase is refused', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });

  // Not `${SECRET} `: HTTP trims header values in transport, so a
  // trailing space never reaches the comparison. The passphrase must
  // not depend on surrounding whitespace being significant, and this
  // list is the set that genuinely differs.
  for (const token of [null, 'wrong', SECRET.toUpperCase(), SECRET.slice(0, -1), `${SECRET}x`]) {
    const res = await edit(env, 1,
      { entity: 'capture', field: 'label_raw', value: 'Decca', confirmedBy: 'Joe' }, token);
    assert.equal(res.status, 401, `token ${JSON.stringify(token)}`);
  }
  const row = env.DB.raw.prepare('SELECT label_raw FROM capture WHERE item_id = 1').get();
  assert.equal(row.label_raw, null, 'and nothing was written on the way to the refusal');
});

test('DATASET-EDIT: an unset secret means unavailable, not unlocked', async () => {
  const env = makeEnv();                     // no EDIT_TOKEN
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  const res = await edit(env, 1, { entity: 'capture', field: 'label_raw', value: 'Decca', confirmedBy: 'Joe' });
  assert.equal(res.status, 503, 'an absent secret must never read as an open door');
});

test('DATASET-EDIT: capture and the photo upload stay open', async () => {
  // The offline queue must not acquire a way to fail, and adding a row
  // is not the risk that rewriting 465 is.
  const env = editEnv();
  assert.equal((await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' })).status, 201);
  const photo = await app.request('/api/photos/open.jpg',
    { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([1]) }, env);
  assert.equal(photo.status, 201);
});

test('DATASET-EDIT: an edit lands as a CONFIRMED shelf value with a name on it', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });

  // insertCapture writes `shelf` unconfirmed: typing at a crate is not
  // verifying a pressing.
  const before = env.DB.raw.prepare(
    "SELECT source, confirmed_by FROM field_source WHERE entity='capture' AND field='catno_raw'").get();
  assert.equal(before.source, 'shelf');
  assert.equal(before.confirmed_by, null);

  const res = await edit(env, 1, { entity: 'capture', field: 'label_raw', value: '  Decca  ', confirmedBy: 'Joe' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).value, 'Decca', 'trimmed, because surrounding space says nothing');

  assert.equal(env.DB.raw.prepare('SELECT label_raw FROM capture WHERE item_id = 1').get().label_raw, 'Decca');
  const src = env.DB.raw.prepare(
    "SELECT source, confirmed_by, confirmed_at FROM field_source WHERE entity='capture' AND field='label_raw'").get();
  assert.equal(src.source, 'shelf');
  assert.equal(src.confirmed_by, 'Joe');
  assert.ok(src.confirmed_at, 'a confirmation says when as well as who');
});

test('DATASET-EDIT: editing the same field twice upserts rather than duplicating', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  await edit(env, 1, { entity: 'capture', field: 'label_raw', value: 'Deca', confirmedBy: 'Joe' });
  await edit(env, 1, { entity: 'capture', field: 'label_raw', value: 'Decca', confirmedBy: 'Jen' });

  const rows = env.DB.raw.prepare(
    "SELECT confirmed_by FROM field_source WHERE entity='capture' AND field='label_raw'").all();
  assert.equal(rows.length, 1, 'UNIQUE (entity, entity_id, field) is what makes this safe');
  assert.equal(rows[0].confirmed_by, 'Jen', 'and the latest person is the one on record');
});

test('DATASET-EDIT: confirming changes no value, which is the common case', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  const res = await edit(env, 1, { entity: 'capture', field: 'catno_raw', confirmedBy: 'Joe' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).value, 'SXL 6113', 'the value already there, read back');

  assert.equal(env.DB.raw.prepare('SELECT catno_raw FROM capture WHERE item_id = 1').get().catno_raw,
    'SXL 6113', 'untouched');
  assert.equal(env.DB.raw.prepare(
    "SELECT confirmed_by FROM field_source WHERE entity='capture' AND field='catno_raw'").get().confirmed_by,
  'Joe');
});

test('DATASET-EDIT: an item with no capture row still gets its label filled', async () => {
  // Label is captured on 0% of the backlog. Filling it is most of why
  // this screen exists, so "no capture row yet" cannot be a refusal.
  const env = editEnv();
  env.DB.raw.exec("INSERT INTO item (import_ref) VALUES ('legacy:1')");
  const res = await edit(env, 1, { entity: 'capture', field: 'label_raw', value: 'Decca', confirmedBy: 'Joe' });
  assert.equal(res.status, 200);
  assert.equal(env.DB.raw.prepare('SELECT label_raw FROM capture WHERE item_id = 1').get().label_raw, 'Decca');
});

test('DATASET-EDIT: only allow-listed fields can be named', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  for (const body of [
    { entity: 'item', field: 'release_id', value: '9', confirmedBy: 'Joe' },
    { entity: 'item', field: 'decision', value: 'sell', confirmedBy: 'Joe' },
    { entity: 'capture', field: 'id', value: '9', confirmedBy: 'Joe' },
    { entity: 'capture', field: "label_raw = 'x' --", value: 'y', confirmedBy: 'Joe' },
    { entity: 'release', field: 'title', value: 'x', confirmedBy: 'Joe' },
  ]) {
    assert.equal((await edit(env, 1, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(
    (await edit(env, 1, { entity: 'item', field: 'media_grade', value: 'AAA', confirmedBy: 'Joe' })).status,
    400, 'a grade outside the Goldmine set is refused before the CHECK constraint sees it');
  assert.equal((await edit(env, 1, { entity: 'capture', field: 'label_raw', value: 'Decca' })).status,
    400, 'an unattributed confirmation is a script marking its own homework');
});

test('DATASET-EDIT: an edit makes nothing decision-eligible', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  await edit(env, 1, { entity: 'capture', field: 'label_raw', value: 'Decca', confirmedBy: 'Joe' });
  await edit(env, 1, { entity: 'item', field: 'crate', value: 'B4', confirmedBy: 'Joe' });

  const eligible = env.DB.raw.prepare('SELECT COUNT(*) AS n FROM v_decision_eligible_item').get();
  assert.equal(eligible.n, 0,
    'only a confirmed release_id on the ITEM does that, and only the queue writes one');
});

test('DATASET-EDIT: promoting a reading writes a NEW shelf row, never launders the vision one', async () => {
  const env = editEnv();
  await post(env, { clientId: 'c1', catnoRaw: 'SXL 6113' });
  env.DB.raw.exec(`
    INSERT INTO raw_value (item_id, field, value) VALUES (1, 'label_raw', 'Decca');
    INSERT INTO field_source (entity, entity_id, field, source)
      VALUES ('raw_value', 1, 'label_raw', 'vision');`);

  const res = await edit(env, 1, { field: 'label_raw', confirmedBy: 'Joe' }, SECRET, 'promote');
  assert.equal(res.status, 200);
  assert.equal(env.DB.raw.prepare('SELECT label_raw FROM capture WHERE item_id = 1').get().label_raw, 'Decca');

  // The reading is left exactly as it was: what the model read stays on
  // record, and stays out of every decision view.
  const vision = env.DB.raw.prepare(
    "SELECT source, confirmed_at FROM field_source WHERE entity='raw_value' AND field='label_raw'").get();
  assert.equal(vision.source, 'vision',
    're-labelling it would erase the difference this project exists to keep');
  assert.equal(vision.confirmed_at, null);
  assert.equal(env.DB.raw.prepare(
    "SELECT COUNT(*) AS n FROM v_confirmed_field WHERE source='vision'").get().n, 0);

  // And the person's assertion is its own confirmed row.
  const shelf = env.DB.raw.prepare(
    "SELECT source, confirmed_by FROM field_source WHERE entity='capture' AND field='label_raw'").get();
  assert.deepEqual([shelf.source, shelf.confirmed_by], ['shelf', 'Joe']);

  assert.equal((await edit(env, 1, { field: 'title_raw', confirmedBy: 'Joe' }, SECRET, 'promote')).status,
    404, 'nothing to promote is a 404, not an empty write');
});

test('DATASET-EDIT: editing an item that does not exist is a 404', async () => {
  const env = editEnv();
  assert.equal(
    (await edit(env, 999, { entity: 'item', field: 'crate', value: 'B4', confirmedBy: 'Joe' })).status, 404);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM field_source').get().n, 0,
    'no provenance is created for an item that is not there');
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
  assert.deepEqual(BUDGETS.discogs, { limit: 30, windowMs: 60_000, minIntervalMs: 2_000 });
  assert.deepEqual(BUDGETS.musicbrainz, { limit: 1, windowMs: 1_000, minIntervalMs: 1_000 });
});

test('requests are SPACED, not merely counted', async () => {
  // A window budget alone is spent as an instantaneous burst. That is
  // what a Worker does — twelve queries in a few hundred milliseconds —
  // and it is refused however modest the per-minute total. A laptop
  // hides the fault because the round-trip paces the calls.
  const kv = makeKv();
  let now = 1_000_000;
  const limiter = new RateLimiter(kv, () => now);

  assert.equal((await limiter.take('discogs')).allowed, true);

  const immediate = await limiter.take('discogs');
  assert.equal(immediate.allowed, false, 'a second request in the same instant must wait');
  assert.ok(immediate.retryAfterMs > 0 && immediate.retryAfterMs <= 2_000);

  now += 1_999;
  assert.equal((await limiter.take('discogs')).allowed, false, 'still inside the gap');

  now += 1;
  assert.equal((await limiter.take('discogs')).allowed, true, 'allowed once the gap has passed');
});

test('the budget is shared, not per caller', async () => {
  const kv = makeKv();
  let now = 1_000_000;
  // Two limiters standing in for two isolates serving two people.
  const a = new RateLimiter(kv, () => now);
  const b = new RateLimiter(kv, () => now);

  // Sharing shows in the SPACING: whichever isolate goes first, the
  // other must wait, because both read the same last-request stamp.
  // (At 2 s apart the per-minute budget is saturated by the spacing
  // alone — 30 requests is exactly one minute — so the gap is the
  // constraint that actually bites.)
  assert.equal((await a.take('discogs')).allowed, true);
  const other = await b.take('discogs');
  assert.equal(other.allowed, false, 'two people cataloguing at once must not double the rate');
  assert.ok(other.retryAfterMs > 0 && other.retryAfterMs <= 2_000);

  now += 2_000;
  assert.equal((await b.take('discogs')).allowed, true, 'and the other isolate proceeds after the gap');

  // The window budget still bites if spacing were ever relaxed.
  for (let i = 0; i < 28; i++) { now += 2_000; await a.take('discogs'); }
  now += 1;  // inside the same window, past the gap
  assert.equal((await a.take('discogs')).allowed, false, 'the per-minute budget is shared too');
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

test('remaining counts down across the window', async () => {
  const kv = makeKv();
  let now = 1_000_000;
  const limiter = new RateLimiter(kv, () => now);
  assert.equal((await limiter.take('discogs')).remaining, 29);
  now += 2_000;
  assert.equal((await limiter.take('discogs')).remaining, 28);
  for (let i = 0; i < 40; i++) { now += 2_000; await limiter.take('discogs'); }
  const exhausted = await limiter.take('discogs');
  assert.equal(exhausted.allowed, false);
});

test('the Worker serves without R2, and a photo upload stays retryable', async () => {
  // R2 has to be enabled in the Cloudflare dashboard before the API
  // will accept it, so the Worker must deploy without the binding.
  const env = makeEnv();
  delete env.PHOTOS;

  assert.equal((await app.request('/api/health', {}, env)).status, 200, 'the rest of the Worker still works');

  const res = await app.request('/api/photos/abc.jpg',
    { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([1]) }, env);
  assert.equal(res.status, 503, '503 is retryable; the phone keeps the photo queued');
  assert.match((await res.json()).error, /not configured/);

  // A typed capture is unaffected.
  const cap = await app.request('/api/captures', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'no-r2', crate: 'B4', catnoRaw: 'SXL 6113' }),
  }, env);
  assert.equal(cap.status, 201);
});
