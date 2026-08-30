// @ts-check

/**
 * SPIKE-PHOTO-TO-FIELDS — the round trip, tested without uploading
 * anything.
 *
 * The accuracy question needs twenty photographed labels and cannot be
 * answered here. Everything else can: that the spike cannot reach the
 * store, that the contract still forbids inference, that a reply which
 * lost alignment is refused rather than trusted, and that the scorer
 * counts a refusal and a wrong answer as different things. Those are
 * the parts that would quietly rot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FIELD_SPEC, NO_INFERENCE, BLIND_READ, PHOTO_FIELDS,
  chatPrompt, packInstructions, parseChatReply, scoreOne, trapSprung, summarise,
} from '../lib/photo-fields.mjs';

const TOOLS = ['tools/photo-pack.mjs', 'tools/photo-import.mjs', 'tools/photo-score.mjs', 'tools/lib/photo-fields.mjs'];
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const scratch = () => mkdtempSync(join(tmpdir(), 'dg-photo-'));

// ── the boundaries a spike must not cross ─────────────────────────

test('the spike cannot reach the database at all', () => {
  for (const f of TOOLS) {
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
  for (const f of TOOLS) {
    assert.ok(!/\bcapture\s*\(|INTO\s+capture\b/i.test(readFileSync(f, 'utf8')), `${f} writes capture`);
  }
});

test('no tool calls a paid API or reads a key', () => {
  // Maintainer decision, 2026-08-30: no API keys. The reading happens
  // in a chat window, so nothing metered sits behind the Cloudflare
  // Free plan and OPS-SPEND-GUARD's wall still holds.
  for (const f of TOOLS) {
    const code = strip(readFileSync(f, 'utf8'));
    assert.ok(!/api\.anthropic\.com|api\.openai\.com/.test(code), `${f} calls a paid API`);
    assert.ok(!/ANTHROPIC_API_KEY|OPENAI_API_KEY|process\.env\.[A-Z_]*KEY/.test(code),
      `${f} reads an API key`);
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['hono'], 'runtime dependencies unchanged');
});

// ── the extraction contract ───────────────────────────────────────

test('the no-inference clause survives editing', () => {
  // In a chat there is no strict schema behind the prompt, so these
  // words are the whole guard against a catalogue number recalled from
  // the repertoire rather than read off the disc.
  assert.match(NO_INFERENCE, /Never infer a value from your knowledge/);
  assert.match(NO_INFERENCE, /worse than no\s*\n?value at all/);
  assert.ok(chatPrompt(['A']).includes(NO_INFERENCE), 'and it reaches the pasted prompt');
});

test('the prompt gives an unassignable number somewhere to go that is not catno', () => {
  const p = chatPrompt(['A']);
  assert.match(p, /ONLY if it is presented as the catalogue number/);
  assert.match(p, /unassigned is a correct answer/);
  assert.ok(FIELD_SPEC.some(([k]) => k === 'other_numbers'), 'and the shape has the field');
});

test('the prompt carries the ids in its text, not only in the filenames', () => {
  // Some chat clients never show a model the filename of an upload. A
  // prompt that depended on one would fail in a way that looks like bad
  // extraction rather than a plumbing fault.
  const p = chatPrompt(['DG-0001', 'DG-0002']);
  assert.match(p, /DG-0001/);
  assert.match(p, /DG-0002/);
  assert.match(p, /Here are 2 photographs of 2 vinyl records\./);
  assert.match(chatPrompt(['A']), /Here is a photograph/, 'and it reads correctly for one');
  assert.match(p, /Report the row id in `row_id`/);
});

test('several photographs of one record are asked for as one object', () => {
  // A record photographed three times must come back as one reading,
  // not three records. That is the same misattribution the row ids
  // exist to prevent, arriving from the other direction.
  const p = chatPrompt([{ rowId: '448', photos: 2 }, { rowId: '449', photos: 3 }]);
  assert.match(p, /Here are 5 photographs of 2 vinyl records\./);
  assert.match(p, /SEVERAL PHOTOGRAPHS MAY SHOW THE SAME RECORD/);
  assert.match(p, /ONE object per RECORD, not one per photograph/);
  assert.match(p, /one object per record — 2 in total/);
  assert.match(p, /^  448 — 2 photographs$/m);
  assert.match(p, /^  449 — 3 photographs$/m);

  // And a batch where every record has one photograph says none of it,
  // because there is nothing to disambiguate.
  const single = chatPrompt([{ rowId: 'A', photos: 1 }, { rowId: 'B', photos: 1 }]);
  assert.ok(!single.includes('SEVERAL PHOTOGRAPHS'), 'no instruction nobody needs');
  assert.match(single, /^  A$/m);
});

// ── the reply, which is where a hand-run trip goes wrong ──────────

const REPLY = (rows) => `Sure! Here is the data:\n\n\`\`\`json\n${JSON.stringify(rows)}\n\`\`\`\n\nLet me know if you need anything else.`;

test('a reply is read out of whatever prose and fences it arrives in', () => {
  const r = parseChatReply(REPLY([{ row_id: 'A', catno_raw: 'SXL 6529' }]), ['A']);
  assert.equal(r.results.A.fields.catno_raw, 'SXL 6529');
  assert.deepEqual(r.missing, []);
  const bare = parseChatReply('Here you go: [{"row_id":"A","catno_raw":"X"}] — hope that helps', ['A']);
  assert.equal(bare.results.A.fields.catno_raw, 'X');
});

test('a short reply names what never came back instead of shifting rows', () => {
  // THE failure mode of a hand-run round trip: twenty images up,
  // eighteen objects back. Without ids everything after the gap is
  // attributed to its neighbour — plausible readings, all wrong, and
  // indistinguishable from good data.
  const r = parseChatReply(REPLY([
    { row_id: 'A', catno_raw: '1' },
    { row_id: 'C', catno_raw: '3' },
  ]), ['A', 'B', 'C']);
  assert.deepEqual(Object.keys(r.results), ['A', 'C']);
  assert.deepEqual(r.missing, ['B'], 'B is named, not silently filled from C');
  assert.equal(r.results.C.fields.catno_raw, '3', 'C keeps its own reading');
});

test('an id that was never sent is refused rather than trusted', () => {
  const r = parseChatReply(REPLY([
    { row_id: 'A', catno_raw: '1' },
    { row_id: 'Z', catno_raw: 'invented' },
    { catno_raw: 'no id at all' },
  ]), ['A']);
  assert.deepEqual(Object.keys(r.results), ['A']);
  assert.deepEqual(r.unknown, ['Z', '(missing row_id)']);
});

test('a repeated id keeps the first reading and reports the collision', () => {
  const r = parseChatReply(REPLY([
    { row_id: 'A', catno_raw: 'first' },
    { row_id: 'A', catno_raw: 'second' },
  ]), ['A']);
  assert.equal(r.results.A.fields.catno_raw, 'first');
  assert.deepEqual(r.duplicated, ['A']);
});

test('a reply that is not JSON fails loudly', () => {
  assert.throws(() => parseChatReply('I could not read these images, sorry.', ['A']),
    /no JSON array found/);
  assert.throws(() => parseChatReply('```json\n[{"row_id": "A",}]\n```', ['A']),
    /not valid JSON/);
});

test('a numeric row id from a chat still matches the id that was sent', () => {
  // Chats routinely unquote a numeric-looking id. Comparing raw would
  // drop every row in a pack whose ids came from numbered filenames.
  const r = parseChatReply(REPLY([{ row_id: 12, catno_raw: 'X' }]), ['12']);
  assert.equal(r.results['12'].fields.catno_raw, 'X');
  assert.deepEqual(r.missing, []);
});

// ── scoring: refused and wrong are not the same thing ─────────────

const truth = {
  catno_raw: 'SXL 6529', label_raw: 'Decca', name_raw: 'Britten; Pears',
  title_raw: 'Serenade for Tenor, Horn and Strings', year_raw: '1972',
  decoy_numbers: ['ZAL-13045', '1A', '6529'],
};

test('an exact read, a refusal and a wrong value are counted apart', () => {
  const v = scoreOne({
    catno_raw: 'SXL 6529', label_raw: null, name_raw: 'Karajan',
    title_raw: 'Serenade for Tenor, Horn and Strings', year_raw: null,
  }, truth);
  assert.equal(v.catno_raw, 'exact');
  assert.equal(v.label_raw, 'refused');
  assert.equal(v.name_raw, 'wrong');
  assert.equal(v.title_raw, 'exact');
  assert.equal(v.year_raw, 'refused');
});

test('a value supplied where the label carries none is invented, not wrong', () => {
  // Different failure: nothing was misread, something was conjured.
  assert.equal(scoreOne({ year_raw: '1972' }, { ...truth, year_raw: '' }).year_raw, 'invented');
  assert.equal(scoreOne({ year_raw: null }, { ...truth, year_raw: '' }).year_raw, 'correctly-absent');
});

test('comparison reuses the proven ladder rather than a new one', () => {
  // `RDS9451` and `RDS 9451` are the same catalogue number — the gap
  // that accounted for most of a 53-of-60 no-match run. Scoring must
  // not re-open it.
  assert.equal(scoreOne({ catno_raw: 'RDS9451' }, { catno_raw: 'RDS 9451' }).catno_raw, 'exact');
  assert.equal(scoreOne({ catno_raw: 'sxl-6529' }, { catno_raw: 'SXL 6529' }).catno_raw, 'exact');
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
  const careful = summarise([
    row({ ...all('exact'), label_raw: 'refused' }),
    row({ ...all('exact'), year_raw: 'refused' }),
  ]);
  assert.equal(careful.totals.wrong, 0);
  assert.equal(careful.totals.refused, 2);
  assert.equal(careful.passes, true);

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

test('a flawless run clears the bar — zero does not have to beat zero', () => {
  // Regression: written as `wrong < refused` alone, a run with nothing
  // wrong and nothing refused failed, because 0 < 0 is false.
  const s = summarise([row(all('exact')), row(all('exact'))]);
  assert.equal(s.totals.refused, 0);
  assert.equal(s.passes, true);
});

// ── the round trip, end to end ────────────────────────────────────

/** Real JPEGs, so sips and zip do real work rather than a mocked pass. */
function makePhotos(dir, names) {
  mkdirSync(dir, { recursive: true });
  const src = 'Pre August 2026/Photos/Breaks for Sale Source/IMG_4648.jpeg';
  for (const n of names) execFileSync('sips', ['-Z', '80', src, '--out', join(dir, n)], { stdio: 'ignore' });
}

