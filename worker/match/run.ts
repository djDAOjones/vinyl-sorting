/**
 * Running the matcher over one item, and persisting what it did.
 *
 * Every run writes a `match_run` plus up to five `match_candidate`
 * rows carrying the score, the families that agreed and the exact
 * queries used. That persistence is not bookkeeping: it is what makes
 * a wrong match explicable six months later, which is precisely what
 * the old pipeline could not do when 26 of its matches turned out to
 * point at different records.
 *
 * A verified match links the item to a release and writes a
 * `field_source` row — `discogs`, and STILL UNCONFIRMED. The machine
 * does not get to confirm its own work; the review queue is where a
 * person does that, and until then the decision views stay empty.
 */

import type { Env } from '../env.ts';
import type { DiscogsClient, SearchResult } from '../discogs.ts';
import { buildQueries } from './queries.ts';
import { applyGate, scoreCandidate, type Capture, type GateResult, type Scored } from './score.ts';
import { checkRow } from './sanity.ts';

export interface MatchRow {
  itemId: number;
  captureId: number | null;
  catnoRaw?: string | null;
  labelRaw?: string | null;
  titleRaw?: string | null;
  nameRaw?: string | null;
  yearRaw?: string | null;
}

export interface MatchOutcome {
  itemId: number;
  /** `error` when the search never completed — see queryErrors. */
  verdict: GateResult['verdict'] | 'rejected' | 'error';
  reason: string;
  chosenDiscogsId: number | null;
  queriesRun: number;
  queryErrors: number;
  candidates: number;
}

/** Stop early once the field is good enough to clear the gate. */
const ENOUGH = 12;

/**
 * Match one row. Pure of storage: it takes a client and returns what it
 * found, so it can be tested against a scripted Discogs.
 */
export async function matchRow(row: MatchRow, client: DiscogsClient): Promise<{
  outcome: MatchOutcome; gate: GateResult | null; queries: { type: string; params: Record<string, string> }[];
}> {
  // The sanity check runs BEFORE any API call — a junk catalogue string
  // costs no rate limit and reaches the queue honestly labelled.
  const sane = checkRow(row);
  if (!sane.usable) {
    return {
      outcome: {
        itemId: row.itemId, verdict: 'rejected', reason: sane.reason,
        chosenDiscogsId: null, queriesRun: 0, queryErrors: 0, candidates: 0,
      },
      gate: null, queries: [],
    };
  }

  const { variants, queries } = buildQueries(row);
  const capture: Capture = {
    catnoVariants: variants,
    labelRaw: row.labelRaw, titleRaw: row.titleRaw,
    nameRaw: row.nameRaw, yearRaw: row.yearRaw,
  };

  /** Deduplicated by release id — the same release surfaces on several rungs. */
  const seen = new Map<number, SearchResult>();
  let queriesRun = 0;
  let queryErrors = 0;
  let lastError = '';
  for (const q of queries) {
    if (seen.size >= ENOUGH) break;
    queriesRun++;
    let results: SearchResult[];
    try {
      results = await client.search(q.params);
    } catch (err) {
      // A failed rung is not a failed row: try the next one. But the
      // failure is COUNTED, because a row that never reached Discogs
      // has not been searched, and reporting that as "nothing found"
      // would silently mark it unmatched for ever. A rate-limited run
      // did exactly that to 53 rows out of 60.
      queryErrors++;
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }
    for (const r of results) if (r?.id && !seen.has(r.id)) seen.set(r.id, r);
  }

  const scored: Scored[] = [...seen.values()].map((r) => scoreCandidate(capture, r));
  const gate = applyGate(scored);

  // Nothing found AND something went wrong is not a negative result.
  if (scored.length === 0 && queryErrors > 0) {
    return {
      outcome: {
        itemId: row.itemId, verdict: 'error',
        reason: `all ${queryErrors} of ${queriesRun} queries failed; last: ${lastError}`,
        chosenDiscogsId: null, queriesRun, queryErrors, candidates: 0,
      },
      gate: null, queries,
    };
  }

  return {
    outcome: {
      itemId: row.itemId,
      verdict: gate.verdict,
      reason: queryErrors ? `${gate.reason} (${queryErrors} query error(s))` : gate.reason,
      chosenDiscogsId: gate.verdict === 'verified' ? gate.chosen?.id ?? null : null,
      queriesRun,
      queryErrors,
      candidates: scored.length,
    },
    gate,
    queries,
  };
}

