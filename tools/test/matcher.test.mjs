// @ts-check
/**
 * M2-MATCHER — a catalogue number is a lead, never a verdict.
 *
 * The gate is the whole point of the milestone, so most of these tests
 * assert a REFUSAL to auto-accept.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compactCatno, normaliseCatno } from '../../worker/match/normalise.ts';
import { checkCatno, checkRow } from '../../worker/match/sanity.ts';
import { GATE, applyGate, scoreCandidate } from '../../worker/match/score.ts';
import { buildQueries } from '../../worker/match/queries.ts';
import { matchRow } from '../../worker/match/run.ts';

// ── normalisation ─────────────────────────────────────────────────

test('the U+2011 catalogue numbers M0 preserved now normalise', () => {
  // M0 repairs faithfully rather than normalising, so these seven rows
  // really do contain a non-breaking hyphen. Without the fold they
  // silently fail every exact-match step.
  for (const raw of ['TWO‑269', 'CFP‑160', 'MFP‑57010', 'W‑5828']) {
    const variants = normaliseCatno(raw);
    assert.ok(variants.some((v) => /^[A-Z]+-\d+$/.test(v)), `${JSON.stringify(raw)} -> ${variants}`);
    assert.ok(variants.every((v) => !/[‐-―]/.test(v)), 'no Unicode dash may survive');
  }
  assert.equal(compactCatno('TWO‑269'), compactCatno('TWO-269'));
});

test('a label prefix is dropped as well as kept, so both readings are tried', () => {
  const v = normaliseCatno('Philips 6308 177');
  assert.ok(v.includes('PHILIPS 6308 177'));
  assert.ok(v.includes('6308 177'), 'a label prefix is a lead, not part of the number');
});

test('format noise and parentheticals are stripped', () => {
  const v = normaliseCatno('SXL 6113 (UK) stereo');
  assert.ok(v.includes('SXL 6113'));
  assert.ok(v.every((x) => !/STEREO|\(/.test(x)));
});

test('multi-catalogue strings split, and label words are not searched alone', () => {
  const v = normaliseCatno('LSC-7054 ; RL 42057');
  assert.ok(v.some((x) => compactCatno(x) === 'LSC7054'));
  assert.ok(v.some((x) => compactCatno(x) === 'RL42057'));
  // "COLUMBIA" alone has no digits — searching it is how four records
  // all matched one release.
  assert.ok(!normaliseCatno('Columbia / CBS').some((x) => /COLUMBIA|CBS/.test(x) && !/\d/.test(x)));
});

test('variants are unique and ordered, most literal first', () => {
  const v = normaliseCatno('CFP 40001');
  assert.equal(new Set(v).size, v.length);
  assert.equal(v[0], 'CFP 40001');
});

// ── the sanity check, before any API call ─────────────────────────

test('junk catalogue input is rejected before a single request', () => {
  for (const junk of ['RD ?', '?', 'n/a', 'unknown', 'mono', '  ', 'AB', '']) {
    assert.equal(checkCatno(junk).usable, false, `${JSON.stringify(junk)} should be refused`);
  }
});

test('real catalogue numbers pass', () => {
  for (const good of ['SXL 6113', 'CFP40001', '2531103', 'LSC-3177', '6.24088 AP']) {
    assert.equal(checkCatno(good).usable, true, good);
  }
});

test('a row with no usable catalogue may still match on title plus a second signal', () => {
  assert.equal(checkRow({ catnoRaw: 'RD ?', titleRaw: 'Symphony No. 5', nameRaw: 'Solti' }).usable, true);
  assert.equal(checkRow({ catnoRaw: 'RD ?', titleRaw: 'Symphony No. 5' }).usable, false,
    'a title alone cannot corroborate anything');
  assert.equal(checkRow({ catnoRaw: '?' }).usable, false);
});

// ── the corroboration gate ────────────────────────────────────────

const capture = {
  catnoVariants: ['SXL 6113', 'SXL6113'],
  labelRaw: 'Decca', titleRaw: 'Symphony No. 5', nameRaw: 'Solti', yearRaw: '1964',
};
const vinyl = { format: ['Vinyl', 'LP'] };

test('an exact catalogue number ALONE is never auto-accepted', () => {
  // The defect this project exists to fix: catno exact -> "Exact".
  const scored = [scoreCandidate(
    { catnoVariants: ['SXL 6113'] },
    { id: 1, catno: 'SXL 6113', ...vinyl },
  )];
  const gate = applyGate(scored);
  assert.equal(gate.verdict, 'needs_review');
  assert.match(gate.reason, /a catalogue number alone is a lead, not a verdict/);
  assert.deepEqual(scored[0].families, ['identifier']);
});

test('two agreeing families with a clear margin are auto-accepted', () => {
  const gate = applyGate([
    scoreCandidate(capture, { id: 1, catno: 'SXL 6113', label: ['Decca'], title: 'Solti - Symphony No. 5', year: 1964, ...vinyl }),
    scoreCandidate(capture, { id: 2, catno: 'SXL 9999', label: ['Philips'], title: 'Something else', ...vinyl }),
  ]);
  assert.equal(gate.verdict, 'verified');
  assert.ok(gate.chosen.score >= GATE.minScore);
  assert.ok(gate.chosen.families.length >= GATE.minFamilies);
  assert.ok(gate.margin >= GATE.minMargin);
});

test('a near-tie is refused however high the score — the margin test', () => {
  // Four records all matching one release with nothing to separate them
  // is the collision the margin exists to kill.
  const strong = { catno: 'SXL 6113', label: ['Decca'], title: 'Solti - Symphony No. 5', year: 1964, ...vinyl };
  const gate = applyGate([
    scoreCandidate(capture, { id: 1, ...strong }),
    scoreCandidate(capture, { id: 2, ...strong }),
  ]);
  assert.equal(gate.verdict, 'needs_review');
  assert.match(gate.reason, /margin/);
  assert.equal(gate.margin, 0);
});

test('a non-vinyl format counts as evidence against, not absent evidence', () => {
  const cd = scoreCandidate(capture, { id: 1, catno: 'SXL 6113', label: ['Decca'], format: ['CD'] });
  const lp = scoreCandidate(capture, { id: 2, catno: 'SXL 6113', label: ['Decca'], ...vinyl });
  assert.ok(cd.score < lp.score - 25, 'a CD must not win a vinyl shelf');
  assert.match(cd.signals.formatKind, /not vinyl/);
});

test('nothing scored is no_match, not a weak accept', () => {
  const gate = applyGate([]);
  assert.equal(gate.verdict, 'no_match');
  assert.equal(gate.chosen, null);
});

test('ranking is stable, so an identical result set always gives the same verdict', () => {
  const results = [
    { id: 30, catno: 'X', ...vinyl }, { id: 10, catno: 'X', ...vinyl }, { id: 20, catno: 'X', ...vinyl },
  ];
  const once = applyGate(results.map((r) => scoreCandidate(capture, r))).ranked.map((r) => r.id);
  const twice = applyGate([...results].reverse().map((r) => scoreCandidate(capture, r))).ranked.map((r) => r.id);
  assert.deepEqual(once, twice, 'reproducibility is what makes a bad match arguable later');
});

// ── the query ladder ──────────────────────────────────────────────

test('label plus catalogue is tried first — the only rung that can clear the gate alone', () => {
  const { queries } = buildQueries({ catnoRaw: 'SXL 6113', labelRaw: 'Decca', titleRaw: 'Symphony No. 5' });
  assert.equal(queries[0].type, 'label_catno');
  assert.ok(queries.some((q) => q.type === 'catno'));
  assert.equal(new Set(queries.map((q) => JSON.stringify(q))).size, queries.length, 'no duplicate queries');
});

test('no query is built from anything but stored capture values', () => {
  const src = readdirSync('worker/match').map((f) => readFileSync(`worker/match/${f}`, 'utf8')).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /c\.req|request\.|searchParams\.get/,
    'the matcher must never read a request — it runs from cron');
});

test('the matcher is not reachable over HTTP', () => {
  const index = readFileSync('worker/index.ts', 'utf8');
  assert.doesNotMatch(index, /app\.(get|post|put|all)\([^)]*match[^)]*\)\s*,\s*async[^)]*runMatchBatch/i);
  assert.match(index, /scheduled:/, 'matching is driven by a cron trigger');
  const toml = readFileSync('wrangler.toml', 'utf8');
  assert.match(toml, /\[triggers\]/);
});

// ── end to end against a scripted Discogs ─────────────────────────

/** A client that answers from a fixture, counting what was asked. */
const scriptedClient = (byQuery) => {
  const asked = [];
  return {
    asked,
    search: async (params) => {
      asked.push(params);
      const key = params.catno ?? params.title ?? params.q ?? '';
      return byQuery[key] ?? [];
    },
    getRelease: async () => ({}),
  };
};

