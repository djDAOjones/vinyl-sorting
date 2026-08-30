// @ts-check

/**
 * photo-fields.mjs — SPIKE-PHOTO-TO-FIELDS.
 *
 * The extraction contract, the paste-in prompt, the reply parser and
 * the scorer. No I/O and no network, so the whole round trip can be
 * tested without uploading anything.
 *
 * NO API KEY, by maintainer decision (2026-08-30). The reading happens
 * in a chat window: photos go up as a zip, an answer comes back as
 * text, and that text is imported here. That keeps OPS-SPEND-GUARD
 * intact — the Cloudflare Free plan stays the wall, because nothing
 * metered was added behind it — and leaves the Worker's one-outbound-
 * file invariant untouched.
 *
 * THE GOVERNING RULE, inherited from split-label-catno: a wrong value
 * is worse than an absent one, so the contract refuses rather than
 * guesses and every refusal is counted separately. A blank catalogue
 * number costs one re-read. A confident wrong one is the 9% error M0
 * measured — 26 of 277 rows pointing at a different record, 16 of them
 * labelled "Exact" — recreated by a new route.
 *
 * A hand-run round trip has one failure mode an API call does not:
 * the answer can come back for the wrong photo. Twenty images go up,
 * eighteen objects come back, and everything after the gap is silently
 * attributed to its neighbour. Every row therefore carries its own
 * `row_id`, and the parser refuses an id it did not send rather than
 * trusting position.
 */

import { compactCatno, compactText } from '../../worker/match/normalise.ts';

/**
 * The five `capture` columns a label photograph can carry.
 *
 * Not `matrix_runout`: that is etched in the deadwax, not printed on
 * the label, which is why `runout` is its own photo kind in the schema.
 * Not the grades, crate or position — condition is a judgement and
 * location is a fact about where the person is standing.
 */
export const PHOTO_FIELDS = /** @type {const} */ ([
  'catno_raw',
  'label_raw',
  'name_raw',
  'title_raw',
  'year_raw',
]);

/** Compared as catalogue numbers; the rest compare as loose text. */
const CATNO_FIELDS = new Set(['catno_raw']);

/**
 * One source of truth for the shape: it writes the prompt and it
 * validates what comes back, so the two cannot drift apart.
 */
export const FIELD_SPEC = [
  ['row_id', 'the id at the start of the filename of this record\'s image(s)'],
  ['catno_raw', 'the catalogue number as printed — null unless you can point at it'],
  ['label_raw', 'the record label or company as printed, e.g. Deutsche Grammophon'],
  ['name_raw', 'composer and performers as printed, in the order printed, separated by semicolons'],
  ['title_raw', 'the work or works as printed'],
  ['year_raw', 'a year as printed, including any (P) or (C) marker that qualifies it'],
  ['side', 'the side, if printed'],
  ['other_numbers', 'an array of EVERY other number or code visible that you did not assign above'],
  ['unreadable', 'an array naming the fields you left null because the label was illegible there'],
  ['orientation', 'how the writing sat in the frame: upright, left, right, upside-down, or mixed'],
];

/**
 * The orientations a reading may report, and what each means.
 *
 * Asked rather than detected, and asked BEFORE anything is built to fix
 * it. A record label is round and its text runs in arcs, so "which way
 * up" is not obviously a well-formed question — and nobody yet knows
 * whether photographs arrive rotated often enough to matter, or whether
 * a rotated one even reads worse. One field in a reply answers both,
 * and costs nothing.
 *
 * `mixed` is a real answer, not a refusal: a label with its company
 * name curved over the top and the title straight across the middle
 * genuinely has no single orientation.
 */
export const ORIENTATIONS = ['upright', 'left', 'right', 'upside-down', 'mixed'];

/**
 * The clause that keeps an invented value out of the data, kept in its
 * own constant because a test asserts it survives editing. It is the
 * only thing standing between this and a plausible catalogue number
 * recalled from the repertoire rather than read off the disc — and in
 * a chat window there is no strict schema behind it, so the words are
 * the whole guard.
 */
export const NO_INFERENCE = [
  'Report ONLY what is printed in the photographs in front of you.',
  '',
  'Never infer a value from your knowledge of the recording, the',
  'performers, the repertoire or the pressing. If you recognise the',
  'record, that is not evidence about what is printed on it. A value you',
  'supplied from memory rather than from the image is worse than no',
  'value at all, because nothing downstream can tell the two apart.',
].join('\n');

/**
 * The statement of the task, on both paths: pasted into a browser chat
 * above an upload, and embedded verbatim in the pack's own
 * instructions where nothing is uploaded at all. It therefore says
 * nothing about uploading.
 *
 * The id list is included in the text as well as in the filenames.
 * Some chat interfaces do not show a model the filename of an upload,
 * and a prompt that silently depends on one would fail in a way that
 * looks like bad extraction rather than a plumbing fault.
 */
