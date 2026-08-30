// @ts-check

/**
 * photo-fields.mjs — SPIKE-PHOTO-TO-FIELDS.
 *
 * The extraction contract and the scorer, with no I/O and no network,
 * so the measurement can be tested without spending anything.
 *
 * THE GOVERNING RULE, inherited from split-label-catno: a wrong value
 * is worse than an absent one, so the contract refuses rather than
 * guesses and every refusal is counted separately. A blank catalogue
 * number costs one re-read. A confident wrong one is the 9% error M0
 * measured — 26 of 277 rows pointing at a different record, 16 of them
 * labelled "Exact" — recreated by a new route.
 *
 * Two design moves carry that rule:
 *
 *  1. `other_numbers` exists so a number the model can SEE but cannot
 *     ASSIGN has somewhere to go that is not `catno_raw`. A classical
 *     label is littered with numbers — matrix and stamper codes, side
 *     numbers, opus and K. numbers, timings, (P) and (C) years. Picking
 *     the wrong one is a field-assignment failure, not a legibility
 *     failure, and it is the failure that matters here.
 *  2. The prompt forbids inference from knowledge of the recording.
 *     The model knows the repertoire, so it could confabulate a
 *     plausible catalogue number for a famous Karajan Beethoven
 *     without reading one. That would be an AI-invented value sitting
 *     indistinguishably beside a sourced one — the exact fault the
 *     brief says nine schema generations were spent undoing.
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
 * The tool the model is forced to call. `strict: true` with
 * `additionalProperties: false` means the API validates the shape, so
 * the harness never parses a half-formed object.
 */
export const EXTRACTION_TOOL = {
  name: 'record_label',
  description: 'Report only what is printed on this record label.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      catno_raw: {
        type: ['string', 'null'],
        description:
          'The catalogue number as printed. Null unless you can point at it on the label.',
      },
      label_raw: {
        type: ['string', 'null'],
        description: 'The record label or company name as printed, e.g. Deutsche Grammophon.',
      },
      name_raw: {
        type: ['string', 'null'],
        description:
          'Composer and performers as printed, in the order printed, separated by semicolons.',
      },
      title_raw: {
        type: ['string', 'null'],
        description: 'The work or works as printed.',
      },
      year_raw: {
        type: ['string', 'null'],
        description: 'A year as printed, including any (P) or (C) marker that qualifies it.',
      },
      side: { type: ['string', 'null'], description: 'The side, if printed.' },
      other_numbers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'EVERY other number or code visible on the label that you did not assign to a field above. Put a number here rather than guessing which field it belongs to.',
      },
      unreadable: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Names of fields above you left null because the label was illegible there, as opposed to the label not carrying that information.',
      },
    },
    required: [
      'catno_raw', 'label_raw', 'name_raw', 'title_raw',
      'year_raw', 'side', 'other_numbers', 'unreadable',
    ],
  },
};

/**
 * The system prompt. Kept in one exported constant because a test
 * asserts the no-inference clause survives editing: it is the only
 * thing standing between this tool and an invented catalogue number,
 * and it is one careless rewrite away from being lost.
 */
export const SYSTEM_PROMPT = [
  'You are reading the centre label of a vinyl record, photographed on a phone.',
  '',
  'Report ONLY what is printed on the label in front of you.',
  '',
  'Never infer a value from your knowledge of the recording, the',
  'performers, the repertoire or the pressing. If you recognise the',
  'record, that is not evidence about what this label says. A value you',
  'supplied from memory rather than from the image is worse than no',
  'value at all, because nothing downstream can tell the two apart.',
  '',
  'Use null for anything you cannot read directly off the image, and',
  'name that field in `unreadable` if the reason was legibility rather',
  'than the label simply not carrying it.',
  '',
  'A record label carries many numbers. Assign one to `catno_raw` only',
  'if it is presented as the catalogue number. Every other number goes',
  'in `other_numbers`, unassigned. Leaving a number unassigned is a',
  'correct answer; guessing which field it belongs to is not.',
].join('\n');

/** The request body for one photo. Pure, so a test can inspect it. */
export function buildRequest({ model, base64, mediaType = 'image/jpeg', effort = 'low' }) {
  return {
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: { effort },
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{
      role: 'user',
      // Image before text: the docs are explicit that Claude works best
      // with the image first.
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Read this record label.' },
      ],
    }],
  };
}

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

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
 * The bar is stated as a ratio rather than a percentage on purpose:
 * "refused must beat wrong" is a comparison, and a single accuracy
 * figure hides it.
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

/**
 * What the run cost, from the usage the API actually reported, and what
 * the whole collection would cost at that rate.
 *
 * Priced from reported usage rather than from the token estimate in the
 * record, so the spike can correct its own arithmetic.
 */
export const PRICES = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

export function costOf(usages, model, collectionSize = 750) {
  const price = PRICES[model];
  if (!price) return null;
  const inTok = usages.reduce((n, u) => n + (u?.input_tokens ?? 0), 0);
  const outTok = usages.reduce((n, u) => n + (u?.output_tokens ?? 0), 0);
  const spent = (inTok * price.in + outTok * price.out) / 1e6;
  const perPhoto = usages.length ? spent / usages.length : 0;
  return {
    model, photos: usages.length, inputTokens: inTok, outputTokens: outTok,
    spentUsd: spent, perPhotoUsd: perPhoto,
    collectionUsd: perPhoto * collectionSize,
    collectionBatchedUsd: (perPhoto * collectionSize) / 2,
  };
}