test('packing batches to the chat upload cap and names every image after its row id', () => {
  const dir = scratch();
  const photos = join(dir, 'photos');
  makePhotos(photos, ['a.jpg', 'b.jpg', 'c.jpg']);

  execFileSync(process.execPath, ['tools/photo-pack.mjs',
    '--photos', photos, '--out', join(dir, 'packs'), '--batch', '2'], { encoding: 'utf8' });

  const packs = readdirSync(join(dir, 'packs')).filter((f) => f.endsWith('.zip')).sort();
  assert.deepEqual(packs, ['pack-01.zip', 'pack-02.zip'], 'three photos at two per batch is two packs');

  const listing = execFileSync('unzip', ['-Z1', join(dir, 'packs', 'pack-01.zip')], { encoding: 'utf8' });
  assert.match(listing, /pack-01\/a\.jpg/);
  assert.match(listing, /pack-01\/b\.jpg/);
  assert.match(listing, /pack-01\/PROMPT\.txt/, 'the prompt travels with the images');
  assert.match(listing, /pack-01\/manifest\.csv/);

  const ids = readFileSync(join(dir, 'packs', 'row-ids.csv'), 'utf8');
  assert.match(ids, /^row_id,original_file$/m);
  assert.match(ids, /^a,a\.jpg$/m, 'the row id defaults to the filename stem');
});