/**
 * Persist a run: the verdict, the top five candidates and the queries
 * used. Returns the number of D1 rows written, because rows written is
 * the only metered line the matcher can move far enough to cost money
 * (OPS-SPEND-GUARD) — the caller keeps a per-tick budget against it.
 */
export async function persistRun(
  env: Env,
  row: MatchRow,
  result: Awaited<ReturnType<typeof matchRow>>,
): Promise<number> {
  let written = 0;
  const state = result.outcome.verdict === 'verified' ? 'auto-accepted'
    : result.outcome.verdict === 'error' ? 'error'
      : result.outcome.verdict === 'rejected' ? 'rejected'
        : result.outcome.verdict === 'no_match' ? 'rejected' : 'needs-review';

  let releaseId: number | null = null;
  if (result.outcome.chosenDiscogsId !== null) {
    const up = await upsertRelease(env, result.outcome.chosenDiscogsId, result.gate);
    releaseId = up.id;
    written += up.written;
  }

  const run = await env.DB.prepare(
    `INSERT INTO match_run (item_id, state, queries_json, chosen_release_id)
     VALUES (?, ?, ?, ?) RETURNING id`,
  ).bind(
    row.itemId, state,
    // queriesRun/queryErrors ride in the existing JSON rather than new
    // columns: M2-DISCOGS-PACING has to measure failures PER ROW to
    // pick an interval, and match-report already reads this column
    // with json_extract. No migration, same evidence.
    JSON.stringify({
      reason: result.outcome.reason,
      queries: result.queries,
      queriesRun: result.outcome.queriesRun,
      queryErrors: result.outcome.queryErrors,
    }),
    releaseId,
  ).first<{ id: number }>();
  if (!run) throw new Error('match_run insert returned no id');
  written += 1;

  const top5 = (result.gate?.ranked ?? []).slice(0, 5);
  if (top5.length) {
    await env.DB.batch(top5.map((c, i) => env.DB.prepare(
      'INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json) VALUES (?, ?, ?, ?, ?)',
    ).bind(run.id, i + 1, c.id, c.score, JSON.stringify({ families: c.families, signals: c.signals }))));
    written += top5.length;
  }

  if (releaseId !== null) {
    await env.DB.prepare('UPDATE item SET release_id = ? WHERE id = ?').bind(releaseId, row.itemId).run();
    // `discogs`, and unconfirmed: an auto-accepted match is still the
    // machine's opinion. A person confirms it in the review queue.
    await env.DB.prepare(
      `INSERT INTO field_source (entity, entity_id, field, source, confidence)
       VALUES ('item', ?, 'release_id', 'discogs', ?)
       ON CONFLICT (entity, entity_id, field)
       DO UPDATE SET source = 'discogs', confidence = excluded.confidence,
                     confirmed_by = NULL, confirmed_at = NULL`,
    ).bind(row.itemId, result.gate?.chosen?.score ?? null).run();
    written += 2;
  }

  return written;
}

async function upsertRelease(
  env: Env, discogsId: number, gate: GateResult | null,
): Promise<{ id: number; written: number }> {
  const existing = await env.DB.prepare('SELECT id FROM release WHERE discogs_id = ?')
    .bind(discogsId).first<{ id: number }>();
  if (existing) return { id: existing.id, written: 0 };

  const created = await env.DB.prepare('INSERT INTO release (discogs_id) VALUES (?) RETURNING id')
    .bind(discogsId).first<{ id: number }>();
  if (!created) throw new Error('release insert returned no id');
  await env.DB.prepare(
    "INSERT INTO field_source (entity, entity_id, field, source, confidence) VALUES ('release', ?, 'discogs_id', 'discogs', ?)",
  ).bind(created.id, gate?.chosen?.score ?? null).run();
  return { id: created.id, written: 2 };
}

/** Rows awaiting a first match, oldest first. */
export async function pendingRows(env: Env, limit: number): Promise<MatchRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT i.id AS itemId, c.id AS captureId,
            c.catno_raw AS catnoRaw, c.label_raw AS labelRaw,
            c.title_raw AS titleRaw, c.name_raw AS nameRaw, c.year_raw AS yearRaw
       FROM item i
       LEFT JOIN capture c ON c.item_id = i.id
      WHERE NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id)
      ORDER BY i.id
      LIMIT ?`,
  ).bind(limit).all();
  return results as unknown as MatchRow[];
}