test('a junk row costs no API call at all', async () => {
  const client = scriptedClient({});
  const { outcome } = await matchRow({ itemId: 1, captureId: 1, catnoRaw: 'RD ?' }, client);
  assert.equal(outcome.verdict, 'rejected');
  assert.equal(outcome.queriesRun, 0);
  assert.equal(client.asked.length, 0, 'the sanity check runs before the network');
});

test('a corroborated row verifies and names the release', async () => {
  const client = scriptedClient({
    'SXL 6113': [
      { id: 111, catno: 'SXL 6113', label: ['Decca'], title: 'Solti - Symphony No. 5', year: 1964, format: ['Vinyl', 'LP'] },
      { id: 222, catno: 'ZZZ 1', label: ['Other'], title: 'Unrelated', format: ['Vinyl'] },
    ],
  });
  const { outcome, gate } = await matchRow({
    itemId: 1, captureId: 1, catnoRaw: 'SXL 6113', labelRaw: 'Decca',
    titleRaw: 'Symphony No. 5', nameRaw: 'Solti', yearRaw: '1964',
  }, client);
  assert.equal(outcome.verdict, 'verified');
  assert.equal(outcome.chosenDiscogsId, 111);
  assert.ok(gate.ranked.length >= 2, 'the runner-up is kept so the margin is auditable');
});