test('a pack is a directory as well as a zip, and carries its own instructions', () => {
  // The directory is the cheap path — a session reads it in place, so
  // there is no upload, no drag and no per-message image cap. Deleting
  // it after zipping would leave the expensive path as the only one.
  const dir = scratch();
  const photos = join(dir, 'photos');
  makePhotos(photos, ['a.jpg', 'b.jpg']);

  execFileSync(process.execPath, ['tools/photo-pack.mjs',
    '--photos', photos, '--out', join(dir, 'packs')], { encoding: 'utf8' });

  const pack = join(dir, 'packs', 'pack-01');
  assert.ok(existsSync(pack), 'the pack directory survives zipping');
  assert.ok(existsSync(join(pack, 'a.jpg')) && existsSync(join(pack, 'b.jpg')));
  assert.ok(existsSync(join(pack, 'pack-01.zip')) === false, 'the zip sits beside the pack, not inside it');
  assert.ok(existsSync(join(dir, 'packs', 'pack-01.zip')));

  const instructions = readFileSync(join(pack, 'READ-THIS-FIRST.md'), 'utf8');
  assert.match(instructions, /^# pack-01 — read these 2 records$/m);
  assert.ok(instructions.includes(chatPrompt(['a', 'b'])),
    'the task travels verbatim, so the two statements of it cannot drift');
  assert.match(instructions, /reply-01\.txt/, 'and it says where the answer goes');

  const listing = execFileSync('unzip', ['-Z1', join(dir, 'packs', 'pack-01.zip')], { encoding: 'utf8' });
  assert.match(listing, /pack-01\/READ-THIS-FIRST\.md/, 'the zip carries them too');
});

test('the blindness clause survives editing and reaches every pack', () => {
  // In an agent session these words are the whole guard — nothing
  // mechanical can prove a context never opened a file. Same shape as
  // the no-inference test, and for the same reason.
  assert.match(BLIND_READ, /DO NOT LOOK UP THE ANSWER/);
  assert.match(BLIND_READ, /ground-truth\.csv/);
  assert.match(BLIND_READ, /answer sheet/);
  // A reader with repo access can open the file whatever this says, so
  // the words must not be the only guard — and must say they are not.
  assert.match(BLIND_READ, /photo-extract\.json/, 'earlier readings are named too');
  assert.match(BLIND_READ, /asked of you rather than enforced/);
  assert.match(BLIND_READ, /non-independent measurement/);
  assert.ok(packInstructions(['A'], 'pack-01', 'r.txt').includes(BLIND_READ));
});

test('no pack ever contains the ground truth that scores it', () => {
  // The no-upload path is cheaper in every way except this one: the
  // answer sheet now sits on the same disk as the photographs. A pack
  // carrying it would be verifying Discogs with Discogs, third time.
  const dir = scratch();
  const photos = join(dir, 'photos');
  makePhotos(photos, ['a.jpg']);
  writeFileSync(join(photos, 'ground-truth.csv'), 'row_id,catno_raw\na,SXL 6529\n');

  execFileSync(process.execPath, ['tools/photo-pack.mjs',
    '--photos', photos, '--out', join(dir, 'packs')], { encoding: 'utf8' });

  assert.ok(!readdirSync(join(dir, 'packs', 'pack-01')).some((f) => /ground-truth/i.test(f)),
    'the pack directory is clean');
  const listing = execFileSync('unzip', ['-Z1', join(dir, 'packs', 'pack-01.zip')], { encoding: 'utf8' });
  assert.ok(!/ground-truth/i.test(listing), 'and so is the zip');
});

test('re-packing rebuilds the packs and keeps replies already collected', () => {
  // The replies live in the pack directory because that is where the
  // instructions send them. Re-packing used to wipe the directory
  // wholesale, which would destroy readings whose cost was never the
  // upload — it was doing the reading.
  const dir = scratch();
  const photos = join(dir, 'photos');
  const packs = join(dir, 'packs');
  makePhotos(photos, ['a.jpg']);

  execFileSync(process.execPath, ['tools/photo-pack.mjs',
    '--photos', photos, '--out', packs], { encoding: 'utf8' });
  writeFileSync(join(packs, 'reply-01.txt'), REPLY([{ row_id: 'a', catno_raw: 'SXL 6529' }]));

  makePhotos(photos, ['b.jpg']);
  execFileSync(process.execPath, ['tools/photo-pack.mjs',
    '--photos', photos, '--out', packs], { encoding: 'utf8' });

  assert.ok(existsSync(join(packs, 'reply-01.txt')), 'the reading survived the re-pack');
  assert.match(readFileSync(join(packs, 'row-ids.csv'), 'utf8'), /^b,b\.jpg$/m, 'and the new photo is packed');
});

test('packing refuses two photos that would share one row id', () => {
  const dir = scratch();
  const photos = join(dir, 'photos');
  makePhotos(photos, ['x.jpg', 'x.png']);   // same stem, different extension
  assert.throws(() => execFileSync(process.execPath, ['tools/photo-pack.mjs',
    '--photos', photos, '--out', join(dir, 'packs')], { encoding: 'utf8', stdio: 'pipe' }),
  /Command failed/, 'a shared id would attribute two records to one row');
});

test('import then score, over a reply that lost a row on the way back', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'row-ids.csv'), 'row_id,original_file\nA,a.jpg\nB,b.jpg\n');
  writeFileSync(join(dir, 'reply.txt'), REPLY([
    // B never came back; A read cleanly apart from a refused year.
    { row_id: 'A', catno_raw: 'SXL-6529', label_raw: 'Decca', name_raw: 'Britten; Pears',
      title_raw: 'Serenade for Tenor, Horn and Strings', year_raw: null, other_numbers: ['ZAL-13045'] },
  ]));

  const imported = execFileSync(process.execPath, ['tools/photo-import.mjs', join(dir, 'reply.txt'),
    '--ids', join(dir, 'row-ids.csv'), '--out', join(dir, 'extract.json'), '--model', 'a chat'],
  { encoding: 'utf8' });
  assert.match(imported, /1 of 2 ids now have a reading/);
  assert.match(imported, /No reading yet for 1: B/);

  writeFileSync(join(dir, 'truth.csv'),
    'row_id,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\n'
    + 'A,SXL 6529,Decca,Britten; Pears,Serenade for Tenor Horn and Strings,1972,ZAL-13045\n'
    + 'B,ASD 2532,HMV,Elgar,Cello Concerto,1965,XEX 1234\n');

  const report = execFileSync(process.execPath, ['tools/photo-score.mjs',
    '--extract', join(dir, 'extract.json'), '--truth', join(dir, 'truth.csv'),
    '--out', join(dir, 'score.md')], { encoding: 'utf8' });

  assert.match(report, /PASSES/, 'one refusal, nothing wrong');
  assert.match(report, /refused: \*\*1\*\*/);
  assert.match(report, /typed but never read back: B/, 'the gap is named, not omitted');
});

