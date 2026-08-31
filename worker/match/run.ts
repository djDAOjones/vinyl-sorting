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
/** A tracklist as Discogs returns it, flattened to what the schema keeps. */
export interface TrackRow { position: string | null; title: string | null; durationS: number | null }

/**
 * Seconds from Discogs' "m:ss" (or "h:mm:ss"). Null rather than zero
 * for anything unparseable: a duration of zero is a claim, and an
 * absent one is the truth about a release that did not print it.
 */
export function parseDuration(raw: unknown): number | null {
  const parts = String(raw ?? '').trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const secs = nums.reduce((acc, n) => acc * 60 + n, 0);
  return secs > 0 ? secs : null;
}

/**
 * The tracklist for a chosen release.
 *
 * ONE request, and only for a release we are about to store. The
 * maintainer's point (2026-08-31): a tracklist is what says which
 * pressing a record actually is, and `release_track` has held zero rows
 * since M1 because this call was never made. Against a ladder already
 * spending 9-12 requests a row, one more for an accepted match is noise.
 *
 * A failure here is not a failed match. The verdict was reached on the
 * search rungs and stands; the tracklist is enrichment, and returning
 * an empty list loses nothing that was ever had.
 */
export async function fetchTracks(client: DiscogsClient, discogsId: number): Promise<TrackRow[]> {
  if (client.budgetSpent?.()) return [];
  try {
    const rel = await client.getRelease(discogsId) as { tracklist?: unknown[] };
    return (rel.tracklist ?? []).map((t) => {
      const tr = t as Record<string, unknown>;
      return {
        position: (tr.position ?? null) as string | null,
        title: (tr.title ?? null) as string | null,
        durationS: parseDuration(tr.duration),
      };
    }).filter((t) => t.title);
  } catch {
    return [];
  }
}

