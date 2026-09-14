import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncController } from '../../src/sync-engine.ts';
import { recoverInterrupted, queueHealth, SYNC_LEASE_MS } from '../../src/queue-logic.ts';
const entry = (over = {}) => ({ clientId: 'one', createdAt: 1, msToCapture: 5000,
  fields: { catnoRaw: 'TEST' }, photos: [], state: 'pending', attempts: 0, nextAttemptAt: 0, ...over });
const receipt = (id = 42) => new Response(JSON.stringify({ itemId: id, created: false }), { status: 200 });
function fixture(entries, fetch, over = {}) {
  const rows = new Map(entries.map(e => [e.clientId, structuredClone(e)]));
  let pruned = 0;
  const ctl = createSyncController({
    allEntries: async () => [...rows.values()].map(e => structuredClone(e)),
    putEntry: async e => { rows.set(e.clientId, structuredClone(e)); },
    pruneSynced: async () => { pruned++; }, now: () => 1_000_000, fetch, ...over,
  });
  return { ctl, rows, pruned: () => pruned };
}
test('interrupted legacy syncing entry retries with the same ID and all photo blobs', async () => {
  const photo = { key: 'one-1.jpg', kind: 'other', blob: new Blob(['image'], { type: 'image/jpeg' }) };
  const calls = [];
  const f = fixture([entry({ state: 'syncing', photos: [photo] })], async (url, init) => {
    calls.push([url, init]);
    return url.startsWith('/api/photos/') ? new Response(JSON.stringify({ r2Key: 'labels/one-1.jpg' }), { status: 201 }) : receipt();
  });
  assert.deepEqual(await f.ctl.run(), { sent: 1, failed: 0 });
  assert.equal(JSON.parse(calls[1][1].body).clientId, 'one');
  assert.equal(await calls[0][1].body.text(), 'image');
  assert.equal(f.rows.get('one').state, 'synced');
  assert.equal(f.rows.get('one').serverItemId, 42);
  assert.equal(f.rows.get('one').syncedAt, 1_000_000);
});
test('live upload lease is not reclaimed and recovery never mutates the input', () => {
  const original = [entry({ state: 'syncing', nextAttemptAt: 100 + SYNC_LEASE_MS })];
  assert.equal(recoverInterrupted(original, 100)[0].state, 'syncing');
  assert.equal(recoverInterrupted(original, 100 + SYNC_LEASE_MS)[0].state, 'failed');
  assert.equal(original[0].state, 'syncing');
});
test('a stalled request times out, preserves the queue and releases the drain for retry', async () => {
  let hangs = true;
  const f = fixture([entry()], async () => hangs ? new Promise(() => {}) : receipt(), { timeoutMs: 10 });
  assert.deepEqual(await f.ctl.run(), { sent: 0, failed: 1 });
  assert.match(f.rows.get('one').lastError, /timed out/);
  hangs = false;
  assert.deepEqual(await f.ctl.run(1_000_000, true), { sent: 1, failed: 0 });
});
test('HTTP 200 without a valid record receipt never marks an entry synced', async () => {
  for (const body of ['<html>Sign in</html>', '{}', '{"itemId":0}', '{"itemId":"42"}']) {
    const f = fixture([entry()], async () => new Response(body));
    assert.deepEqual(await f.ctl.run(), { sent: 0, failed: 1 });
    assert.equal(f.rows.get('one').state, 'failed');
  }
});
test('a wrong photo receipt stops before filing a record', async () => {
  let calls = 0;
  const f = fixture([entry({ photos: [{ key: 'one.jpg', kind: 'other', blob: new Blob(['photo']) }] })], async () => {
    calls++; return new Response('{"r2Key":"labels/wrong.jpg"}');
  });
  await f.ctl.run();assert.equal(calls, 1);assert.equal(f.rows.get('one').state, 'failed');
});
test('a rejected record does not block other records and its error remains inspectable', async () => {
  const f = fixture([entry(), entry({ clientId: 'two', createdAt: 2 })], async (_, init) =>
    JSON.parse(init.body).clientId === 'one' ? new Response('invalid list', { status: 400 }) : receipt(43));
  assert.deepEqual(await f.ctl.run(), { sent: 1, failed: 1 });
  assert.match(f.rows.get('one').lastError, /HTTP 400.*invalid list/);
  assert.equal(f.rows.get('two').state, 'synced');
});
test('a server failure retains everything behind it for retry', async () => {
  let calls = 0;
  const f = fixture([entry(), entry({ clientId: 'two' })], async () => { calls++; return new Response('unavailable', { status: 503 }); });
  assert.deepEqual(await f.ctl.run(), { sent: 0, failed: 1 });assert.equal(calls, 1);
  assert.equal(f.rows.get('two').state, 'pending');
});
test('storage failure is visible and does not send or prune unsaved state', async () => {
  let calls = 0;
  const f = fixture([entry()], async () => { calls++; return receipt(); }, { putEntry: async () => { throw new Error('Quota exceeded'); } });
  await f.ctl.run();assert.equal(calls, 0);assert.equal(f.pruned(), 0);
  assert.match(f.ctl.error(), /Phone storage.*Quota exceeded/);
});
test('manual retry does not bypass the undo window or resend confirmed entries', async () => {
  const f = fixture([entry({ nextAttemptAt: 1_005_000 }), entry({ clientId: 'sent', state: 'synced' })], async () => { throw new Error('must not send'); });
  assert.deepEqual(await f.ctl.run(1_000_000, true), { sent: 0, failed: 0 });
});
test('status never calls failed or interrupted entries recorded online', () => {
  const health = queueHealth([entry({ state: 'failed', lastError: 'HTTP 400' }), entry({ clientId: 'two', state: 'syncing' })], 1_000_000, true);
  assert.equal(health.outstanding, 2);assert.equal(health.tone, 'error');assert.match(health.title, /not recorded online/);
  assert.equal(health.lastError, 'HTTP 400');assert.match(health.message, /only on this device/);
  assert.equal(queueHealth([entry({ state: 'synced', syncedAt: 100 })], 200, true).outstanding, 0);
  assert.equal(queueHealth([], 200, false).tone, 'waiting');
});