test('a reading taken after the answer was typed cannot earn a pass', () => {
  // The reader has repository access, so it can open ground-truth.csv
  // however firmly the prompt asks it not to. Independence therefore
  // cannot be assumed — it is recorded at import, when it is the only
  // moment anyone can still tell.
  const dir = scratch();
  writeFileSync(join(dir, 'row-ids.csv'), 'row_id,original_file\nA,a.jpg\nB,b.jpg\n');
  // A is already answered; B is a blank skeleton row, which is not an
  // answer and must not condemn B.
  writeFileSync(join(dir, 'truth.csv'),
    'row_id,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\n'
    + 'A,SXL 6529,Decca,Britten,Serenade,1972,ZAL-13045\n'
    + 'B,,,,,,\n');
  writeFileSync(join(dir, 'reply.txt'), REPLY([
    { row_id: 'A', catno_raw: 'SXL 6529', label_raw: 'Decca', name_raw: 'Britten',
      title_raw: 'Serenade', year_raw: '1972' },
    { row_id: 'B', catno_raw: 'ASD 2532', label_raw: 'HMV', name_raw: 'Elgar',
      title_raw: 'Cello Concerto', year_raw: '1965' },
  ]));

  const imported = execFileSync(process.execPath, ['tools/photo-import.mjs', join(dir, 'reply.txt'),
    '--ids', join(dir, 'row-ids.csv'), '--truth', join(dir, 'truth.csv'),
    '--out', join(dir, 'extract.json')], { encoding: 'utf8' });
  assert.match(imported, /already had a typed answer/);
  assert.match(imported, /arrived: A$/m, 'only A — a blank row is not an answer');

  const stamped = JSON.parse(readFileSync(join(dir, 'extract.json'), 'utf8'));
  assert.equal(stamped.results.A.truthPreexisting, true);
  assert.equal(stamped.results.B.truthPreexisting, false);

  // Now both are typed, as they would be by scoring time.
  writeFileSync(join(dir, 'truth.csv'),
    'row_id,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\n'
    + 'A,SXL 6529,Decca,Britten,Serenade,1972,ZAL-13045\n'
    + 'B,ASD 2532,HMV,Elgar,Cello Concerto,1965,XEX 1234\n');
  const report = execFileSync(process.execPath, ['tools/photo-score.mjs',
    '--extract', join(dir, 'extract.json'), '--truth', join(dir, 'truth.csv'),
    '--out', join(dir, 'score.md')], { encoding: 'utf8' });

  assert.match(report, /over 1 independently-read label photo/, 'A is not counted');
  assert.match(report, /Held out — the answer existed before the reading/);
  assert.match(report, /^- `A`$/m);
});