test('a catalogue-only hit reaches the review queue, not the collection', async () => {
  const client = scriptedClient({
    'SXL 6113': [{ id: 111, catno: 'SXL 6113', format: ['Vinyl', 'LP'] }],
  });
  const { outcome } = await matchRow({ itemId: 1, captureId: 1, catnoRaw: 'SXL 6113' }, client);
  assert.equal(outcome.verdict, 'needs_review');
  assert.equal(outcome.chosenDiscogsId, null, 'nothing is linked without corroboration');
});

// ── the audit must not mark its own homework ──────────────────────

test('only human-supplied values may corroborate a Discogs match', async () => {
  const { humanFieldsOnly } = await import('../reverify.mjs');

  // On the 277 enriched rows the label came FROM Discogs. Letting it
  // vote compares Discogs with itself: a first audit run did exactly
  // that and reported 1 unsupported out of 277, measuring nothing.
  const enriched = {
    catno_raw: 'GL25021', catno_raw_source: 'legacy',
    label_raw: 'RCA Gold Seal', label_raw_source: 'discogs',
    title: 'Symphony No. 2', title_source: 'legacy',
    conductor: 'Charles Gerhardt', conductor_source: 'legacy',
  };
  const used = humanFieldsOnly(enriched);
  assert.equal(used.labelRaw, '', 'a Discogs-sourced label must not corroborate a Discogs match');
  assert.equal(used.titleRaw, 'Symphony No. 2', 'legacy values are what a person typed');
  assert.equal(used.nameRaw, 'Charles Gerhardt');

  // A label read off the shelf is evidence, and must be kept.
  const captured = { catno_raw: 'SXL 6113', catno_raw_source: 'shelf', label_raw: 'Decca', label_raw_source: 'shelf' };
  assert.equal(humanFieldsOnly(captured).labelRaw, 'Decca');
});

test('excluding the circular field genuinely changes the verdict', async () => {
  const { humanFieldsOnly } = await import('../reverify.mjs');
  const row = {
    catno_raw: 'GL25021', catno_raw_source: 'legacy',
    label_raw: 'RCA Gold Seal', label_raw_source: 'discogs',
  };
  const claimed = { id: 7387168, catno: 'GL25021', label: ['RCA Gold Seal'], format: ['Vinyl', 'LP'] };

  const honest = scoreCandidate(humanFieldsOnly(row), claimed);
  const circular = scoreCandidate({ ...humanFieldsOnly(row), labelRaw: row.label_raw }, claimed);

  assert.ok(!honest.families.includes('label'));
  assert.ok(circular.families.includes('label'));
  assert.ok(circular.families.length > honest.families.length,
    'the circular reading manufactures a second family out of nothing');
  assert.equal(honest.families.length, 1, 'on this row the catalogue number is the only human evidence');
});

test('a catalogue number typed without a space still asks Discogs the spaced question', () => {
  // Measured against the live API: `RDS9451` returns nothing and
  // `RDS 9451` returns the record. The ported ladder only ever removed
  // separators, never introduced them, so a compacted catalogue number
  // produced a single variant — most of a 53-of-60 no-match run.
  const v = normaliseCatno('RDS9451');
  assert.ok(v.includes('RDS 9451'), `expected a spaced variant, got ${JSON.stringify(v)}`);
  assert.ok(v.includes('RDS-9451'));
  assert.equal(v[0], 'RDS9451', 'the literal reading still comes first');
});

