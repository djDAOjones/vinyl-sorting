/**
 * Collection settings, and getting everything back out (APP-SETTINGS).
 *
 * The maintainer drew the line here on 2026-08-31, having been shown
 * what the page would be sitting on: **settings and export, no
 * destruction.** So this file has exactly two jobs and deliberately
 * lacks a third.
 *
 * WHAT IS NOT HERE, AND WHY IT IS NOT A TODO:
 *
 *  - **No token storage.** A Discogs token typed into a browser has to
 *    be kept where the Worker can read it, which means KV — readable by
 *    anything that gets one shared passphrase, on a URL with no
 *    sign-in. `wrangler secret put` already works and is strictly
 *    better. AGENTS.md's "no secrets in the repo" is the same instinct
 *    one level up.
 *  - **No reset, with or without a 31-day window.** Destructive data
 *    operations are a stop-and-ask boundary in the hard rules. The
 *    capability is wanted and will exist as a tool in `tools/` that
 *    snapshots first — not as a button anybody reaches by mistyping a
 *    URL.
 *  - **No roster editing.** `src/who.ts` is shared by the client and
 *    the Worker precisely so the gate and the sign-in cannot disagree
 *    about who exists.
 *
 * None of those are refusals on the merits. All three want a sign-in
 * first, which is OPEN-V1-AUTH, and the brief already schedules it.
 */

import type { Env } from './env.ts';

const KEY = 'settings:collection';

export interface CollectionSettings {
  /** Re-verify the oldest rows once nothing is unmatched (MATCH-REVERIFY-SWEEP). */
  reverify: boolean;
  /** A row is only re-verifiable once its last verification is this old. */
  reverifyMinDays: number;
  /** Ceiling on rows the sweep may re-queue in a day. */
  reverifyMaxPerDay: number;
}

/**
 * Defaults, and every one of them is a decision.
 *
 * `reverify` is OFF because an unconditional sweep is an infinite loop
 * with a rate limit attached, and because every row it fails to
 * auto-accept lands in the maintainer's own review queue — a sweep that
 * quietly refills a queue somebody is trying to empty is a bug however
 * correct each row is.
 */
export const DEFAULTS: CollectionSettings = {
  reverify: false,
  reverifyMinDays: 180,
  reverifyMaxPerDay: 40,
};

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Parse whatever is in KV into a whole settings object.
 *
 * Every field is defaulted and clamped rather than trusted. KV holds
 * what some earlier version of this code wrote, and a missing key or a
 * half-written object must degrade to the safe configuration — which
 * for the sweep means OFF — instead of throwing on a read the matcher
 * makes every five minutes.
 */
export function parseSettings(raw: unknown): CollectionSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    reverify: o.reverify === true,
    reverifyMinDays: clampInt(o.reverifyMinDays, 1, 3650, DEFAULTS.reverifyMinDays),
    reverifyMaxPerDay: clampInt(o.reverifyMaxPerDay, 0, 500, DEFAULTS.reverifyMaxPerDay),
  };
}

export async function readSettings(env: Env): Promise<CollectionSettings> {
  try {
    const raw = await env.CACHE.get(KEY);
    return parseSettings(raw ? JSON.parse(raw) : {});
  } catch {
    // A KV outage must not stop the matcher; it must only stop the
    // OPTIONAL behaviour, which is what the defaults already say.
    return { ...DEFAULTS };
  }
}

export async function writeSettings(env: Env, patch: unknown): Promise<CollectionSettings> {
  const current = await readSettings(env);
  const merged = parseSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
  await env.CACHE.put(KEY, JSON.stringify(merged));
  return merged;
}

/**
 * The tables an export carries, in dependency order.
 *
 * Named explicitly rather than read from `sqlite_master`: an export is
 * a promise about what a person gets back, and a table added later
 * should have to be added here on purpose. `schema_migration` is
 * included because a dump that cannot say which schema it came from is
 * a dump nobody can safely load.
 */