export function chatPrompt(rows) {
  // Accepts either a list of ids or a list of {rowId, photos} — a
  // record is one row however many photographs it took.
  const recs = rows.map((r) => (typeof r === 'string' ? { rowId: r, photos: 1 } : r));
  const images = recs.reduce((n, r) => n + r.photos, 0);
  const many = recs.some((r) => r.photos > 1);

  return [
    images === 1
      ? 'Here is a photograph of a vinyl record.'
      : `Here are ${images} photographs of `
        + `${recs.length === 1 ? 'one vinyl record' : `${recs.length} vinyl records`}.`,
    'Read them and return the printed information as JSON.',
    '',
    ...(many ? [
      // Without this the model returns one object per image, and a
      // record photographed three times becomes three records — the
      // same misattribution the row ids exist to prevent, arriving from
      // the other direction.
      'SEVERAL PHOTOGRAPHS MAY SHOW THE SAME RECORD. Each filename',
      'begins with the record\'s row id: `448-1.jpg` and `448-2.jpg` are',
      'two photographs of record 448 — perhaps its label and its sleeve.',
      '',
      'Return ONE object per RECORD, not one per photograph, combining',
      'what you can read across all of that record\'s photographs. A',
      'value readable on any one of them is readable for that record.',
      '',
    ] : []),
    NO_INFERENCE,
    '',
    'Use null for anything you cannot read directly off the images, and',
    'name that field in `unreadable` if the reason was legibility rather',
    'than the record simply not carrying it.',
    '',
    'Read the record whichever way up it arrives — a rotated photograph',
    `is still readable. Report in \`orientation\` how the writing sat: one of`,
    `${ORIENTATIONS.map((o) => `\`${o}\``).join(', ')}. \`mixed\` is a correct`,
    'answer for a label whose company name curves over the top while the',
    'title runs straight across, which is most of them. This is being',
    'measured, not corrected: say what you saw.',
    '',
    'A record carries many numbers — matrix and stamper codes, side',
    'numbers, opus and K. numbers, timings, (P) and (C) years. Assign one',
    'to `catno_raw` ONLY if it is presented as the catalogue number. Every',
    'other number goes in `other_numbers`, unassigned. Leaving a number',
    'unassigned is a correct answer; guessing which field it belongs to is',
    'not.',
    '',
    `Return a JSON array with one object per record — ${recs.length} in total —`,
    'each having exactly these keys:',
    '',
    ...FIELD_SPEC.map(([k, d]) => `  ${k} — ${d}`),
    '',
    'Report the row id in `row_id`, so a reading can never be attributed',
    'to the wrong record. The records in this batch are:',
    '',
    ...recs.map((r) => (many
      ? `  ${r.rowId} — ${r.photos} photograph${r.photos === 1 ? '' : 's'}`
      : `  ${r.rowId}`)),
    '',
    'Return the JSON array and nothing else.',
  ].join('\n');
}

/**
 * The clause that keeps the measurement honest when the reading happens
 * on this machine rather than in a browser chat.
 *
 * A reader with access to this repository can open the answer sheet
 * whatever this says, so these words are a request and the pipeline
 * does not rely on them: `photo-import` records whether an answer
 * already existed for each row, and `photo-score` holds those rows out
 * of the bar. Its own constant because a test asserts it survives
 * editing, and because it must keep saying that it is only asking.
 */
export const BLIND_READ = [
  'DO NOT LOOK UP THE ANSWER.',
  '',
  'If you can read this repository, you can also read',
  '`data/label-photos/ground-truth.csv`. That file is what a person',
  'typed off these same records — it is the answer sheet, and a reading',
  'produced with it in context measures nothing at all.',
  '',
  'Do not open it. Do not grep for a catalogue number. Do not read',
  '`data/photo-extract.json`, `data/photo-score.md`, or any earlier',
  'reply file: those carry previous readings of these same photographs.',
  '',
  'This is asked of you rather than enforced, so the pipeline does not',
  'rely on it: every import records whether an answer already existed',
  'for that row, and any row whose truth predates its reading is',
  'reported as a non-independent measurement rather than counted as a',
  'pass. Looking does not fake a good result; it only wastes the',
  'photograph.',
].join('\n');

/**
 * The instruction file written at the root of every pack, so the pack
 * can be handed over whole — a directory to point a session at, or a
 * zip for a client that unpacks one — with nothing to paste alongside.
 *
 * It carries `chatPrompt` verbatim rather than paraphrasing it. Two
 * statements of one contract drift, and the one that drifts is always
 * the copy nobody tests.
 */
export function packInstructions(rows, packName, replyPath) {
  const recs = rows.map((r) => (typeof r === 'string' ? { rowId: r, photos: 1 } : r));
  return [
    recs.length === 1
      ? `# ${packName} — read this record`
      : `# ${packName} — read these ${recs.length} records`,
    '',
    'You are looking at photographs of vinyl records — labels, sleeves,',
    'runouts, whatever was to hand. Each filename begins with the row id',
    'of the record it shows.',
    '',
    BLIND_READ,
    '',
    '## What to do',
    '',
    'Read every image in this directory, then write your JSON array to:',
    '',
    `    ${replyPath}`,
    '',
    'Prose and code fences around it are fine — the importer digs the',
    'array out. What it will not do is guess which record an answer',
    'belongs to, so every object needs its `row_id`.',
    '',
    '## The task',
    '',
    chatPrompt(recs),
  ].join('\n');
}

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Pull the JSON array out of a chat reply.
 *
 * Chats wrap answers in prose and fences however firmly you ask them
 * not to, so this is forgiving about the packaging and unforgiving
 * about the contents.
 */
