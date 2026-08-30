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
import { persistRun } from '../../worker/match/run.ts';
import { WRITE_BUDGET_PER_TICK, runMatchBatch } from '../../worker/index.ts';
import { makeEnv } from './helpers/bindings.mjs';

/** Every table persistRun can write to, so "rows written" is measured, not trusted. */
const TABLES = ['release', 'match_run', 'match_candidate', 'field_source', 'item'];
const countRows = (env) => TABLES.reduce(
  (n, t) => n + Number(env.DB.raw.prepare(`SELECT count(*) AS n FROM ${t}`).get().n), 0,
);

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

  const before = countRows(env);
  const reported = await persistRun(env, { itemId: 1, catnoRaw: 'SXL 6113' }, verifiedResult(1));
  const actual = countRows(env) - before;

  // An accounting that drifts from reality is worse than none: the
  // budget would be spent against a number nobody is checking.
  assert.equal(reported, actual, `persistRun said ${reported}, DB grew by ${actual}`);
  assert.ok(reported > 0, 'a verified run writes something');
});

test('a release already known is not written twice, and is not counted twice', async () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO item (crate) VALUES ('B4'), ('B5')");
  env.DB.raw.exec("INSERT INTO capture (item_id, catno_raw) VALUES (1, 'SXL 6113'), (2, 'SXL 6113')");

  const first = await persistRun(env, { itemId: 1 }, verifiedResult(1));
  const before = countRows(env);
  const second = await persistRun(env, { itemId: 2 }, verifiedResult(2));
  const actual = countRows(env) - before;

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
    const out = await runMatchBatch(env, 6, 3);
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
    const out = await runMatchBatch(env, 4, WRITE_BUDGET_PER_TICK);
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

test('the Worker declares a CPU ceiling below the 30s default', () => {
  // Cloudflare's default is 30s per invocation. Unset, a spinning tick
  // gets all of it, 288 times a day.
  const toml = readFileSync('wrangler.toml', 'utf8');
  assert.match(toml, /\[limits\]/, 'wrangler.toml must declare [limits]');
  const m = toml.match(/cpu_ms\s*=\s*(\d+)/);
  assert.ok(m, 'wrangler.toml must set cpu_ms');
  assert.ok(Number(m[1]) < 30000, `cpu_ms ${m[1]} is not below the 30000 default`);
});