test('splitting letters from digits does not mangle numbers that need no split', () => {
  assert.deepEqual(normaliseCatno('420540-1'), ['420540-1', '4205401']);
  assert.ok(normaliseCatno('SXL 6113').includes('SXL 6113'));
  // Every variant still has a digit — a label word is never searched.
  for (const raw of ['CBS77506', 'CFP 40001', '6.24088 AP', 'Columbia / CBS']) {
    for (const v of normaliseCatno(raw)) assert.match(v, /\d/, `${raw} -> ${v}`);
  }
});

// ── a throttled search is not a negative result ───────────────────

test('when every query fails the row is an error, never "nothing found"', async () => {
  const failing = {
    search: async () => { throw new Error('HTTP 429'); },
    getRelease: async () => ({}),
  };
  const { outcome } = await matchRow(
    { itemId: 1, captureId: 1, catnoRaw: 'SXL 6113', titleRaw: 'Symphony No. 5' }, failing);

  assert.equal(outcome.verdict, 'error',
    'reporting a throttled row as no_match marks it unmatched for ever');
  assert.ok(outcome.queryErrors > 0);
  assert.match(outcome.reason, /queries failed/);
  assert.notEqual(outcome.verdict, 'no_match');
});

test('a genuine empty result set is still no_match', async () => {
  const empty = { search: async () => [], getRelease: async () => ({}) };
  const { outcome } = await matchRow(
    { itemId: 1, captureId: 1, catnoRaw: 'SXL 6113', titleRaw: 'Symphony No. 5' }, empty);
  assert.equal(outcome.verdict, 'no_match');
  assert.equal(outcome.queryErrors, 0);
});

test('partial failure still yields a verdict, and says how many rungs failed', async () => {
  let call = 0;
  const flaky = {
    search: async () => {
      call++;
      if (call === 1) throw new Error('HTTP 429');
      return [{ id: 7, catno: 'SXL 6113', label: ['Decca'], title: 'Solti - Symphony No. 5', year: 1964, format: ['Vinyl', 'LP'] }];
    },
    getRelease: async () => ({}),
  };
  const { outcome } = await matchRow({
    itemId: 1, captureId: 1, catnoRaw: 'SXL 6113', labelRaw: 'Decca',
    titleRaw: 'Symphony No. 5', nameRaw: 'Solti', yearRaw: '1964',
  }, flaky);
  assert.notEqual(outcome.verdict, 'error');
  assert.equal(outcome.queryErrors, 1);
  assert.match(outcome.reason, /1 query error/);
});

test('the client waits for the shared budget instead of failing on it', async () => {
  const { DiscogsClient } = await import('../../worker/discogs.ts');
  const { RateLimiter } = await import('../../worker/rate-limit.ts');

  // A store that is already at the limit for this window, then rolls.
  let now = 1_000_000;
  const counters = new Map([[`rl:discogs:${now - (now % 60_000)}`, '50']]);
  const limiter = new RateLimiter(
    { get: async (k) => counters.get(k) ?? null, put: async (k, v) => { counters.set(k, v); } },
    () => now,
  );

  let fetched = 0;
  const client = new DiscogsClient('tok', limiter,
    async () => { fetched++; return new Response('{"results":[]}', { status: 200 }); },
    // Sleeping advances the clock into the next window.
    async (ms) => { now += ms; });

  const results = await client.search({ catno: 'SXL 6113' });
  assert.deepEqual(results, [], 'the call completed rather than throwing');
  assert.equal(fetched, 1, 'it waited for the budget, then made exactly one request');
});

test('the client honours a Retry-After rather than hammering', async () => {
  const { DiscogsClient } = await import('../../worker/discogs.ts');
  const { RateLimiter } = await import('../../worker/rate-limit.ts');

  const counters = new Map();
  const limiter = new RateLimiter({
    get: async (k) => counters.get(k) ?? null, put: async (k, v) => { counters.set(k, v); },
  }, () => 1_000_000);

  let calls = 0;
  const slept = [];
  const client = new DiscogsClient('tok', limiter, async () => {
    calls++;
    return calls === 1
      ? new Response('', { status: 429, headers: { 'retry-after': '3' } })
      : new Response('{"results":[{"id":1}]}', { status: 200 });
  }, async (ms) => { slept.push(ms); });

  const results = await client.search({ catno: 'X' });
  assert.equal(results.length, 1, 'it retried and succeeded');
  assert.ok(slept.includes(3000), `expected a 3s wait from Retry-After, slept ${slept}`);
});
