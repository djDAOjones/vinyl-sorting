import type { Env } from '../env.ts';
import { loadMatchRow } from './input.ts';
import { checkRow } from './sanity.ts';

/** Let a person identify a never-searched record, even when its text is incomplete. */
export async function startManualReview(env: Env, itemId: number, requestedBy: string) {
  const input = await loadMatchRow(env, itemId);
  if (!input) return { error: 'Record not found', status: 404 as const };
  const row = await env.DB.prepare(`INSERT INTO match_run (item_id, state, queries_json)
    SELECT i.id, 'needs-review', ? FROM item i WHERE i.id = ?
      AND NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM v_confirmed_field v WHERE v.entity = 'item'
        AND v.entity_id = i.id AND v.field = 'release_id') RETURNING id`)
    .bind(JSON.stringify({ manualReview: true, requestedBy, input,
      reason: 'Manual review opened before an automated search. No candidates have been searched.' }), itemId)
    .first<{ id: number }>();
  return row ? { runId: row.id, status: 201 as const }
    : { error: 'Record unavailable or already has a review or search. Refresh to open the current attempt.', status: 409 as const };
}

/** Queue stored evidence for cron. No network call, deletion or new schema. */
export async function requestMatch(env: Env, itemId: number, requestedBy: string) {
  const row = await loadMatchRow(env, itemId);
  if (!row) return { error: 'Record not found', status: 404 as const };
  const ready = checkRow(row);
  if (!ready.usable) return { error: `Check the label details first: ${ready.reason}`, status: 422 as const };
  const inserted = await env.DB.prepare(`
    INSERT INTO match_run (item_id, state, queries_json)
    SELECT i.id, 'pending', ? FROM item i WHERE i.id = ?
      AND NOT EXISTS (SELECT 1 FROM v_confirmed_field v
        WHERE v.entity = 'item' AND v.entity_id = i.id AND v.field = 'release_id')
      AND NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id
        AND m.id = (SELECT MAX(m2.id) FROM match_run m2 WHERE m2.item_id = i.id)
        AND ((m.state = 'pending' AND (json_extract(m.queries_json, '$.retry') = 'queued'
              OR m.ran_at > datetime('now', '-15 minutes')))
          OR m.ran_at > datetime('now', '-5 minutes')))
    RETURNING id`).bind(JSON.stringify({ retry: 'queued', requestedBy,
      reason: 'Retry queued; the scheduled matcher will use the latest saved label details.' }), itemId)
    .first<{ id: number }>();
  if (!inserted) return { error: 'Already queued, searched in the last five minutes, or confirmed. Refresh this record before trying again.', status: 409 as const };
  return { runId: inserted.id, status: 202 as const };
}

/** Atomically take a queued retry; overlapping ticks can only claim it once. */
export async function claimRetry(env: Env, runId: number): Promise<number | null> {
  const claimed = await env.DB.prepare(`UPDATE match_run
    SET queries_json = json_set(queries_json, '$.retry', 'running'), ran_at = datetime('now')
    WHERE id = ? AND state = 'pending' AND json_extract(queries_json, '$.retry') = 'queued'
      AND id = (SELECT MAX(m.id) FROM match_run m WHERE m.item_id = match_run.item_id)
      AND NOT EXISTS (SELECT 1 FROM v_confirmed_field v WHERE v.entity = 'item'
        AND v.entity_id = match_run.item_id AND v.field = 'release_id') RETURNING id`)
    .bind(runId).first<{ id: number }>();
  return claimed?.id ?? null;
}
