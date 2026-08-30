/**
 * Catalogue normalisation — ported from the Windsurf Python CLI's
 * `normalization.py`, which is proven against this exact data.
 *
 * Three changes from the original, per the REUSE-CLI decision:
 *
 *  1. MacRoman, not cp1252. The original mapped cp1252 glyphs
 *     (`Ê`→space, `Õ`→apostrophe) — a guess M0 disproved from the byte
 *     histogram. Repair happens upstream in the M0 ladder; what remains
 *     here is folding what survives into search-safe ASCII.
 *  2. U+2011 and U+2013 fold to ASCII hyphen. M0 repairs faithfully
 *     rather than normalising, so seven catalogue numbers really do
 *     contain a non-breaking hyphen (`TWO‑269`, `CFP‑160`). Without
 *     this fold they silently fail every exact-match step.
 *  3. The variants feed a corroboration gate rather than a verdict.
 *
 * The output is an ordered, unique list of variants. Order matters:
 * the first is the most literal reading, and the query ladder spends
 * its rate-limit budget in that order.
 */

/** Format descriptors and parentheticals that are not part of a catalogue number. */
const NOISE = [
  /\b(mono|stereo|st[ée]r[ée]o|lp|album|set|reissue|repress)\b/gi,
  /\([^)]*\)/g,
];

const SEPARATOR_RUN = /[._\-‐-―]+/g;
const WHITESPACE_RUN = /\s+/g;

/**
 * Fold to ASCII. Dashes first and explicitly: stripping accents via NFKD
 * leaves U+2011 untouched, and an unfolded dash is invisible in a diff
 * and fatal to an exact match.
 */
function asciiSafe(value: string): string {
  return value
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .normalize('NFKD')
    // Combining marks, then anything still outside ASCII.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '');
}

function addVariant(store: string[], value: string): void {
  const v = value.trim();
  if (v && !store.includes(v)) store.push(v);
}

/**
 * Drop leading tokens with no digits, so `Philips 6308 177` also tries
 * `6308 177`. A label prefix is a lead, not part of the number.
 */
function trimBeforeFirstDigits(value: string): string {
  const tokens = value.split(' ');
  const i = tokens.findIndex((t) => /\d/.test(t));
  if (i <= 0) return '';
  const trimmed = tokens.slice(i).join(' ');
  return trimmed === value ? '' : trimmed;
}

function generateVariants(text: string): string[] {
  const out: string[] = [];
  const spaced = text.replace(WHITESPACE_RUN, ' ').trim();
  addVariant(out, spaced);
  addVariant(out, spaced.replace(SEPARATOR_RUN, '-').replace(WHITESPACE_RUN, ' '));
  addVariant(out, spaced.replace(/[^\w/]/g, ''));

  const slashSplit = spaced.split('/').map((p) => p.trim()).filter(Boolean).join('/');
  if (slashSplit && slashSplit !== spaced) addVariant(out, slashSplit);

  const digitTrim = trimBeforeFirstDigits(spaced);
  if (digitTrim) addVariant(out, digitTrim);

  // Separate a letter prefix from its digits. The ported ladder only
  // ever removed separators, never introduced them, so a catalogue
  // number typed without a space produced exactly one variant and
  // Discogs was asked one question. Measured against the live API:
  // `RDS9451` returns nothing, `RDS 9451` returns the record. That gap
  // accounted for most of a 53-out-of-60 no-match run.
  const split = /^([A-Z]+)[\s-]*(\d[\dA-Z\s/-]*)$/.exec(spaced);
  if (split?.[1] && split[2]) {
    const [, letters, digits] = split;
    addVariant(out, `${letters} ${digits.trim()}`);
    addVariant(out, `${letters}-${digits.trim()}`);
  }
  return out;
}

/**
 * Split multi-catalogue strings. Fragments with no digit are dropped:
 * they are label words (`COLUMBIA`, `MONO`), and searching Discogs for
 * a bare label word is how four records all matched one release.
 */
function splitFragments(value: string): string[] {
  return value
    .replace(/[()[\]]/g, ' ')
    .split(/[;/,:]/)
    .map((p) => p.trim())
    .filter((p) => p && /\d/.test(p));
}

/** Ordered, unique catalogue variants to search on. Empty means "do not search". */
export function normaliseCatno(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = asciiSafe(raw);
  if (!cleaned.trim()) return [];

  let text = cleaned;
  for (const pattern of NOISE) text = text.replace(pattern, ' ');
  text = text.trim().toUpperCase();
  if (!text) return [];

  const variants: string[] = [];
  for (const v of generateVariants(text)) addVariant(variants, v);
  // Split the NOISE-STRIPPED text, not the raw input: splitting the raw
  // string re-admits the `(UK) stereo` the base path just removed.
  for (const fragment of splitFragments(text)) {
    for (const v of generateVariants(fragment)) addVariant(variants, v);
  }

  // A catalogue number has a digit. Without this, `Columbia / CBS`
  // yields `COLUMBIA/CBS` as a variant, and searching Discogs for a
  // bare label word is how four records all matched one release.
  return variants.filter((v) => /\d/.test(v));
}

/** Comparison form for equality tests: alphanumerics only, uppercased. */
export const compactCatno = (value: string | null | undefined): string =>
  (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Loose comparison form for titles and names. */
export const compactText = (value: string | null | undefined): string =>
  asciiSafe(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
