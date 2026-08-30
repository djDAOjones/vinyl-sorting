// @ts-check

/**
 * SPIKE-PHOTO-TO-FIELDS — the harness, tested without spending anything.
 *
 * The accuracy question needs twenty photographed labels and cannot be
 * answered here. Everything else can: that the spike cannot reach the
 * store, that the contract still forbids inference, that the scorer
 * counts a refusal and a wrong answer as different things, and that
 * the trap fires. Those are the parts that would quietly rot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXTRACTION_TOOL, SYSTEM_PROMPT, PHOTO_FIELDS,
  buildRequest, scoreOne, trapSprung, summarise, costOf,
} from '../lib/photo-fields.mjs';

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── the boundaries a spike must not cross ─────────────────────────

test('the spike cannot reach the database at all', () => {
  for (const f of ['tools/photo-extract.mjs', 'tools/photo-score.mjs', 'tools/lib/photo-fields.mjs']) {
    const code = strip(readFileSync(f, 'utf8'));
    for (const forbidden of ['node:sqlite', 'DatabaseSync', 'applySchema', 'INSERT', 'UPDATE']) {
      assert.ok(!code.includes(forbidden),
        `${f} reaches ${forbidden} — a spike measures; promoting a reading into the store is a separate decision`);
    }
  }
});

test('nothing in the spike writes to capture', () => {
  // The hard rule: `capture` holds what a HUMAN read. A machine reading
  // a photograph is not that, and duplicate detection depends on the
  // difference.
  for (const f of ['tools/photo-extract.mjs', 'tools/photo-score.mjs', 'tools/lib/photo-fields.mjs']) {
    assert.ok(!/\bcapture\s*\(|INTO\s+capture\b/i.test(readFileSync(f, 'utf8')),
      `${f} writes capture`);
  }
});

test('the spike adds no runtime dependency', () => {
  // The sanctioned exception list in AGENTS.md is closed. The Anthropic
  // SDK would be a stop-and-ask, so the harness speaks HTTP directly.
  const code = readFileSync('tools/photo-extract.mjs', 'utf8');
  assert.ok(!code.includes('@anthropic-ai/sdk'), 'imports the SDK');
  assert.match(code, /fetch\('https:\/\/api\.anthropic\.com/, 'calls the API over plain fetch');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['hono'], 'runtime dependencies unchanged');
});

test('the credential is read from the environment, never the repo', () => {
  const code = readFileSync('tools/photo-extract.mjs', 'utf8');
  assert.match(code, /process\.env\.ANTHROPIC_API_KEY/);
  assert.ok(!/sk-ant-/.test(code), 'a key is pasted into the source');
});

// ── the extraction contract ───────────────────────────────────────

test('the no-inference clause survives editing', () => {
  // This clause is the only thing between the tool and a plausible
  // catalogue number recalled from the repertoire rather than read off
  // the disc. It is one careless rewrite from being lost.
  assert.match(SYSTEM_PROMPT, /Never infer a value from your knowledge/);
  assert.match(SYSTEM_PROMPT, /worse than no\s*\n?value at all/);
});

test('a number the model cannot assign has somewhere to go that is not catno', () => {
  const props = EXTRACTION_TOOL.input_schema.properties;
  assert.ok(props.other_numbers, 'other_numbers exists');
  assert.equal(props.other_numbers.type, 'array');
  assert.ok(EXTRACTION_TOOL.input_schema.required.includes('other_numbers'),
    'required, so the model must account for every number it saw');
  assert.match(props.other_numbers.description, /rather than guessing/);
});

test('the tool is strict, so a half-formed object never reaches the scorer', () => {
  assert.equal(EXTRACTION_TOOL.strict, true);
  assert.equal(EXTRACTION_TOOL.input_schema.additionalProperties, false);
  for (const f of PHOTO_FIELDS) {
    assert.ok(EXTRACTION_TOOL.input_schema.required.includes(f), `${f} is required`);
    assert.deepEqual(EXTRACTION_TOOL.input_schema.properties[f].type, ['string', 'null'],
      `${f} may be null — refusing is a first-class answer`);
  }
});

test('the request puts the image before the text, and forces the tool', () => {
  const req = buildRequest({ model: 'claude-opus-5', base64: 'AAAA' });
  const [first, second] = req.messages[0].content;
  assert.equal(first.type, 'image');
  assert.equal(second.type, 'text');
  assert.deepEqual(req.tool_choice, { type: 'tool', name: 'record_label' });
  assert.equal(req.system, SYSTEM_PROMPT);
});

// ── scoring: refused and wrong are not the same thing ─────────────

const truth = {
  catno_raw: 'SXL 6529', label_raw: 'Decca', name_raw: 'Britten; Pears',
  title_raw: 'Serenade for Tenor, Horn and Strings', year_raw: '1972',
  decoy_numbers: ['ZAL-13045', '1A', '6529'],
};

test('an exact read, a refusal and a wrong value are counted apart', () => {
  const v = scoreOne({
    catno_raw: 'SXL 6529',      // exact
    label_raw: null,            // refused
    name_raw: 'Karajan',        // wrong
    title_raw: 'Serenade for Tenor, Horn and Strings',
    year_raw: null,
  }, truth);
  assert.equal(v.catno_raw, 'exact');
  assert.equal(v.label_raw, 'refused');
  assert.equal(v.name_raw, 'wrong');
  assert.equal(v.title_raw, 'exact');
  assert.equal(v.year_raw, 'refused');
});

test('a value supplied where the label carries none is invented, not wrong', () => {
  // Different failure: nothing was misread, something was conjured.
  const v = scoreOne({ year_raw: '1972' }, { ...truth, year_raw: '' });
  assert.equal(v.year_raw, 'invented');
  const w = scoreOne({ year_raw: null }, { ...truth, year_raw: '' });
  assert.equal(w.year_raw, 'correctly-absent');
});

test('comparison reuses the proven ladder rather than a new one', () => {
  // `RDS9451` and `RDS 9451` are the same catalogue number — the gap
  // that accounted for most of a 53-of-60 no-match run. Scoring must
  // not re-open it.
  assert.equal(scoreOne({ catno_raw: 'RDS9451' }, { catno_raw: 'RDS 9451' }).catno_raw, 'exact');
  assert.equal(scoreOne({ catno_raw: 'sxl-6529' }, { catno_raw: 'SXL 6529' }).catno_raw, 'exact');
  // Titles fold loosely: punctuation is not a misreading.
  assert.equal(
    scoreOne({ title_raw: 'Symphony No 2 Romantic' }, { title_raw: 'Symphony No. 2 "Romantic"' }).title_raw,
    'exact');
});

test('a decoy number reported as the catalogue number springs the trap', () => {
  assert.equal(trapSprung({ catno_raw: 'ZAL-13045' }, truth), true, 'matrix number taken for a catno');
  assert.equal(trapSprung({ catno_raw: 'ZAL13045' }, truth), true, 'and again once folded');
  assert.equal(trapSprung({ catno_raw: 'SXL 6529' }, truth), false, 'the real one is not a trap');
  assert.equal(trapSprung({ catno_raw: null }, truth), false, 'refusing is never a trap');
});

// ── the bar the record sets ───────────────────────────────────────

const row = (verdicts, trap = false) => ({ verdicts, trap });
const all = (v) => Object.fromEntries(PHOTO_FIELDS.map((f) => [f, v]));

test('the run passes only when refusals beat wrong answers', () => {
  const mostlyRight = summarise([
    row({ ...all('exact'), label_raw: 'refused' }),
    row({ ...all('exact'), year_raw: 'refused' }),
  ]);
  assert.equal(mostlyRight.totals.wrong, 0);
  assert.equal(mostlyRight.totals.refused, 2);
  assert.equal(mostlyRight.passes, true);

  const guessy = summarise([
    row({ ...all('exact'), catno_raw: 'wrong', label_raw: 'wrong' }),
    row({ ...all('exact'), year_raw: 'refused' }),
  ]);
  assert.equal(guessy.totals.wrong, 2);
  assert.equal(guessy.totals.refused, 1);
  assert.equal(guessy.passes, false, 'wrong outnumbered refused');
});

test('one sprung trap fails an otherwise perfect run', () => {
  const s = summarise([row(all('exact')), row(all('exact'), true)]);
  assert.equal(s.totals.wrong, 0);
  assert.equal(s.totals.trapsSprung, 1);
  assert.equal(s.passes, false,
    'a number treated as a verdict is the failure the whole project exists to stop');
});

test('invented values count against the run alongside wrong ones', () => {
  const s = summarise([row({ ...all('correctly-absent'), catno_raw: 'invented' })]);
  assert.equal(s.totals.wrong, 1, 'invented is a wrong answer for the bar');
  assert.equal(s.passes, false);
});

// ── cost, from what the API reported ──────────────────────────────

test('cost is priced from reported usage, so the spike corrects its own arithmetic', () => {
  const usages = Array.from({ length: 4 }, () => ({ input_tokens: 2000, output_tokens: 200 }));
  const c = costOf(usages, 'claude-haiku-4-5');
  // 2000 in at $1/M + 200 out at $5/M = $0.003 per photo.
  assert.equal(c.perPhotoUsd.toFixed(5), '0.00300');
  assert.equal(c.collectionUsd.toFixed(2), '2.25');
  assert.equal(c.collectionBatchedUsd.toFixed(2), '1.13');
  assert.equal(costOf(usages, 'some-model-we-do-not-price'), null);
});

// ── the scorer end to end ─────────────────────────────────────────

test('the scorer reports a failed read even when that photo was never typed', async () => {
  // Ordering matters here: looking up ground truth first would drop an
  // untyped failure silently, reporting a clean run over a partial one.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync: write } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'dg-score-'));
  write(join(dir, 'truth.csv'),
    'file,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\n'
    + 'a.jpeg,SXL 6529,Decca,Britten,Serenade,1972,ZAL-13045\n');
  write(join(dir, 'run.json'), JSON.stringify({
    model: 'claude-opus-5', effort: 'low',
    results: {
      'a.jpeg': { fields: { catno_raw: 'SXL-6529', label_raw: 'Decca', name_raw: 'Britten', title_raw: 'Serenade', year_raw: '1972' },
                  usage: { input_tokens: 2000, output_tokens: 200 } },
      'z.jpeg': { error: 'HTTP 529: overloaded' },
    },
  }));

  const report = execFileSync(process.execPath, [
    'tools/photo-score.mjs', '--extract', join(dir, 'run.json'),
    '--truth', join(dir, 'truth.csv'), '--out', join(dir, 'score.md'),
  ], { encoding: 'utf8' });

  assert.match(report, /Photos that failed to read/);
  assert.match(report, /z\.jpeg.*529/);
  assert.match(report, /PASSES/, 'the typed photo read cleanly');
});

test('the scorer exits non-zero when the run fails the bar, so it can gate', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync: write } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'dg-score-'));
  write(join(dir, 'truth.csv'),
    'file,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\n'
    + 'a.jpeg,ASD 2532,HMV,Elgar,Cello Concerto,1965,XEX 1234\n');
  write(join(dir, 'run.json'), JSON.stringify({
    model: 'claude-opus-5', effort: 'low',
    results: {
      // The decoy reported as the catalogue number: one occurrence fails it.
      'a.jpeg': { fields: { catno_raw: 'XEX 1234', label_raw: 'HMV', name_raw: 'Elgar', title_raw: 'Cello Concerto', year_raw: '1965' },
                  usage: { input_tokens: 2000, output_tokens: 200 } },
    },
  }));

  assert.throws(() => execFileSync(process.execPath, [
    'tools/photo-score.mjs', '--extract', join(dir, 'run.json'),
    '--truth', join(dir, 'truth.csv'), '--out', join(dir, 'score.md'),
  ], { encoding: 'utf8', stdio: 'pipe' }), /Command failed/, 'a sprung trap must exit non-zero');
});

test('a flawless run clears the bar — zero does not have to beat zero', () => {
  // Regression: written as `wrong < refused` alone, a run with nothing
  // wrong and nothing refused failed, because 0 < 0 is false. The bar
  // is about where the error budget is spent, not that one must exist.
  const s = summarise([row(all('exact')), row(all('exact'))]);
  assert.equal(s.totals.wrong, 0);
  assert.equal(s.totals.refused, 0);
  assert.equal(s.passes, true);
});