test('a run where every row was read after its answer scores nothing at all', () => {
  // The degenerate case: if looking still produced a report, the guard
  // would be decoration. It must refuse outright.
  const dir = scratch();
  writeFileSync(join(dir, 'row-ids.csv'), 'row_id,original_file\nA,a.jpg\n');
  writeFileSync(join(dir, 'truth.csv'),
    'row_id,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\nA,SXL 6529,Decca,B,S,1972,Z\n');
  writeFileSync(join(dir, 'reply.txt'), REPLY([
    { row_id: 'A', catno_raw: 'SXL 6529', label_raw: 'Decca', name_raw: 'B', title_raw: 'S', year_raw: '1972' },
  ]));
  execFileSync(process.execPath, ['tools/photo-import.mjs', join(dir, 'reply.txt'),
    '--ids', join(dir, 'row-ids.csv'), '--truth', join(dir, 'truth.csv'),
    '--out', join(dir, 'extract.json')], { encoding: 'utf8' });

  assert.throws(() => execFileSync(process.execPath, ['tools/photo-score.mjs',
    '--extract', join(dir, 'extract.json'), '--truth', join(dir, 'truth.csv'),
    '--out', join(dir, 'score.md')], { encoding: 'utf8', stdio: 'pipe' }),
  /Command failed/, 'a perfect-looking run of looked-up answers still scores nothing');
});