export async function matchRow(row: MatchRow, client: DiscogsClient): Promise<{
  outcome: MatchOutcome; gate: GateResult | null;
  queries: { type: string; params: Record<string, string> }[];
  tracks: TrackRow[];
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
      gate: null, queries: [], tracks: [],
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
  let budgetStopped = false;
  for (const q of queries) {
    if (seen.size >= ENOUGH) break;
    // Stop before spending Cloudflare's per-invocation subrequest cap.
    // A row that stops here keeps whatever it found and is recorded
    // honestly; a row that hits the cap kills the invocation and loses
    // every row in the tick with it.
    if (client.budgetSpent?.()) { budgetStopped = true; break; }
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
  if (scored.length === 0 && (queryErrors > 0 || budgetStopped)) {
    return {
      outcome: {
        itemId: row.itemId, verdict: 'error',
        reason: budgetStopped && queryErrors === 0
          ? `stopped after ${queriesRun} of ${queries.length} queries: subrequest budget spent`
          : `all ${queryErrors} of ${queriesRun} queries failed; last: ${lastError}`,
        chosenDiscogsId: null, queriesRun, queryErrors, candidates: 0,
      },
      gate: null, queries, tracks: [],
    };
  }

  // Only for a release we are about to store — not per row, and never
  // for a verdict that names none.
  const chosenId = gate.verdict === 'verified' ? gate.chosen?.id ?? null : null;
  const tracks = chosenId ? await fetchTracks(client, chosenId) : [];

  return {
    tracks,
    outcome: {
      itemId: row.itemId,
      verdict: gate.verdict,
      // A verdict reached on a shortened ladder is still a verdict, but
      // it was reached on less evidence than the row deserved and must
      // say so — otherwise a budget-truncated "nothing found" is
      // indistinguishable from a real one.
      reason: [gate.reason,
        queryErrors ? `(${queryErrors} query error(s))` : '',
        budgetStopped ? `(stopped at ${queriesRun} of ${queries.length} queries: subrequest budget)` : '',
      ].filter(Boolean).join(' '),
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
/**
 * Claim a row before searching it, and return the run id.
 *
 * THE BUG THIS FIXES: `pendingRows` excludes items that already have a
 * `match_run`, and the run was written only AFTER the search finished.
 * A row taking longer than the five-minute cron period was therefore
 * still in flight when the next tick selected it — item 451 collected
 * two runs on 2026-08-31, 10:50:12 and 10:54:48, and paid the Discogs
 * rate limit twice to reach two verdicts for one disc. Nothing in the
 * schema forbids that: `match_run` has no unique constraint on
 * `item_id`, and adding one would fail the honest case where a row is
 * deliberately re-queued.
 *
 * The claim is a `pending` run — the state the schema has always had a
 * default for and nothing has used until now. It excludes the row from
 * the next tick immediately, and `persistRun` updates it in place.
 *
 * A claim left behind by an invocation that died mid-row is a row
 * stuck in `pending` rather than a row searched twice. That is the
 * better failure: it is visible, and re-queueing is already a normal
 * operation here.
 */
export async function claimRow(env: Env, itemId: number): Promise<number> {
  const run = await env.DB.prepare(
    "INSERT INTO match_run (item_id, state) VALUES (?, 'pending') RETURNING id",
  ).bind(itemId).first<{ id: number }>();
  if (!run) throw new Error('match_run claim returned no id');
  return run.id;
}

export async function persistRun(
  env: Env,
  row: MatchRow,
  result: Awaited<ReturnType<typeof matchRow>>,
  runId: number,
): Promise<number> {
  let written = 0;
  const state = result.outcome.verdict === 'verified' ? 'auto-accepted'
    : result.outcome.verdict === 'error' ? 'error'
      : result.outcome.verdict === 'rejected' ? 'rejected'
        : result.outcome.verdict === 'no_match' ? 'rejected' : 'needs-review';

  let releaseId: number | null = null;
  if (result.outcome.chosenDiscogsId !== null) {
    const up = await upsertRelease(env, result.outcome.chosenDiscogsId, result.gate, result.tracks);
    releaseId = up.id;
    written += up.written;
  }

  // UPDATE, not INSERT: the row was claimed before the search began.
  await env.DB.prepare(
    `UPDATE match_run SET state = ?, queries_json = ?, chosen_release_id = ?, ran_at = datetime('now')
      WHERE id = ?`,
  ).bind(
    state,
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
    runId,
  ).run();
  written += 1;

  const top5 = (result.gate?.ranked ?? []).slice(0, 5);
  if (top5.length) {
    await env.DB.batch(top5.map((c, i) => env.DB.prepare(
      'INSERT INTO match_candidate (match_run_id, rank, discogs_id, score, signals_json) VALUES (?, ?, ?, ?, ?)',
    ).bind(runId, i + 1, c.id, c.score, JSON.stringify({
      families: c.families,
      signals: c.signals,
      // WHAT THE RELEASE IS, not just how well it scored. The review
      // screen showed "Discogs release 1451234" and a number, so
      // deciding whether a candidate was the record in your hand meant
      // opening Discogs for every one of them — across a queue of 293.
      // Discogs returned this on the search rung that found the
      // candidate; it was scored and discarded.
      // Optional throughout: a score can be built without the candidate
      // it came from, and a candidate need not carry every field. The
      // screen falls back to the bare id, which is what it always
      // showed.
      release: {
        title: c.candidate?.title ?? null,
        label: Array.isArray(c.candidate?.label) ? c.candidate.label.join('; ') : c.candidate?.label ?? null,
        catno: c.candidate?.catno ?? null,
        year: c.candidate?.year ?? null,
        format: Array.isArray(c.candidate?.format) ? c.candidate.format.join(', ') : c.candidate?.format ?? null,
      },
    }))));
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
  env: Env, discogsId: number, gate: GateResult | null, tracks: TrackRow[] = [],
): Promise<{ id: number; written: number }> {
  const existing = await env.DB.prepare('SELECT id FROM release WHERE discogs_id = ?')
    .bind(discogsId).first<{ id: number }>();
  if (existing) return { id: existing.id, written: 0 };

  // Stored, not discarded. A release row of nothing but an id gives the
  // review screen nothing to display, so a person is asked to confirm a
  // match against a blank — which is not a confirmation at all.
  const c = gate?.chosen?.candidate;
  const created = await env.DB.prepare(
    `INSERT INTO release (discogs_id, title, label, catno, year)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    discogsId,
    c?.title ?? null,
    Array.isArray(c?.label) ? c.label.join('; ') : c?.label ?? null,
    c?.catno ?? null,
    c?.year ? Number(String(c.year).slice(0, 4)) || null : null,
  ).first<{ id: number }>();
  if (!created) throw new Error('release insert returned no id');
  await env.DB.prepare(
    "INSERT INTO field_source (entity, entity_id, field, source, confidence) VALUES ('release', ?, 'discogs_id', 'discogs', ?)",
  ).bind(created.id, gate?.chosen?.score ?? null).run();
  let written = 2;

  // The tracklist, if the release endpoint gave one. `completeness`
  // stays at its 'unknown' default deliberately: whether a track is a
  // whole work, a movement or an excerpt is M3's judgement from
  // MusicBrainz, and guessing it here would put a fact in the column
  // that decides which cluster a performance joins.
  if (tracks.length) {
    await env.DB.batch(tracks.map((t) => env.DB.prepare(
      'INSERT INTO release_track (release_id, position, title, duration_s) VALUES (?, ?, ?, ?)',
    ).bind(created.id, t.position, t.title, t.durationS)));
    written += tracks.length;
  }

  return { id: created.id, written };
}

/** Rows awaiting a first match, oldest first. */
export async function pendingRows(env: Env, limit: number): Promise<MatchRow[]> {
  // A photo-only capture has a `capture` row with every column null —
  // nothing to search on. Where a photograph has been read, the reading
  // lives in `raw_value` and fills the gap.
  //
  // `capture` ALWAYS WINS where it has a value, and is never written
  // to: it holds what a HUMAN read, which is what duplicate detection
  // depends on. A reading is a lead, which is the same standing a
  // catalogue number has always had here — and the corroboration gate
  // still refuses a single signal family, so a reading cannot verify a
  // release on its own. Its output goes to the review queue, where a
  // person decides. That is why using it here does not breach the
  // provenance rule, which governs clusters, coverage checks, sell
  // lists and shortlists — none of which this feeds.
  const raw = (field: string) =>
    `(SELECT r.value FROM raw_value r WHERE r.item_id = i.id AND r.field = '${field}')`;
  const { results } = await env.DB.prepare(
    `SELECT i.id AS itemId, c.id AS captureId,
            COALESCE(c.catno_raw, ${raw('catno_raw')}) AS catnoRaw,
            COALESCE(c.label_raw, ${raw('label_raw')}) AS labelRaw,
            COALESCE(c.title_raw, ${raw('title_raw')}) AS titleRaw,
            COALESCE(c.name_raw,  ${raw('name_raw')})  AS nameRaw,
            COALESCE(c.year_raw,  ${raw('year_raw')})  AS yearRaw
       FROM item i
       LEFT JOIN capture c ON c.item_id = i.id
      WHERE NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id)
      ORDER BY i.id
      LIMIT ?`,
  ).bind(limit).all();
  return results as unknown as MatchRow[];
}
