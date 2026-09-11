/**
 * The lists (FOUR-LISTS, then NEILS-LIST).
 *
 * They started as four words in a CHECK constraint. The first request
 * after that shipped was for a fifth — a tester's own list — and the
 * archive's crate labels run to thirty, so a list is something this
 * household names as it goes. Every new one being a migration is the
 * wrong shape for that. Lists are DATA now: the `list` table is the
 * authority, the Worker validates against it, and a new one is a row
 * (`POST /api/lists`, behind the passphrase) rather than a release.
 *
 * What stays in code is the SHAPE of a key, and the set migration 006
 * seeds — which the client keeps as its offline fallback. A phone in a
 * loft with no signal still has to file a disc on a list, so it uses
 * the lists it last saw, and these until it has seen any.
 *
 * `selling` is where a disc is FILED, which is a different fact from
 * `item.decision` — what a listening session decided about it (M5).
 */
export interface ListDef { key: string; label: string }

/** What migration 006 seeds, in order. A fallback on the client, never the authority. */
export const BUILT_IN: readonly ListDef[] = [
  { key: 'classical', label: 'Classical' },
  { key: 'selling', label: 'Selling' },
  { key: 'dance', label: 'Dance' },
  { key: 'general', label: 'General' },
  { key: 'neils', label: "Neil's" },
];

export const BUILT_IN_KEYS: readonly string[] = BUILT_IN.map((l) => l.key);

/**
 * What a screen may be looking at: a list's key, the rows on none yet
 * (`unsorted`), or everything (`''`). The two words are reserved, so no
 * list can take them as a key.
 */
export type ListChoice = string;
export const RESERVED = new Set(['', 'unsorted', 'all']);

/** A key: lower case, starts with a letter, at most 40 of [a-z0-9-], not a reserved word. */
export const KEY_SHAPE = /^[a-z][a-z0-9-]{0,39}$/;
export const isListKey = (v: unknown): v is string =>
  typeof v === 'string' && KEY_SHAPE.test(v) && !RESERVED.has(v);

/** A label is what a person calls the list: 1–40 characters, whitespace folded. */
export const LABEL_MAX = 40;
export function cleanLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length >= 1 && t.length <= LABEL_MAX ? t : null;
}

/**
 * The key a label gets: "Neil's" → `neils`, "Hard House (sell)" →
 * `hard-house-sell`. Null when nothing usable survives — a label of
 * punctuation, or a reserved word.
 */
export function slugOf(label: string): string | null {
  const s = label.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // accents, once decomposed
    .replace(/['\u2019]/g, '')          // an apostrophe joins: Neil's → neils
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '')
    .slice(0, 40).replace(/-+$/, '');
  return isListKey(s) ? s : null;
}

/** The label for a key, given the lists in force; the key itself when unknown. */
export const labelFor = (key: string, lists: readonly ListDef[]): string =>
  lists.find((l) => l.key === key)?.label ?? key;

/** The label for a choice, including the two that are not lists. */
export const choiceLabelFor = (c: ListChoice, lists: readonly ListDef[]): string =>
  (c === '' ? 'All lists' : c === 'unsorted' ? 'Unsorted' : labelFor(c, lists));
