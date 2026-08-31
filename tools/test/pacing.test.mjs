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
import {
  BUDGETS, MAX_MIN_INTERVAL_MS, RateLimiter, autoIntervalKey, cooldownKey, minIntervalKey,
} from '../../worker/rate-limit.ts';
import {
  CRON_PERIOD_MS, QUERIES_PER_ROW, TICK_WORK_BUDGET_MS, batchSizeFor,
} from '../../worker/index.ts';
import { claimRow, persistRun } from '../../worker/match/run.ts';
import { MAX_ATTEMPTS_PER_QUERY, SUBREQUEST_BUDGET } from '../../worker/discogs.ts';
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

test('widening the gap narrows the batch, and Cloudflare caps it regardless', () => {
  // Two ceilings now. At tight gaps the binding one is Cloudflare's
  // per-invocation subrequest cap, which no amount of waiting relieves
  // — that is the wall the matcher actually hit on 2026-08-31.
  // A tick must fit inside the cap at WORST case, not best: a throttled
  // query costs up to MAX_ATTEMPTS_PER_QUERY subrequests, and sizing on
  // one apiece left the first retry eating the next row's allowance.
  for (const gap of [2000, 3000, 6000, MAX_MIN_INTERVAL_MS]) {
    const worst = batchSizeFor(gap) * QUERIES_PER_ROW * MAX_ATTEMPTS_PER_QUERY;
    assert.ok(worst <= SUBREQUEST_BUDGET || batchSizeFor(gap) === 1,
      `a ${gap}ms tick could spend ${worst} subrequests against a ${SUBREQUEST_BUDGET} budget`);
  }
  // Past the crossover the clock binds again and widening narrows.
  // Widening no longer narrows, because there is nothing left to
  // narrow: at twelve queries and up to four attempts each, the
  // 36-subrequest budget affords ONE row per invocation at every gap
  // the override permits. That is the honest state, and it is why the
  // matcher is slow rather than why it fails.
  assert.equal(batchSizeFor(2000), 1);
  assert.equal(batchSizeFor(MAX_MIN_INTERVAL_MS), 1);
  // The widest permitted gap must still leave one row able to finish
  // inside a cron period — that is what the cap is for.
  assert.ok(MAX_MIN_INTERVAL_MS * QUERIES_PER_ROW <= CRON_PERIOD_MS,
    'the widest override must still let a single row complete');
  // And a tick never becomes a no-op, however wide the gap.
  assert.ok(batchSizeFor(60_000) >= 1);
  // A multi-row tick stays inside the soft budget. A single row is
  // allowed to exceed it — past an 8s gap one row costs more than the
  // budget, and stalling the matcher would be the worse failure.
  // Every gap the override PERMITS — the set is bounded by
  // MAX_MIN_INTERVAL_MS, and that bound exists precisely so one row
  // still fits inside a cron period. Hardcoding a gap past it tested a
  // configuration that can no longer be reached.
  for (const gap of [2000, 3000, 4000, 6000, 10_000, MAX_MIN_INTERVAL_MS]) {
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

  // Claimed first, then completed — the run exists in `pending` from
  // the moment the search starts, so an overrunning tick cannot have
  // the next one select the same row.
  const runId = await claimRow(env, 1);
  assert.equal(env.DB.raw.prepare('SELECT state FROM match_run WHERE id = ?').get(runId).state,
    'pending', 'a claim is a pending run, not a verdict');

  await persistRun(env, { itemId: 1 }, {
    outcome: {
      itemId: 1, verdict: 'needs_review', reason: 'margin too thin',
      chosenDiscogsId: null, queriesRun: 12, queryErrors: 7, candidates: 5,
    },
    gate: { verdict: 'needs_review', chosen: null, ranked: [] },
    queries: ['catno=SXL+6113'],
  }, runId);

  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM match_run WHERE item_id = 1').get().n, 1,
    'completing a claim updates it rather than adding a second run');

  // Read it the way match-report does — if json_extract cannot see it,
  // the measurement this item needs is not actually available.
  const row = env.DB.raw.prepare(`
    SELECT json_extract(queries_json, '$.queriesRun')   AS ran,
           json_extract(queries_json, '$.queryErrors')  AS failed
      FROM match_run WHERE item_id = 1`).get();
  assert.equal(Number(row.ran), 12);
  assert.equal(Number(row.failed), 7);
});

