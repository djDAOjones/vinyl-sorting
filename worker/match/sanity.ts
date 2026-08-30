/**
 * The input sanity check — one of the three changes from the ported
 * CLI, and it matters as much as the corroboration gate.
 *
 * Junk catalogue strings are rejected BEFORE any API call. `RD ?` is
 * not a catalogue number; searching for it returns whatever Discogs
 * feels like, and that is how four different records all matched one
 * release with nothing to separate them. A row rejected here costs no
 * rate limit and reaches the review queue honestly labelled.
 */

import { compactCatno } from './normalise.ts';

export interface SanityVerdict {
  usable: boolean;
  reason: string;
}

/** Words that are a format or a placeholder, never an identifier. */
const NON_IDENTIFIERS = new Set([
  'NA', 'NONE', 'UNKNOWN', 'NOCAT', 'NOCATNO', 'TBC', 'TBD',
  'MONO', 'STEREO', 'LP', 'EP', 'ALBUM', 'SET', 'VARIOUS', 'MISC',
]);

/**
 * A catalogue number is searchable when it has a digit, enough
 * substance to discriminate, and no unresolved placeholder marks.
 */
export function checkCatno(raw: string | null | undefined): SanityVerdict {
  const value = (raw ?? '').trim();
  if (!value) return { usable: false, reason: 'no catalogue number' };

  // A question mark means the person who typed it was unsure. Searching
  // an uncertain identifier produces a confident wrong answer.
  if (/[?]/.test(value)) return { usable: false, reason: 'contains a question mark — uncertain input' };

  const compact = compactCatno(value);
  if (!compact) return { usable: false, reason: 'no alphanumeric content' };
  if (NON_IDENTIFIERS.has(compact)) return { usable: false, reason: `placeholder, not an identifier: ${value}` };
  if (!/\d/.test(compact)) return { usable: false, reason: 'no digits — a label word, not a catalogue number' };

  // Two characters cannot discriminate between pressings; Discogs will
  // return thousands of hits and the top one will be arbitrary.
  if (compact.length < 3) return { usable: false, reason: `too short to discriminate: ${value}` };

  // A bare number under three digits is likewise everyone's catalogue
  // number. `4042` is fine; `42` is not.
  if (/^\d+$/.test(compact) && compact.length < 3) {
    return { usable: false, reason: `bare number too short: ${value}` };
  }
  return { usable: true, reason: 'searchable' };
}

/**
 * Whether a row has enough to attempt matching at all. A row with no
 * usable catalogue number can still be matched on title plus a name,
 * but a row with neither is capture work, not matching work.
 */
export function checkRow(row: {
  catnoRaw?: string | null; labelRaw?: string | null;
  titleRaw?: string | null; nameRaw?: string | null;
}): SanityVerdict {
  const catno = checkCatno(row.catnoRaw);
  if (catno.usable) return { usable: true, reason: 'catalogue number searchable' };

  const title = (row.titleRaw ?? '').trim();
  const name = (row.nameRaw ?? '').trim();
  if (title && (name || (row.labelRaw ?? '').trim())) {
    return { usable: true, reason: `no usable catalogue number (${catno.reason}); title plus a second signal` };
  }
  return { usable: false, reason: `not searchable: ${catno.reason}, and no title with a corroborating signal` };
}
