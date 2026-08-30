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
}

/** How many catalogue variants to spend queries on before moving on. */
const MAX_CATNO_VARIANTS = 4;

export function buildQueries(row: QueryInput): { variants: string[]; queries: QuerySpec[] } {
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

  return { variants, queries };
}
