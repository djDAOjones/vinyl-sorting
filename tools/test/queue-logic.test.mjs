// @ts-check
/**
 * M1-CAPTURE-UI — the offline queue's decisions.
 *
 * Kept free of IndexedDB so they can be tested without a browser; the
 * storage adapter is thin enough to verify by driving the real app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  markFailed, medianMs, nextBackoffMs, selectDrainable, summarise, toRequestBody,
} from '../../src/queue-logic.ts';

const entry = (over = {}) => ({
  clientId: 'c1', createdAt: 1000, msToCapture: 20_000, fields: {}, photos: [],
  state: 'pending', attempts: 0, nextAttemptAt: 0, ...over,
});

test('backoff grows exponentially and is capped', () => {
  assert.equal(nextBackoffMs(1), 2_000);
  assert.equal(nextBackoffMs(2), 4_000);
  assert.equal(nextBackoffMs(3), 8_000);
  // A loft has no signal for as long as it takes to walk out of it.
  assert.equal(nextBackoffMs(20), 5 * 60_000, 'capped at five minutes');
  assert.equal(nextBackoffMs(0), 2_000, 'never below the base');
});

test('only due, unsent entries drain — oldest first', () => {
  const entries = [
    entry({ clientId: 'new', createdAt: 3000 }),
    entry({ clientId: 'old', createdAt: 1000 }),
    entry({ clientId: 'sent', createdAt: 500, state: 'synced' }),
    entry({ clientId: 'inflight', createdAt: 600, state: 'syncing' }),
    entry({ clientId: 'backoff', createdAt: 700, state: 'failed', nextAttemptAt: 9_999 }),
    entry({ clientId: 'retry-now', createdAt: 800, state: 'failed', nextAttemptAt: 100 }),
  ];
  const due = selectDrainable(entries, 1_000).map((e) => e.clientId);
  assert.deepEqual(due, ['retry-now', 'old', 'new'], 'FIFO, and nothing already sent or in flight');
});

test('a failure keeps the entry and schedules a retry', () => {
  const failed = markFailed(entry(), 'offline', 5_000);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attempts, 1);
  assert.equal(failed.lastError, 'offline');
  assert.equal(failed.nextAttemptAt, 5_000 + 2_000);
  assert.equal(failed.clientId, 'c1', 'the capture itself is never lost');

  const again = markFailed(failed, 'offline', 10_000);
  assert.equal(again.attempts, 2);
  assert.equal(again.nextAttemptAt, 10_000 + 4_000);
});

test('median is a true median, including the even case', () => {
  assert.equal(medianMs([]), null);
  assert.equal(medianMs([5]), 5);
  assert.equal(medianMs([30, 10, 20]), 20);
  assert.equal(medianMs([10, 20, 30, 40]), 25, 'mean of the middle two');
  assert.equal(medianMs([3, 1]), 2);
});

test('the badge counts what is outstanding, and reports the measured median', () => {
  const s = summarise([
    entry({ clientId: 'a', state: 'pending', msToCapture: 20_000 }),
    entry({ clientId: 'b', state: 'syncing', msToCapture: 30_000 }),
    entry({ clientId: 'c', state: 'failed', msToCapture: 10_000 }),
    entry({ clientId: 'd', state: 'synced', msToCapture: 40_000 }),
  ]);
  assert.equal(s.pending, 2, 'in-flight still counts as outstanding');
  assert.equal(s.failed, 1);
  assert.equal(s.synced, 1);
  assert.equal(s.medianMs, 25_000);
});

test('a capture with no timing does not drag the median down', () => {
  const s = summarise([entry({ clientId: 'a', msToCapture: 20_000 }), entry({ clientId: 'b', msToCapture: 0 })]);
  assert.equal(s.medianMs, 20_000);
});

test('the request body omits blanks and trims, so no empty string is stored', () => {
  const body = toRequestBody(entry({
    fields: { crate: ' B4 ', catnoRaw: 'SXL 6113', labelRaw: '   ', mediaGrade: '' },
  }));
  assert.deepEqual(body, { clientId: 'c1', crate: 'B4', catnoRaw: 'SXL 6113' });
  assert.ok(!('labelRaw' in body), 'whitespace is absence, not a value');
  assert.ok(!('mediaGrade' in body));
});

test('photos become the keys the Worker will store them under', () => {
  const body = toRequestBody(entry({
    photos: [{ kind: 'label_a', key: 'abc.jpg', blob: null }],
  }));
  assert.deepEqual(body.photos, [{ kind: 'label_a', r2Key: 'labels/abc.jpg' }]);
});

test('the queued body is accepted by the Worker that will receive it', async () => {
  const { parseCapture } = await import('../../worker/capture.ts');
  // Photo-only: the photo-first case, typing nothing but the crate.
  const photoOnly = toRequestBody(entry({
    fields: { crate: 'B4' }, photos: [{ kind: 'label_a', key: 'x.jpg', blob: null }],
  }));
  assert.equal(parseCapture(photoOnly).ok, true);

  // Typed, no photo.
  const typed = toRequestBody(entry({ fields: { crate: 'B4', catnoRaw: 'SXL 6113', mediaGrade: 'VG+' } }));
  assert.equal(parseCapture(typed).ok, true);

  // Neither — the client refuses this too, but the contract is shared.
  assert.equal(parseCapture(toRequestBody(entry({ fields: { crate: 'B4' } }))).ok, false);
});
