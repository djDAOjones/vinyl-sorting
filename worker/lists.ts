import type { Env } from './env.ts';
import { cleanLabel, isListKey, slugOf } from '../src/lists.ts';

/**
 * The lists, as data (NEILS-LIST).
 *
 * The `list` table is the authority. Every route that takes a list —
 * a capture, an edit, a `?list=` scope — reads the keys from here and
 * validates against them, so a list added a minute ago is accepted a
 * minute ago. It is five rows and one indexed read; nothing is cached,
 * because a stale allow-list is exactly the failure this file replaces.
 */
export interface ListRow { key: string; label: string; position: number }

export async function allLists(env: Env): Promise<ListRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT key, label, position FROM list ORDER BY position, key').all();
  return results as unknown as ListRow[];
}

export const keysOf = (lists: readonly ListRow[]): string[] => lists.map((l) => l.key);

/** The refusal, worded once, for every route that takes a list. */
export const listError = (keys: readonly string[]): string =>
  `list must be one of ${keys.join(', ')}, or unsorted`;

export interface NewList { label: string; key: string }

/**
 * A new list, from what a person typed.
 *
 * The key is DERIVED from the label rather than asked for: it is a URL
 * and column value nobody should have to think about, and letting it be
 * typed would make "Neils" and "neils" two lists. A label that leaves
 * nothing usable — punctuation, or a reserved word like "all" — is
 * refused with the reason.
 */
export function parseNewList(body: unknown): { ok: true; value: NewList } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' };
  const label = cleanLabel((body as Record<string, unknown>).label);
  if (!label) return { ok: false, error: 'label must be 1 to 40 characters' };
  const key = slugOf(label);
  if (!key || !isListKey(key)) {
    return { ok: false, error: `"${label}" leaves no usable key — it needs at least one letter and cannot be a reserved word` };
  }
  return { ok: true, value: { label, key } };
}

/**
 * Add a list. Returns the row, or `'exists'` when the key or the label
 * is already taken — matched case-insensitively on the label, so a
 * second "dance" does not sit beside "Dance".
 */
export async function addList(env: Env, input: NewList, createdBy: string | null): Promise<ListRow | 'exists'> {
  const taken = await env.DB.prepare(
    'SELECT key FROM list WHERE key = ? OR lower(label) = lower(?)').bind(input.key, input.label).first();
  if (taken) return 'exists';
  const next = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM list').first<{ n: number }>();
  const position = next?.n ?? 1;
  await env.DB.prepare('INSERT INTO list (key, label, position, created_by) VALUES (?, ?, ?, ?)')
    .bind(input.key, input.label, position, createdBy).run();
  return { key: input.key, label: input.label, position };
}