export const EXPORT_TABLES = [
  'schema_migration', 'item', 'capture', 'item_photo', 'raw_value',
  'release', 'release_track', 'match_run', 'match_candidate',
  'review_decision', 'field_source',
] as const;

const PAGE = 1000;

/**
 * Everything, as one JSON object.
 *
 * Paged per table rather than read in one statement: D1 is not a local
 * SQLite file and a single unbounded SELECT over `match_candidate` —
 * five rows per run, times 484 runs — is the shape that starts failing
 * quietly as the collection grows. Keyset on rowid, which every one of
 * these tables has.
 */
export async function exportJson(env: Env): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    tables: EXPORT_TABLES,
  };
  for (const table of EXPORT_TABLES) {
    const rows: unknown[] = [];
    let after = 0;
    for (;;) {
      const page = await env.DB.prepare(
        `SELECT rowid AS _rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      ).bind(after, PAGE).all();
      if (!page.results.length) break;
      for (const r of page.results) {
        const row = { ...(r as Record<string, unknown>) };
        after = Number(row._rowid);
        delete row._rowid;
        rows.push(row);
      }
      if (page.results.length < PAGE) break;
    }
    out[table] = rows;
  }
  return out;
}

/** RFC 4180: quote everything, double the quotes. Cheap and never wrong. */
const csvCell = (v: unknown): string =>
  `"${String(v ?? '').replace(/"/g, '""')}"`;

export const CSV_COLUMNS = [
  'id', 'crate', 'position', 'catno_raw', 'label_raw', 'name_raw', 'title_raw', 'year_raw',
  'media_grade', 'sleeve_grade', 'decision', 'captured_by', 'captured_at', 'import_ref',
  'last_verified_at', 'discogs_id', 'release_title', 'release_label', 'release_year',
  'photo_count', 'match_state', 'release_confirmed',
] as const;

/**
 * The flattened collection, one row per item.
 *
 * A SPREADSHEET WANTS THIS AND NOT THE JSON. The structured dump is the
 * one that can be restored; this is the one somebody can open, sort and
 * hand to a person — which is most of what "what if this all goes away"
 * actually means. Both are offered because they answer different
 * questions.
 */
export async function exportCsv(env: Env): Promise<string> {
  const lines = [CSV_COLUMNS.join(',')];
  let after = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT i.id, i.crate, i.position, i.media_grade, i.sleeve_grade, i.decision,
              i.captured_by, i.captured_at, i.import_ref, i.last_verified_at,
              c.catno_raw, c.label_raw, c.name_raw, c.title_raw, c.year_raw,
              r.discogs_id, r.title AS release_title, r.label AS release_label,
              r.year AS release_year,
              (SELECT COUNT(*) FROM item_photo p WHERE p.item_id = i.id) AS photo_count,
              (SELECT m.state FROM match_run m WHERE m.item_id = i.id
                ORDER BY m.id DESC LIMIT 1) AS match_state,
              EXISTS (SELECT 1 FROM v_confirmed_field v
                       WHERE v.entity = 'item' AND v.entity_id = i.id
                         AND v.field = 'release_id') AS release_confirmed
         FROM item i
         LEFT JOIN capture c ON c.id = (SELECT id FROM capture
                                         WHERE item_id = i.id
                                         ORDER BY captured_at DESC, id DESC LIMIT 1)
         LEFT JOIN release r ON r.id = i.release_id
        WHERE i.id > ?
        ORDER BY i.id
        LIMIT ?`,
    ).bind(after, PAGE).all();
    if (!results.length) break;
    for (const row of results) {
      const r = row as Record<string, unknown>;
      after = Number(r.id);
      lines.push(CSV_COLUMNS.map((k) => csvCell(r[k])).join(','));
    }
    if (results.length < PAGE) break;
  }
  return `${lines.join('\n')}\n`;
}
