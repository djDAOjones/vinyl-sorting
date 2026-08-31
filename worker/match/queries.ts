/**
 * The query ladder — ported from the CLI's `search_orchestrator.py`.
 *
 * Ordered by how much a hit would tell us, because the ladder spends a
 * shared 50/min budget: structured `catno` and `label`+`catno` first,
 * free-text last. Callers stop as soon as the gate is satisfied.
 *
 * Every query is BUILT HERE from stored capture values. Nothing in a
 * request reaches Discogs — with no sign-in there is no caller to trust
 * (OPEN-USERS-ACCESS), so matching runs from a cron trigger and the
 * query set is a pure function of the row.
 */

import { normaliseCatno } from './normalise.ts';

export interface QuerySpec {
  type: 'catno' | 'label_catno' | 'label_title' | 'title_artist' | 'title' | 'q';
  params: Record<string, string>;
}

export interface QueryInput {
  catnoRaw?: string | null;
  labelRaw?: string | null;
  titleRaw?: string | null;
  nameRaw?: string | null;
  /**
   * Every OTHER number the reading could see, newline-separated.
   *
   * A label often prints several — a mono number beside a stereo one,
   * an export number beside the domestic one — and the reading picks
   * one as primary. When it picks wrong, the right answer is sitting
   * in here unused: item 480 carries `SUA 10639 Mono` behind the
   * stereo number, item 469 carries `642 273 GL` behind `GL5840`
   * (MATCH-OTHER-NUMBERS).
   */
  otherNumbers?: string | null;
}

/** How many catalogue variants to spend queries on before moving on. */
const MAX_CATNO_VARIANTS = 4;

/**
 * Split a reading's `other_numbers` into catalogue variants.
 *
 * Newline OR pipe separated, because the promote step joins with one
 * and a person correcting the field by hand will reach for the other.
 */
export function otherCatnoVariants(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/[\n|]/)) {
    for (const v of normaliseCatno(part)) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The ladder, in two halves.
 *
 * `queries` is the ordinary ladder. `fallback` is built from the OTHER
 * numbers on the label and is deliberately kept separate rather than
 * appended: it must only be spent on a row the primary number failed
 * to place, which is the population that currently ends as "not found"
 * and therefore costs nothing that is not already lost.
 */
export function buildQueries(row: QueryInput): {
  variants: string[]; queries: QuerySpec[]; fallback: QuerySpec[];
} {
  const variants = normaliseCatno(row.catnoRaw);
  const label = (row.labelRaw ?? '').trim();
  const title = (row.titleRaw ?? '').trim();
  const name = (row.nameRaw ?? '').trim();
  const queries: QuerySpec[] = [];
  const seen = new Set<string>();

  const add = (spec: QuerySpec): void => {
    const key = `${spec.type}:${JSON.stringify(spec.params)}`;
    if (!seen.has(key)) { seen.add(key); queries.push(spec); }
  };

  const top = variants.slice(0, MAX_CATNO_VARIANTS);

  // Label + catalogue first: it is the only rung that can satisfy the
  // corroboration gate on its own, because it carries two families.
  if (label) for (const catno of top) add({ type: 'label_catno', params: { label, catno } });
  for (const catno of top) add({ type: 'catno', params: { catno } });

  if (label && title) add({ type: 'label_title', params: { label, title } });
  if (title && name) add({ type: 'title_artist', params: { title, artist: name } });
  if (title) add({ type: 'title', params: { title } });

  // Free text last: broadest recall, weakest precision.
  if (top[0]) add({ type: 'q', params: { q: label ? `${label} ${top[0]}` : top[0] } });

  /**
   * The other numbers, as their own ladder.
   *
   * Same shape as the rungs above and the same dedup set, so a number
   * that already appears as a primary variant does not buy a second
   * query. Label + catno first here too, for the same reason: it is
   * the only rung that can carry two families on its own.
   */
  const fallback: QuerySpec[] = [];
  const addFallback = (spec: QuerySpec): void => {
    const key = `${spec.type}:${JSON.stringify(spec.params)}`;
    if (!seen.has(key)) { seen.add(key); fallback.push(spec); }
  };
  const others = otherCatnoVariants(row.otherNumbers)
    .filter((v) => !variants.includes(v))
    .slice(0, MAX_CATNO_VARIANTS);
  for (const catno of others) {
    if (label) addFallback({ type: 'label_catno', params: { label, catno } });
    addFallback({ type: 'catno', params: { catno } });
  }

  // The alternatives join the SCORING variants unconditionally, even
  // though their queries are held back. A candidate the primary ladder
  // already found may match on an alternative number, and refusing to
  // notice that would be throwing away a hit already paid for.
  //
  // They are variants rather than a new family ON PURPOSE: two numbers
  // printed on one label are one label. Counting them as two families
  // would let a row satisfy the corroboration gate against itself,
  // which is the exact fault the gate exists to prevent.
  return { variants: [...variants, ...others], queries, fallback };
}