// ── pacing itself ─────────────────────────────────────────────────

test('the interval widens fast on refusals and narrows slowly when clean', async () => {
  // The asymmetry is the point: being too quick costs a refused request
  // and the whole subrequest budget; being too slow costs only time.
  const kv = makeKv();
  const limiter = new RateLimiter(kv, () => 1_000_000);
  const floor = BUDGETS.discogs.minIntervalMs;

  const widened = await limiter.adjustAutoInterval('discogs', 0.5);
  assert.ok(widened > floor, 'refusals widen it');
  const wider = await limiter.adjustAutoInterval('discogs', 1);
  assert.ok(wider > widened, 'and keep widening');

  // Clean ticks walk it back, but not in one step.
  const back = await limiter.adjustAutoInterval('discogs', 0);
  assert.ok(back < wider && back > floor, 'narrows, but not straight to the floor');

  for (let i = 0; i < 40; i++) await limiter.adjustAutoInterval('discogs', 0);
  assert.equal(await limiter.effectiveMinInterval('discogs'), floor,
    'a long clean run reaches the shipped floor and stops there');
});

test('one unlucky query in a big tick holds the pace rather than hunting', async () => {
  // The dead zone is narrow — 5%, not 30%. A wider one converged and
  // then sat there paying refusals for ever: simulated against an
  // upstream refusing under 5s, a 30% tolerance settled at 4.5s and
  // held a 10% refusal rate indefinitely. A tolerance for refusals is
  // a standing order for traffic that returns nothing.
  const kv = makeKv();
  const limiter = new RateLimiter(kv, () => 1_000_000);
  await limiter.adjustAutoInterval('discogs', 0.5);
  const held = await limiter.effectiveMinInterval('discogs');
  await limiter.adjustAutoInterval('discogs', 0.02);   // one in fifty
  assert.equal(await limiter.effectiveMinInterval('discogs'), held, 'no reaction to noise');

  await limiter.adjustAutoInterval('discogs', 0.1);    // one in ten is not noise
  assert.ok(await limiter.effectiveMinInterval('discogs') > held, 'but a real refusal rate widens');
});

test('a person may always slow the matcher, and never speed it', async () => {
  // The manual key stays widen-only; the controller may move both ways.
  // Taking the wider of the two keeps both properties at once.
  const kv = makeKv();
  const limiter = new RateLimiter(kv, () => 1_000_000);
  const floor = BUDGETS.discogs.minIntervalMs;

  await kv.put(minIntervalKey('discogs'), '9000', { expirationTtl: 60 });
  await kv.put(autoIntervalKey('discogs'), String(floor), { expirationTtl: 60 });
  assert.equal(await limiter.effectiveMinInterval('discogs'), 9000,
    'the human override wins when it is wider');

  await kv.put(minIntervalKey('discogs'), String(floor - 1000), { expirationTtl: 60 });
  assert.equal(await limiter.effectiveMinInterval('discogs'), floor,
    'and a value below the floor is refused, not honoured');
});

test('a tick that reached nothing stops asking for a while', async () => {
  // Every further request is one that will also be refused: it spends
  // the subrequest budget and the shared window and returns nothing.
  let now = 1_000_000;
  const kv = makeKv();
  const limiter = new RateLimiter(kv, () => now);

  assert.equal(await limiter.inCooldown('discogs'), false);
  await limiter.startCooldown('discogs', 600_000);
  assert.equal(await limiter.inCooldown('discogs'), true);

  now += 599_000;
  assert.equal(await limiter.inCooldown('discogs'), true, 'still sitting out');
  now += 2_000;
  assert.equal(await limiter.inCooldown('discogs'), false, 'and then tries again on its own');
});
