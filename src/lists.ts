/**
 * The four lists (FOUR-LISTS).
 *
 * Shared by the client and the Worker on purpose, the way the roster
 * in `who.ts` is: one set of names, so the selector on the screen and
 * the check the Worker enforces cannot disagree about what a list is
 * called. `schema/005-lists.sql` carries the same four words in its
 * CHECK, and a test holds the two copies together.
 *
 * They are LISTS, not genres. Three of them are genres of a sort and
 * the fourth — selling — is a pile, and the word that covers all four
 * is the one the maintainer used: "the classical, selling, dance and
 * general lists". A disc is on exactly one at a time, or on none yet.
 *
 * `selling` is where a disc is FILED, which is a different fact from
 * `item.decision` — what a listening session decided about it (M5).
 * A record can sit on the classical list with a decision of sell until
 * somebody physically moves it; the two columns say two things.
 */
export const LISTS = ['classical', 'selling', 'dance', 'general'] as const;

export type List = (typeof LISTS)[number];

export const LIST_LABEL: Record<List, string> = {
  classical: 'Classical',
  selling: 'Selling',
  dance: 'Dance',
  general: 'General',
};

export const isList = (v: unknown): v is List =>
  typeof v === 'string' && (LISTS as readonly string[]).includes(v);

/**
 * What a screen may be looking at: one list, the rows on none yet
 * (`unsorted`), or everything (`''`).
 */
export type ListChoice = List | 'unsorted' | '';

export const isListChoice = (v: unknown): v is ListChoice =>
  v === '' || v === 'unsorted' || isList(v);

/** The label for a choice, including the two that are not lists. */
export const choiceLabel = (c: ListChoice): string =>
  (c === '' ? 'All lists' : c === 'unsorted' ? 'Unsorted' : LIST_LABEL[c]);

/** The refusal, worded once, for every route that takes `?list=`. */
export const LIST_ERROR = `list must be one of ${LISTS.join(', ')}, or unsorted`;