test('a reply naming an id nobody sent exits non-zero, so a bad round trip cannot be scored quietly', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'row-ids.csv'), 'row_id,original_file\nA,a.jpg\n');
  writeFileSync(join(dir, 'reply.txt'), REPLY([
    { row_id: 'A', catno_raw: '1' },
    { row_id: 'B', catno_raw: '2' },
  ]));
  assert.throws(() => execFileSync(process.execPath, ['tools/photo-import.mjs', join(dir, 'reply.txt'),
    '--ids', join(dir, 'row-ids.csv'), '--out', join(dir, 'extract.json')],
  { encoding: 'utf8', stdio: 'pipe' }), /Command failed/);
});

test('the scorer exits non-zero when a decoy is reported as the catalogue number', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'extract.json'), JSON.stringify({
    source: 'chat', model: 'a chat',
    results: { A: { fields: { catno_raw: 'XEX 1234', label_raw: 'HMV', name_raw: 'Elgar',
      title_raw: 'Cello Concerto', year_raw: '1965' } } },
  }));
  writeFileSync(join(dir, 'truth.csv'),
    'row_id,catno_raw,label_raw,name_raw,title_raw,year_raw,decoy_numbers\n'
    + 'A,ASD 2532,HMV,Elgar,Cello Concerto,1965,XEX 1234\n');
  assert.throws(() => execFileSync(process.execPath, ['tools/photo-score.mjs',
    '--extract', join(dir, 'extract.json'), '--truth', join(dir, 'truth.csv'),
    '--out', join(dir, 'score.md')], { encoding: 'utf8', stdio: 'pipe' }), /Command failed/);
});
