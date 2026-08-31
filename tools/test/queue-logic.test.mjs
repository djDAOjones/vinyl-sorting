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
  BULK_CARRIED, CAPTURED_KIND, PHOTO_LONG_EDGE, UNDO_MS, bulkFields, heldForUndo,
  markFailed, medianMs, nextBackoffMs, scaleTo, selectDrainable, shouldStopDraining,
  summarise, toRequestBody, torchSupported, videoConstraints,
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

test('CAPTURE-NEXT-DISC: an undone disc is held back from the drain, not from disk', () => {
  const held = heldForUndo(entry({ clientId: 'just-filed' }), 100_000);

  // The entry itself is untouched apart from when it may first be sent:
  // it is on disk, complete, with its photographs — the offline
  // guarantee does not bend for the undo window.
  assert.equal(held.state, 'pending');
  assert.equal(held.clientId, 'just-filed');
  assert.equal(held.attempts, 0);
  assert.equal(held.nextAttemptAt, 100_000 + UNDO_MS);

  // Nothing new teaches the drain to skip it — `nextAttemptAt` is the
  // field it already honours for backoff, so the hold cannot leak.
  assert.deepEqual(selectDrainable([held], 100_000 + UNDO_MS - 1), [],
    'inside the window the send waits');
  assert.deepEqual(selectDrainable([held], 100_000 + UNDO_MS).map((e) => e.clientId),
    ['just-filed'], 'and goes out the moment the window closes');

  // A tab closed mid-window leaves an ordinary pending entry, which the
  // next tick sends. An undo window must never strand a capture.
  assert.deepEqual(selectDrainable([held], 100_000 + 60_000).map((e) => e.clientId),
    ['just-filed']);
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

// ── CAPTURE-BULK-PHOTOS — a crate in one pass ─────────────────────
//
// THE MODE IS GONE (CAPTURE-ONE-SCREEN, 2026-08-31) and `bulkFields`
// and `BULK_CARRIED` have no caller. `scaleTo` below is still very much
// live — the downscale runs on every photograph — so only the two bulk
// tests are covering retired code.
//
// They are kept rather than deleted because deleting them is deleting
// tests, which AGENTS.md makes a stop-and-ask (CAPTURE-BULK-REMNANT).
// If the maintainer takes that decision, these two tests go WITH the
// exports in `queue-logic.ts` and not before them.

test('a photo is downscaled to the long edge, and a small one is left alone', () => {
  // 4 MB a frame times twenty is ~80 MB in IndexedDB, on a phone, in a
  // loft, where iOS evicts under storage pressure.
  assert.deepEqual(scaleTo(4032, 3024), { width: 1568, height: 1176 }, 'landscape keeps its ratio');
  assert.deepEqual(scaleTo(3024, 4032), { width: 1176, height: 1568 }, 'and so does portrait');
  assert.equal(scaleTo(1200, 900), null, 'already small enough — re-encoding would only lose quality');
  assert.equal(scaleTo(PHOTO_LONG_EDGE, PHOTO_LONG_EDGE), null, 'exactly at the edge is small enough');
  assert.equal(scaleTo(0, 0), null, 'a degenerate size is left to the caller, never divided by');
});

test('a bulk row carries the crate but never another disc\'s claims', () => {
  // THE fault this mode could introduce: one catalogue number copied
  // across twenty rows is nineteen invented values, indistinguishable
  // from typed ones — the M0 error, manufactured wholesale.
  const base = {
    crate: 'B4', position: '', capturedBy: 'Joe',
    catnoRaw: 'SXL 6529', labelRaw: 'Decca', nameRaw: 'Solti',
    titleRaw: 'Serenade', matrixRunout: 'ZAL-13045', yearRaw: '1972',
    mediaGrade: 'VG+', sleeveGrade: 'VG',
  };
  const row = bulkFields(base, 0);
  assert.deepEqual(row, { crate: 'B4', capturedBy: 'Joe' });
  for (const dropped of ['catnoRaw', 'labelRaw', 'nameRaw', 'titleRaw', 'matrixRunout', 'yearRaw',
    'mediaGrade', 'sleeveGrade']) {
    assert.equal(row[dropped], undefined, `${dropped} is a claim about one disc`);
  }
  assert.deepEqual([...BULK_CARRIED], ['crate', 'position', 'capturedBy']);
});

test('position counts down the crate from a typed start, and stays absent otherwise', () => {
  // Photographing in shelf order does make positions sequential, but
  // inventing the starting point would be a guess — and a wrong value
  // costs more than an absent one.
  assert.equal(bulkFields({ crate: 'B4', position: '12' }, 0).position, '12');
  assert.equal(bulkFields({ crate: 'B4', position: '12' }, 7).position, '19');
  assert.equal(bulkFields({ crate: 'B4', position: '' }, 3).position, undefined, 'blank stays blank');
  assert.equal(bulkFields({ crate: 'B4' }, 3).position, undefined);
  assert.equal(bulkFields({ crate: 'B4', position: 'front' }, 1).position, undefined,
    'unparseable is absent, not NaN');
});

test('a bulk row still produces a body the Worker accepts', () => {
  const body = toRequestBody({
    clientId: 'c9', createdAt: 1, msToCapture: 900, fields: bulkFields({ crate: 'B4', position: '3' }, 2),
    photos: [{ kind: 'label_a', blob: new Blob(), key: 'c9.jpg' }],
    state: 'pending', attempts: 0, nextAttemptAt: 0,
  });
  assert.deepEqual(body, {
    clientId: 'c9', crate: 'B4', position: '5',
    photos: [{ kind: 'label_a', r2Key: 'labels/c9.jpg' }],
  });
});

test('one bad row does not hold a crate hostage, but offline still stops the pass', () => {
  // Stopping on every failure is right for one entry and wrong for
  // twenty: a photo the server refuses would sit at the head of the
  // queue for ever with nineteen good ones stuck behind it.
  assert.equal(shouldStopDraining(null), true, 'the fetch never completed — offline');
  assert.equal(shouldStopDraining(503), true, 'R2 not configured yet; everything behind fails alike');
  assert.equal(shouldStopDraining(500), true);
  assert.equal(shouldStopDraining(413), false, 'this photo is too large — the next one may not be');
  assert.equal(shouldStopDraining(400), false, 'a malformed body is about this entry alone');
});

// ── several photos for one disc ───────────────────────────────────

test('a captured photograph claims nothing about what it shows', () => {
  // "There will be no consistency, so any attempt to ascribe
  // information is dishonest and a waste of time" — maintainer,
  // 2026-08-30. Every specific kind asserts something (side-A label,
  // sleeve front, deadwax); with nobody asserting it, storing one would
  // invent a fact that nothing downstream could tell from a real one.
  assert.equal(CAPTURED_KIND, 'other');
  assert.ok(!['label_a', 'label_b', 'front', 'back', 'runout'].includes(CAPTURED_KIND),
    'the app must not claim a kind nobody chose');
});

test('several photos on one capture keep distinct keys, numbered by order', () => {
  // The key cannot be the clientId alone or the second upload would
  // overwrite the first. The index is the only thing asserted, and it
  // is a fact about sequence rather than a claim about content.
  const body = toRequestBody({
    clientId: 'c1', createdAt: 1, msToCapture: 100, fields: { catnoRaw: 'SXL 6113' },
    photos: [
      { kind: 'other', blob: new Blob(), key: 'c1-1.jpg' },
      { kind: 'other', blob: new Blob(), key: 'c1-2.jpg' },
      { kind: 'other', blob: new Blob(), key: 'c1-3.jpg' },
    ],
    state: 'pending', attempts: 0, nextAttemptAt: 0,
  });
  assert.deepEqual(body.photos, [
    { kind: 'other', r2Key: 'labels/c1-1.jpg' },
    { kind: 'other', r2Key: 'labels/c1-2.jpg' },
    { kind: 'other', r2Key: 'labels/c1-3.jpg' },
  ]);
});

// ── the live camera ───────────────────────────────────────────────

test('the camera is asked for far more resolution than is stored', () => {
  // The field this exists to read is a catalogue number printed smaller
  // than everything around it, and a video frame is already weaker than
  // the same phone's still — no HDR, no multi-frame stacking. Asking
  // for the storage size would throw away the margin that makes small
  // print legible.
  const c = videoConstraints();
  const v = /** @type {any} */ (c.video);
  assert.equal(v.facingMode.ideal, 'environment', 'the back camera, not the selfie one');
  assert.ok(v.width.ideal >= PHOTO_LONG_EDGE * 2, 'well above the 1568 px it is stored at');
  assert.equal(c.audio, false, 'never the microphone — it is not needed and it is intrusive');
  // `ideal`, never `exact`: a device that cannot manage 4K must hand
  // back its best rather than failing to open at all.
  assert.equal(v.width.exact, undefined);
  assert.equal(v.height.exact, undefined);
});

test('the torch button appears only where a torch actually exists', () => {
  // Safari on iOS exposes no torch, and a dead button is worse than no
  // button — it reads as a bug in the app rather than a limit of the
  // platform.
  assert.equal(torchSupported({ torch: true }), true);
  assert.equal(torchSupported({ torch: false }), false, 'present but unsupported is still no');
  assert.equal(torchSupported({}), false, 'a camera that never mentions torch');
  assert.equal(torchSupported(undefined), false, 'getCapabilities missing entirely');
  assert.equal(torchSupported(null), false);
});
