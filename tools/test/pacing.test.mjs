// @ts-check
/**
 * M2-DISCOGS-PACING — finding the gap that holds from Cloudflare's
 * shared egress is a measure-and-adjust loop, so these tests cover the
 * two things that make the loop runnable: the gap can be changed
 * WITHOUT A DEPLOY, and every run records how many of its queries
 * failed so the next adjustment is measured rather than guessed.
 *
 * The override is widen-only. That is the safety property worth having
 * tests for: it exists to slow the matcher while the safe rate is
 * found, and a value that could narrow the gap would turn one typo
 * into the burst behaviour Discogs already refused us for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGETS, RateLimiter, minIntervalKey } from '../../worker/rate-limit.ts';
import {
  CRON_PERIOD_MS, QUERIES_PER_ROW, TICK_WORK_BUDGET_MS, batchSizeFor,
} from '../../worker/index.ts';
import { persistRun } from '../../worker/match/run.ts';
import { makeEnv, makeKv } from './helpers/bindings.mjs';

const DEFAULT = BUDGETS.discogs.minIntervalMs;

/** A limiter over a KV double, with a clock the test controls. */
const limiterAt = (t = 1_700_000_000_000) => {
  const kv = makeKv();
  return { kv, limiter: new RateLimiter(kv, () => t) };
};

test('with no override the shipped gap is what applies', async () => {
  const { limiter } = limiterAt();
  assert.equal(await limiter.effectiveMinInterval('discogs'), DEFAULT);
});

test('an override can widen the gap, which is the point of it', async () => {
  const { kv, limiter } = limiterAt();
  await kv.put(minIntervalKey('discogs'), '4000', { expirationTtl: 3600 });
  assert.equal(await limiter.effectiveMinInterval('discogs'), 4000);
});

test('an override may never narrow the gap', async () => {
  // The failure this prevents: someone tunes "1000" hoping for speed,
  // the Worker bursts again, and Discogs refuses the account.
  const { kv, limiter } = limiterAt();
  for (const bad of ['1000', '0', '-5000']) {
    await kv.put(minIntervalKey('discogs'), bad, { expirationTtl: 3600 });
    assert.equal(await limiter.effectiveMinInterval('discogs'), DEFAULT,
      `${bad} must not narrow the gap below the shipped ${DEFAULT}`);
  }
});

test('a nonsense or absurd override falls back rather than wedging the matcher', async () => {
  const { kv, limiter } = limiterAt();
  for (const bad of ['', 'soon', 'NaN', '999999']) {
    await kv.put(minIntervalKey('discogs'), bad, { expirationTtl: 3600 });
    assert.equal(await limiter.effectiveMinInterval('discogs'), DEFAULT,
      `${bad} must fall back to the default`);
  }
});

test('the gap in force is the gap actually enforced, not just reported', async () => {
  const t = 1_700_000_000_000;
  const kv = makeKv();
  const limiter = new RateLimiter(kv, () => t);
  await kv.put(minIntervalKey('discogs'), '5000', { expirationTtl: 3600 });

  assert.equal((await limiter.take('discogs')).allowed, true, 'first request goes');
  const second = await limiter.take('discogs');
  assert.equal(second.allowed, false, 'a request at the same instant is spaced out');
  // Against the override's 5s, not the shipped 2s.
  assert.equal(second.retryAfterMs, 5000);
});

test('widening the gap narrows the batch, so a tick stays the same length', () => {
  // Today's shipped pacing must keep today's batch exactly.
  assert.equal(batchSizeFor(2000), 4, '2s must still mean four rows');
  assert.ok(batchSizeFor(4000) < batchSizeFor(2000), '4s must mean fewer rows');
  assert.ok(batchSizeFor(6000) < batchSizeFor(4000));
  // And a tick never becomes a no-op, however wide the gap.
  assert.ok(batchSizeFor(60_000) >= 1);
  // A multi-row tick stays inside the soft budget. A single row is
  // allowed to exceed it — past an 8s gap one row costs more than the
  // budget, and stalling the matcher would be the worse failure.
  for (const gap of [2000, 3000, 4000, 6000, 10_000, 60_000]) {
    const rows = batchSizeFor(gap);
    const wait = rows * QUERIES_PER_ROW * gap;
    if (rows > 1) {
      assert.ok(wait <= TICK_WORK_BUDGET_MS,
        `a ${gap}ms gap takes ${rows} rows and overruns the soft budget`);
    }
    // The hard bound holds at every gap the override permits: a tick
    // must finish before the next one fires.
    assert.ok(wait <= CRON_PERIOD_MS,
      `a ${gap}ms gap would run ${wait}ms, past the ${CRON_PERIOD_MS}ms period`);
  }
});

test('a run records how many of its queries failed, queryably', async () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO item (crate) VALUES ('B4')");
  env.DB.raw.exec("INSERT INTO capture (item_id, catno_raw) VALUES (1, 'SXL 6113')");

  await persistRun(env, { itemId: 1 }, {
    outcome: {
      itemId: 1, verdict: 'needs_review', reason: 'margin too thin',
      chosenDiscogsId: null, queriesRun: 12, queryErrors: 7, candidates: 5,
    },
    gate: { verdict: 'needs_review', chosen: null, ranked: [] },
    queries: ['catno=SXL+6113'],
  });

  // Read it the way match-report does — if json_extract cannot see it,
  // the measurement this item needs is not actually available.
  const row = env.DB.raw.prepare(`
    SELECT json_extract(queries_json, '$.queriesRun')   AS ran,
           json_extract(queries_json, '$.queryErrors')  AS failed
      FROM match_run WHERE item_id = 1`).get();
  assert.equal(Number(row.ran), 12);
  assert.equal(Number(row.failed), 7);
});