export function parseChatReply(text, expectedIds) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text ?? '');
  let body = (fenced?.[1] ?? text ?? '').trim();
  // Fall back to the outermost bracket pair when there is no fence and
  // the model wrote a sentence before its JSON.
  if (!body.startsWith('[')) {
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('no JSON array found in the reply');
    body = body.slice(start, end + 1);
  }

  let rows;
  try {
    rows = JSON.parse(body);
  } catch (err) {
    throw new Error(`the reply is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!Array.isArray(rows)) throw new Error('the reply is not a JSON array');

  const expected = new Set(expectedIds);
  const seen = new Set();
  const results = {};
  const unknown = [];
  const duplicated = [];

  for (const row of rows) {
    const id = row?.row_id === undefined || row?.row_id === null ? '' : String(row.row_id).trim();
    // No id means no way to know which record this describes. Position
    // is not a fallback: it is exactly what goes wrong here.
    if (!id) { unknown.push('(missing row_id)'); continue; }
    if (!expected.has(id)) { unknown.push(id); continue; }
    if (seen.has(id)) { duplicated.push(id); continue; }
    seen.add(id);
    results[id] = {
      fields: Object.fromEntries(FIELD_SPEC
        .filter(([k]) => k !== 'row_id')
        .map(([k]) => [k, row[k] ?? null])),
    };
  }

  return {
    results,
    unknown,
    duplicated,
    missing: expectedIds.filter((id) => !seen.has(id)),
  };
}

/** Comparison form for one field: catalogue numbers fold harder than prose. */
const comparable = (field, value) =>
  CATNO_FIELDS.has(field) ? compactCatno(value) : compactText(value);

/**
 * Score one extraction against one typed ground truth.
 *
 * Four outcomes per field, and they are NOT collapsible into
 * right/wrong. `refused` and `wrong` cost completely different things,
 * which is the whole question the spike asks.
 */
export function scoreOne(extracted, truth) {
  /** @type {Record<string, string>} */
  const verdicts = {};
  for (const field of PHOTO_FIELDS) {
    const got = extracted?.[field];
    const want = truth?.[field];
    if (blank(want)) verdicts[field] = blank(got) ? 'correctly-absent' : 'invented';
    else if (blank(got)) verdicts[field] = 'refused';
    else verdicts[field] = comparable(field, got) === comparable(field, want) ? 'exact' : 'wrong';
  }
  return verdicts;
}

/**
 * The trap. Ground truth carries the numbers that are on the label but
 * are NOT the catalogue number — matrix, stamper, side. If one of them
 * comes back as `catno_raw`, the model has done precisely what M0
 * caught a human process doing: treated a number as a verdict.
 *
 * Scored separately from `wrong` because it is the failure with a
 * downstream cost — it would be searched against Discogs and could
 * corroborate a wrong release.
 */
export function trapSprung(extracted, truth) {
  const decoys = (truth?.decoy_numbers ?? []).map((n) => compactCatno(n)).filter(Boolean);
  const got = compactCatno(extracted?.catno_raw);
  return Boolean(got) && decoys.includes(got);
}

/**
 * Roll individual verdicts into the report the record asks for.
 *
 * The bar is stated as a comparison rather than a percentage on
 * purpose: "refused must beat wrong" is a comparison, and a single
 * accuracy figure hides it.
 */
export function summarise(rows) {
  const per = {};
  for (const field of PHOTO_FIELDS) {
    per[field] = { exact: 0, wrong: 0, refused: 0, 'correctly-absent': 0, invented: 0 };
  }
  let traps = 0;
  for (const row of rows) {
    for (const [field, verdict] of Object.entries(row.verdicts)) per[field][verdict] += 1;
    if (row.trap) traps += 1;
  }
  const total = (k) => PHOTO_FIELDS.reduce((n, f) => n + per[f][k], 0);
  const wrong = total('wrong') + total('invented');
  const refused = total('refused');
  return {
    photos: rows.length,
    per,
    totals: {
      exact: total('exact'),
      wrong,
      refused,
      correctlyAbsent: total('correctly-absent'),
      trapsSprung: traps,
    },
    // The record's bar, evaluated rather than described.
    //
    // "Refused must beat wrong" is about where the error budget gets
    // spent, so a run that spends nothing — no wrong values and nothing
    // refused — clears it outright. Writing it as `wrong < refused`
    // alone failed a flawless run, because zero does not beat zero.
    passes: traps === 0 && (wrong === 0 || wrong < refused),
  };
}
