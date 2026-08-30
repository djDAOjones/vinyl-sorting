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
  verdict: GateResult['verdict'] | 'rejected';
  reason: string;
  chosenDiscogsId: number | null;
  queriesRun: number;
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
      outcome: { itemId: row.itemId, verdict: 'rejected', reason: sane.reason, chosenDiscogsId: null, queriesRun: 0, candidates: 0 },
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
  for (const q of queries) {
    if (seen.size >= ENOUGH) break;
    queriesRun++;
    let results: SearchResult[];
    try {
      results = await client.search(q.params);
    } catch {
      // A failed rung is not a failed row: try the next one.
      continue;
    }
    for (const r of results) if (r?.id && !seen.has(r.id)) seen.set(r.id, r);
  }

  const scored: Scored[] = [...seen.values()].map((r) => scoreCandidate(capture, r));
  const gate = applyGate(scored);

  return {
    outcome: {
      itemId: row.itemId,
      verdict: gate.verdict,
      reason: gate.reason,
      chosenDiscogsId: gate.verdict === 'verified' ? gate.chosen?.id ?? null : null,
      queriesRun,
      candidates: scored.length,
    },
    gate,
    queries,
  };
}

/** Persist a run: the verdict, the top five candidates and the queries used. */
export async function persistRun(
  env: Env,
  row: MatchRow,
  result: Awaited<ReturnType<typeof matchRow>>,
): Promise<void> {
  const state = result.outcome.verdict === 'verified' ? 'auto-accepted'
    : result.outcome.verdict === 'rejected' ? 'rejected'
      : result.outcome.verdict === 'no_match' ? 'rejected' : 'needs-review';

  let releaseId: number | null = null;
  if (result.outcome.chosenDiscogsId !== null) {
    releaseId = await upsertRelease(env, result.outcome.chosenDiscogsId, result.gate);
  }

  const run = await env.DB.prepare(
    `INSERT INTO match_run (item_id, state, queries_json, chosen_release_id)
     VALUES (?, ?, ?, ?) RETURNING id`,
  ).bind(
    row.itemId, state,
    JSON.stringify({ reason: result.outcome.reason, queries: result.queries }),
    releaseId,
  ).first<{ id: number }>();
  if (!run) throw new Error('match_run insert returned no id');

  const top5 = (result.gate?.ranked ?? []).slice(0, 5);
  if (top5.length) {
    await env.DB.batch(top5.map((c, i) => env.DB.prepare(
      'INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json) VALUES (?, ?, ?, ?, ?)',
    ).bind(run.id, i + 1, c.id, c.score, JSON.stringify({ families: c.families, signals: c.signals }))));
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
  }
}

async function upsertRelease(env: Env, discogsId: number, gate: GateResult | null): Promise<number> {
  const existing = await env.DB.prepare('SELECT id FROM release WHERE discogs_id = ?')
    .bind(discogsId).first<{ id: number }>();
  if (existing) return existing.id;

  const created = await env.DB.prepare('INSERT INTO release (discogs_id) VALUES (?) RETURNING id')
    .bind(discogsId).first<{ id: number }>();
  if (!created) throw new Error('release insert returned no id');
  await env.DB.prepare(
    "INSERT INTO field_source (entity, entity_id, field, source, confidence) VALUES ('release', ?, 'discogs_id', 'discogs', ?)",
  ).bind(created.id, gate?.chosen?.score ?? null).run();
  return created.id;
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
