import { parseDiscogsReleaseId } from '../src/discogs-id.ts';
import type { Env } from './env.ts';

/**
 * Resolving one review-queue item.
 *
 * This is the only place a value becomes decision-eligible. The matcher
 * writes `discogs` and leaves it unconfirmed — the machine does not
 * confirm its own work — so until a person answers here, the decision
 * views stay empty however confident the score was.
 *
 * `capture` is never touched. Discogs data lands in `release`, and the
 * two stay separate for ever (AGENTS.md), so a wrong answer here can be
 * revised without having damaged what a human read off the disc.
 */

export type Choice = 'candidate' | 'manual' | 'none' | 'skip';

export interface ResolveInput {
  choice: Choice;
  discogsId?: number;
  decidedBy: string;
  note?: string;
}

export function parseResolve(body: unknown): { ok: true; value: ResolveInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;

  const choice = b.choice;
  if (choice !== 'candidate' && choice !== 'manual' && choice !== 'none' && choice !== 'skip') {
    return { ok: false, error: 'choice must be candidate, manual, none or skip' };
  }

  const decidedBy = typeof b.decidedBy === 'string' ? b.decidedBy.trim() : '';
  // With no sign-in there is no identity to read, so the reviewer names
  // themselves. An unattributed confirmation is a script marking its
  // own homework, and the schema refuses it.
  if (!decidedBy) return { ok: false, error: 'decidedBy is required — a confirmation must say who made it' };

  const needsId = choice === 'candidate' || choice === 'manual';
  const raw = b.discogsId;
  const discogsId = parseDiscogsReleaseId(raw);
  if (needsId && discogsId === null) {
    return { ok: false, error: `choice "${choice}" must name a Discogs release id` };
  }
  if (!needsId && raw !== undefined && raw !== null) {
    return { ok: false, error: `choice "${choice}" must not name a release` };
  }

  return {
    ok: true,
    value: {
      choice, decidedBy,
      discogsId: needsId ? discogsId! : undefined,
      note: typeof b.note === 'string' && b.note.trim() ? b.note.trim() : undefined,
    },
  };
}

async function releaseIdFor(env: Env, discogsId: number, decidedBy: string): Promise<number> {
  const existing = await env.DB.prepare('SELECT id FROM release WHERE discogs_id = ?')
    .bind(discogsId).first<{ id: number }>();
  if (existing) return existing.id;

  const created = await env.DB.prepare('INSERT INTO release (discogs_id) VALUES (?) RETURNING id')
    .bind(discogsId).first<{ id: number }>();
  if (!created) throw new Error('release insert returned no id');
  await env.DB.prepare(
    `INSERT INTO field_source (entity, entity_id, field, source, confirmed_by, confirmed_at)
     VALUES ('release', ?, 'discogs_id', 'discogs', ?, datetime('now'))`,
  ).bind(created.id, decidedBy).run();
  return created.id;
}

export interface ResolveResult { itemId: number; linkedReleaseId: number | null; decisionEligible: boolean }

export async function resolveRun(env: Env, runId: number, input: ResolveInput): Promise<ResolveResult | { error: string } | null> {
  const run = await env.DB.prepare('SELECT id, item_id, state FROM match_run WHERE id = ?')
    .bind(runId).first<{ id: number; item_id: number; state: string }>();
  if (!run) return null;
  const latest = await env.DB.prepare('SELECT MAX(id) AS id FROM match_run WHERE item_id = ?')
    .bind(run.item_id).first<{ id: number }>();
  if (latest?.id !== runId || run.state === 'pending') {
    return { error: 'This search is still running or has been superseded. Refresh the record before resolving it.' };
  }
  if (input.choice === 'candidate' && !await env.DB.prepare(
    'SELECT id FROM match_candidate WHERE match_run_id = ? AND discogs_id = ?')
    .bind(runId, input.discogsId!).first()) {
    return { error: 'That release was not a candidate in this attempt. Use manual entry after checking it.' };
  }

  // The guard is repeated inside the transaction. A retry can arrive while
  // releaseIdFor is awaited, after the initial stale-page check above.
  const current = `EXISTS (SELECT 1 FROM match_run m WHERE m.id = ? AND m.state <> 'pending'
    AND m.id = (SELECT MAX(m2.id) FROM match_run m2 WHERE m2.item_id = m.item_id))`;
  const writes: D1PreparedStatement[] = [];
  let releaseId: number | null = null;
  if (input.discogsId !== undefined) {
    releaseId = await releaseIdFor(env, input.discogsId, input.decidedBy);
    writes.push(env.DB.prepare(`UPDATE item SET release_id = ? WHERE id = ? AND ${current}`)
      .bind(releaseId, run.item_id, runId));
    writes.push(env.DB.prepare(
      `INSERT INTO field_source (entity, entity_id, field, source, confirmed_by, confirmed_at)
       SELECT 'item', ?, 'release_id', 'discogs', ?, datetime('now') WHERE ${current}
       ON CONFLICT (entity, entity_id, field)
       DO UPDATE SET source = 'discogs', confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at`,
    ).bind(run.item_id, input.decidedBy, runId));
  } else if (input.choice === 'none') {
    writes.push(env.DB.prepare(`UPDATE item SET release_id = NULL WHERE id = ? AND ${current}`)
      .bind(run.item_id, runId));
    writes.push(env.DB.prepare(
      `DELETE FROM field_source WHERE entity = 'item' AND entity_id = ? AND field = 'release_id' AND ${current}`,
    ).bind(run.item_id, runId));
  }
  writes.push(env.DB.prepare(
    `INSERT INTO review_decision (match_run_id, item_id, choice, discogs_id, decided_by, note)
     SELECT ?, ?, ?, ?, ?, ? WHERE ${current}
     ON CONFLICT (match_run_id) DO UPDATE SET
       choice = excluded.choice, discogs_id = excluded.discogs_id,
       decided_by = excluded.decided_by, note = excluded.note, decided_at = datetime('now')`,
  ).bind(run.id, run.item_id, input.choice, input.discogsId ?? null, input.decidedBy, input.note ?? null, runId));
  writes.push(env.DB.prepare(
    `UPDATE item SET last_verified_at = datetime('now'), last_verified_by = ? WHERE id = ? AND ${current}`,
  ).bind(input.decidedBy, run.item_id, runId));
  await env.DB.batch(writes);
  if (!await env.DB.prepare(`SELECT 1 AS ok WHERE ${current}`).bind(runId).first()) {
    return { error: 'A newer search arrived while saving. Refresh the record before resolving it.' };
  }

  const eligible = await env.DB.prepare('SELECT COUNT(*) AS n FROM v_decision_eligible_item WHERE id = ?')
    .bind(run.item_id).first<{ n: number }>();

  return { itemId: run.item_id, linkedReleaseId: releaseId, decisionEligible: (eligible?.n ?? 0) > 0 };
}
