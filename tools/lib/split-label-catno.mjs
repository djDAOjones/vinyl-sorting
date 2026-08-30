// @ts-check

/**
 * split-label-catno.mjs — M0-SPLIT-LABEL-CATNO.
 *
 * Label is populated on 0 of the 141 backlog rows because it was
 * mashed into one free-text field with the catalogue number. Splitting
 * it out is what makes M2's corroboration gate possible: the label is
 * the second signal family that would have refused the 26 bad matches.
 *
 * THE GOVERNING RULE (from the record): a wrong label is worse than an
 * absent one, because a wrong label corroborates a wrong match. So this
 * splitter refuses rather than guesses, and every refusal is counted
 * with its reason so the reconciliation report can state them.
 *
 * Labels are not invented. The gazetteer is built from the 277 rows of
 * `Classical Master` where Discogs already supplied a separate Label —
 * so a label is only ever recognised because it is attested in this
 * collection's own data.
 */

/** Trailing annotations that qualify a pressing rather than name it. */
const QUALIFIER = /^(?:[A-Z]{2}|UK|US|USA|NL|GER?|CZ|USSR|FR|IT|SP|SW|JP|CAN|AUS|mono|stereo|est\.?|reissue|repress|\d+\s*[x×]\s*LP|\d+LP|\d+|UK\s+mono|UK\s+stereo|mono\s+only)$/i;

/**
 * A well-formed catalogue number: uppercase/digit tokens, optionally
 * separated by spaces, dots, slashes or hyphens. Deliberately refuses
 * anything containing a lowercase word — that is a label fragment, and
 * swallowing it into the catalogue number is the failure this item
 * exists to prevent.
 */
const CATNO = /^[A-Z0-9][A-Z0-9]*(?:[\s./‐-―-]+[A-Z0-9]+)*$/;

/** Discogs disambiguates same-named labels with a trailing "(n)". */
const stripDisambiguation = (/** @type {string} */ s) => s.replace(/\s*\(\d+\)\s*$/, '').trim();

/**
 * @param {Iterable<string>} labels raw Label values from the enriched rows
 * @returns {string[]} longest first, so sub-labels win over their parents
 */
export function buildGazetteer(labels) {
  const set = new Set();
  for (const raw of labels) {
    const clean = stripDisambiguation(raw ?? '');
    // Two-character "labels" like PS are indistinguishable from
    // catalogue prefixes (PS 287, PS5032) and would split real
    // catalogue numbers in half.
    if (clean.length >= 3) set.add(clean);
  }
  return [...set].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @typedef {object} Split
 * @property {string} combinedRaw the repaired input, kept verbatim so a
 *   refusal never loses data and a later pass can re-split it
 * @property {string} catnoRaw
 * @property {string} labelRaw   empty when no label could be established
 * @property {string} qualifierRaw
 * @property {'split'|'bare-catno'|'refused'} outcome
 * @property {string} reason
 */

/**
 * @param {string} input a repaired combined label/catalogue string
 * @param {string[]} gazetteer from buildGazetteer, longest first
 * @returns {Split}
 */
export function splitLabelCatno(input, gazetteer) {
  const s = (input ?? '').trim();
  const none = (/** @type {string} */ reason, /** @type {string} */ catno = s, /** @type {string} */ qual = '') =>
    ({ combinedRaw: s, catnoRaw: catno, labelRaw: '', qualifierRaw: qual, outcome: /** @type {const} */ ('refused'), reason });

  if (!s) return { combinedRaw: '', catnoRaw: '', labelRaw: '', qualifierRaw: '', outcome: 'refused', reason: 'empty' };

  // Two pressings in one cell. Splitting would attach one record's
  // label to the other's catalogue number.
  if (/[;]|\s\/\s|\bCat\.|\[/.test(s)) return none('multiple-issues');

  // Peel trailing parentheticals right to left.
  let body = s;
  /** @type {string[]} */ const quals = [];
  /** @type {string} */ let parentheticalLabel = '';
  for (;;) {
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(body);
    if (!m) break;
    const inner = m[2].trim();
    const head = inner.split(',')[0].trim();
    const hit = gazetteer.find((g) => g.toLowerCase() === head.toLowerCase());
    if (hit) parentheticalLabel = hit;          // "TWO-269 (EMI, Barbirolli)"
    else if (QUALIFIER.test(inner)) quals.unshift(inner);
    else return none('unrecognised-parenthetical');
    body = m[1].trim();
  }
  const qualifierRaw = quals.join('; ');

  // Shape: CATNO (Label, performer) — the load-file convention.
  if (parentheticalLabel) {
    return CATNO.test(body)
      ? { combinedRaw: s, catnoRaw: body, labelRaw: parentheticalLabel, qualifierRaw, outcome: 'split', reason: 'label-in-parenthetical' }
      : none('parenthetical-label-but-unclear-catno', body, qualifierRaw);
  }

  // Shape: Label CATNO — longest attested label first, so "EMI Eminence"
  // beats "EMI" and the sub-label is not silently dropped.
  for (const label of gazetteer) {
    const m = new RegExp(`^${esc(label)}\\b\\s*(.*)$`, 'i').exec(body);
    if (!m) continue;
    const rest = m[1].trim();
    if (!rest) return none('label-with-no-catalogue-number', body, qualifierRaw);
    // A lowercase word in the remainder means an unattested sub-label
    // ("Decca Ace of Diamonds SDD 538"). Refuse: keeping only "Decca"
    // would be a label the pressing does not actually carry.
    if (!CATNO.test(rest)) return none('unattested-sub-label', body, qualifierRaw);
    return { combinedRaw: s, catnoRaw: rest, labelRaw: label, qualifierRaw, outcome: 'split', reason: 'gazetteer-prefix' };
  }

  // No label present at all — a bare catalogue number off the spine.
  // This is not a refusal: the value is complete, the label is simply
  // absent, and M2 will have to corroborate without it.
  if (CATNO.test(body)) {
    return { combinedRaw: s, catnoRaw: body, labelRaw: '', qualifierRaw, outcome: 'bare-catno', reason: 'no-label-present' };
  }
  // A label-shaped prefix that this collection has never attested
  // ("Urania URLP 899", "Melodiya D 04406"). Recognising it would mean
  // inventing a label, which is the one thing this splitter must not do.
  return none('no-attested-label', body, qualifierRaw);
}
