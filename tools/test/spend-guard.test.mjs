// @ts-check
/**
 * OPS-SPEND-GUARD — Cloudflare sells no hard spend cap, so the ceiling
 * is ours to build.
 *
 * Rows written is the only metered line the matcher can move far enough
 * to cost real money, and the thing that would move it is not usage but
 * an unbounded write loop running unattended on a five-minute cron. So
 * these tests assert that the matcher COUNTS what it writes and STOPS,
 * and that it says so when it does — a tick that quietly did less than
 * it was asked to looks exactly like a quiet night in the logs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimRow, persistRun } from '../../worker/match/run.ts';
import { WRITE_BUDGET_PER_TICK, runMatchBatch } from '../../worker/index.ts';
import { makeEnv } from './helpers/bindings.mjs';

/**
 * A clock that sleeping advances. The limiter spaces Discogs requests
 * two seconds apart and the client honours that by actually waiting,
 * so a real clock makes these tests take 95 seconds to assert
 * arithmetic. Injecting time keeps the spacing behaviour under test —
 * the client still waits, it just waits instantly.
 */
const fakeTime = () => {
  let t = 1_700_000_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
};

/**
 * Rows WRITTEN, which is not rows ADDED — the distinction is the whole
 * billing question. D1 meters inserts and updates alike, so the
 * `UPDATE item SET release_id` and the provenance upsert each cost a
 * row write while adding no row. Counting table sizes would have
 * undercounted them; SQLite's total_changes() counts what actually
 * changed, which is the same thing D1 charges for.
 */
const written = (env) => Number(env.DB.raw.prepare('SELECT total_changes() AS n').get().n);

/** A verified result carrying the full five candidates — the costliest shape. */
const verifiedResult = (itemId) => ({
  outcome: {
    itemId, verdict: 'verified', reason: 'ok', chosenDiscogsId: 111,
    queriesRun: 1, queryErrors: 0, candidates: 5,
  },
  gate: {
    verdict: 'verified',
    chosen: { id: 111, score: 95 },
    ranked: [1, 2, 3, 4, 5].map((i) => ({
      id: 100 + i, score: 96 - i, families: ['identifier'], signals: { identifier: 'exact' },
    })),
  },
  queries: ['catno=SXL+6113'],
});

test('persistRun reports exactly the number of rows it wrote', async () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO item (crate) VALUES ('B4')");
  env.DB.raw.exec("INSERT INTO capture (item_id, catno_raw) VALUES (1, 'SXL 6113')");

  // The claim is the caller's line, not persistRun's — runMatchBatch
  // counts it separately — so it is taken before the snapshot.
  const claimedAt = written(env);
  const runId = await claimRow(env, 1);
  assert.equal(written(env) - claimedAt, 1, 'a claim costs exactly one write');

  const before = written(env);
  const reported = await persistRun(env, { itemId: 1, catnoRaw: 'SXL 6113' },
    verifiedResult(1), runId);
  const actual = written(env) - before;

  // An accounting that drifts from reality is worse than none: the
  // budget would be spent against a number nobody is checking.
  assert.equal(reported, actual, `persistRun said ${reported}, DB grew by ${actual}`);
  assert.ok(reported > 0, 'a verified run writes something');
});

test('a release already known is not written twice, and is not counted twice', async () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO item (crate) VALUES ('B4'), ('B5')");
  env.DB.raw.exec("INSERT INTO capture (item_id, catno_raw) VALUES (1, 'SXL 6113'), (2, 'SXL 6113')");

  const first = await persistRun(env, { itemId: 1 }, verifiedResult(1), await claimRow(env, 1));
  const runId2 = await claimRow(env, 2);
  const before = written(env);
  const second = await persistRun(env, { itemId: 2 }, verifiedResult(2), runId2);
  const actual = written(env) - before;

  assert.equal(second, actual, 'the second run also reports truthfully');
  assert.ok(second < first, 'the shared release is not re-created, so the second run costs less');
});

test('the matcher stops at its write budget and says it stopped short', async () => {
  const env = makeEnv();
  env.DISCOGS_TOKEN = 'test-token';
  for (let i = 1; i <= 6; i += 1) {
    env.DB.raw.exec(`INSERT INTO item (crate) VALUES ('B${i}')`);
    env.DB.raw.exec(`INSERT INTO capture (item_id, catno_raw, label_raw) VALUES (${i}, 'SXL 611${i}', 'Decca')`);
  }

  // No network: every query fails, so each row costs exactly one
  // match_run write. That makes the budget arithmetic exact.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline in test'); };
  try {
    const out = await runMatchBatch(env, { batchSize: 6, writeBudget: 3, ...fakeTime() });
    assert.equal(out.stoppedShort, true, 'it must report that it stopped short');
    assert.ok(out.processed < 6, `processed ${out.processed} of 6 — it should not have finished`);
    assert.ok(out.rowsWritten >= 3, 'it stopped at the budget, not before reaching it');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a tick inside its budget does not claim it stopped short', async () => {
  const env = makeEnv();
  env.DISCOGS_TOKEN = 'test-token';
  env.DB.raw.exec("INSERT INTO item (crate) VALUES ('B1')");
  env.DB.raw.exec("INSERT INTO capture (item_id, catno_raw, label_raw) VALUES (1, 'SXL 6113', 'Decca')");

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline in test'); };
  try {
    const out = await runMatchBatch(env, { batchSize: 4, ...fakeTime() });
    assert.equal(out.stoppedShort, false);
    assert.equal(out.processed, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the budget is a runaway backstop, not a throttle a healthy tick meets', () => {
  // Four rows a tick, and the costliest row is ~10 writes. If the
  // budget ever drops near that, the guard starts truncating normal
  // work instead of catching a loop — which is the failure this
  // assertion exists to make loud.
  const worstCaseTick = 4 * 10;
  assert.ok(
    WRITE_BUDGET_PER_TICK >= worstCaseTick * 4,
    `budget ${WRITE_BUDGET_PER_TICK} leaves too little headroom over a ${worstCaseTick}-write tick`,
  );
});

test('the Worker stays deployable: no CPU limit while on the Free plan', () => {
  // Learned by breaking it. A [limits] cpu_ms block looks like pure
  // prudence and is rejected outright on Free — "CPU limits are not
  // supported for the Free plan [code: 100328]" — so the Worker could
  // not deploy at all. A guard that stops the thing shipping is worth
  // less than no guard.
  //
  // Free caps CPU itself, and the real wall is D1 refusing writes past
  // 100k/day. The per-tick write budget above is the ceiling that
  // actually does the work here.
  //
  // MOVING TO A PAID PLAN? Re-add [limits] cpu_ms and invert this test.
  const toml = readFileSync('wrangler.toml', 'utf8');
  const active = toml.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(active, /\[limits\]/,
    'a [limits] block makes deploy fail on the Free plan');
  assert.doesNotMatch(active, /cpu_ms/,
    'cpu_ms is rejected by the Free plan and blocks deployment');
});
