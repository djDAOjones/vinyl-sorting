import { Hono } from 'hono';
import type { Env } from './env.ts';
import { insertCapture, parseCapture } from './capture.ts';
import { DiscogsClient } from './discogs.ts';
import { RateLimiter } from './rate-limit.ts';
import { matchRow, pendingRows, persistRun } from './match/run.ts';
import { parseResolve, resolveRun } from './review.ts';

/**
 * Deep Groove Worker.
 *
 * NAMED OPERATIONS ONLY. v1 has no sign-in (OPEN-USERS-ACCESS,
 * 2026-08-30), so the shape of this Worker is what carries the safety:
 * there is no general proxy, no endpoint takes a caller-supplied
 * upstream query, and nothing here reads DISCOGS_TOKEN. Capture is a
 * person typing what is printed on a label, so M1 needs no Discogs
 * path at all — which is what makes "no sign-in" cost nothing yet.
 *
 * M2 ADDS MATCHING WITHOUT REOPENING THAT. The matcher is driven by a
 * CRON TRIGGER, not by a route: there is no HTTP entry point to it, so
 * no caller can aim a Discogs query even though the site is open. The
 * query set is a pure function of stored capture values. That is the
 * option OPEN-USERS-ACCESS left open, and it keeps "no sign-in" true.
 */

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/api/health', async (c) => {
    const row = await c.env.DB.prepare('SELECT MAX(version) AS version FROM schema_migration')
      .first<{ version: number }>();
    const items = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM item').first<{ n: number }>();
    return c.json({ ok: true, schemaVersion: row?.version ?? null, items: items?.n ?? 0 });
  });

  /** Write one queued capture. Idempotent on clientId. */
  app.post('/api/captures', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'body must be JSON' }, 400); }

    const parsed = parseCapture(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const { itemId, created } = await insertCapture(c.env, parsed.value);
    // 200 rather than 201 on a replay, so the client can drop the
    // queued entry either way without treating a retry as an error.
    return c.json({ itemId, created }, created ? 201 : 200);
  });

  /** Store one label photo and return the key a capture will reference. */
  app.put('/api/photos/:key{[A-Za-z0-9._-]{1,120}}', async (c) => {
    // 503 rather than 500: the client's queue retries on it, so a photo
    // taken before R2 was enabled uploads itself once it is.
    if (!c.env.PHOTOS) {
      return c.json({ error: 'photo storage is not configured yet; the photo stays queued' }, 503);
    }
    const type = c.req.header('content-type') ?? '';
    if (!PHOTO_TYPES.has(type)) return c.json({ error: `unsupported content-type: ${type}` }, 415);

    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_PHOTO_BYTES) return c.json({ error: 'photo too large' }, 413);
    if (!c.req.raw.body) return c.json({ error: 'empty body' }, 400);

    const key = `labels/${c.req.param('key')}`;
    await c.env.PHOTOS.put(key, c.req.raw.body, { httpMetadata: { contentType: type } });
    return c.json({ r2Key: key }, 201);
  });

  /** Read the collection. Keyset pagination — cheap and stable under insert. */
  app.get('/api/items', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
    const after = Number(c.req.query('after') ?? 0) || 0;
    const { results } = await c.env.DB.prepare(
      `SELECT i.id, i.crate, i.position, i.media_grade, i.sleeve_grade, i.decision,
              i.captured_by, i.captured_at, i.import_ref,
              c.catno_raw, c.label_raw, c.name_raw, c.title_raw,
              r.discogs_id, r.label AS release_label
         FROM item i
         LEFT JOIN capture c ON c.item_id = i.id
         LEFT JOIN release r ON r.id = i.release_id
        WHERE i.id > ?
        ORDER BY i.id
        LIMIT ?`,
    ).bind(after, limit).all();
    const next = results.length === limit ? (results[results.length - 1] as { id: number }).id : null;
    return c.json({ items: results, nextAfter: next });
  });

  app.get('/api/items/:id{[0-9]+}', async (c) => {
    const id = Number(c.req.param('id'));
    const item = await c.env.DB.prepare('SELECT * FROM item WHERE id = ?').bind(id).first();
    if (!item) return c.json({ error: 'not found' }, 404);

    const [captures, photos, provenance] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM capture WHERE item_id = ?').bind(id).all(),
      c.env.DB.prepare('SELECT kind, r2_key FROM item_photo WHERE item_id = ?').bind(id).all(),
      c.env.DB.prepare(
        `SELECT entity, field, source, confirmed_by, confirmed_at FROM field_source
          WHERE (entity = 'item' AND entity_id = ?)
             OR (entity = 'capture' AND entity_id IN (SELECT id FROM capture WHERE item_id = ?))`,
      ).bind(id, id).all(),
    ]);
    return c.json({
      item,
      captures: captures.results,
      photos: photos.results,
      provenance: provenance.results,
    });
  });

  /**
   * The review queue: what the matcher could not settle, with the
   * candidates it weighed. Read-only — a caller may look at what the
   * cron job decided, and cannot make it run.
   */
  app.get('/api/review-queue', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    // Skipped items leave the default queue but are re-queueable:
    // re-verification is a normal operation, not a migration.
    const includeSkipped = c.req.query('include') === 'skipped';
    const { results } = await c.env.DB.prepare(
      `SELECT m.id AS run_id, m.item_id, m.state, m.ran_at, m.queries_json,
              c.catno_raw, c.label_raw, c.title_raw, c.name_raw,
              i.crate, i.position, i.last_verified_at
         FROM match_run m
         JOIN item i ON i.id = m.item_id
         LEFT JOIN capture c ON c.item_id = i.id
         LEFT JOIN review_decision d ON d.match_run_id = m.id
        WHERE m.state = 'needs-review'
          AND (d.id IS NULL OR (? = 1 AND d.choice = 'skip'))
        ORDER BY m.item_id
        LIMIT ?`,
    ).bind(includeSkipped ? 1 : 0, limit).all();

    // D1 allows at most 100 bound parameters per query, so the id list
    // is chunked rather than the page size being capped. Local SQLite
    // has no such limit, so a 200-row page worked in development and
    // returned 500 in production.
    const runIds = results.map((r) => (r as { run_id: number }).run_id);
    const CHUNK = 90;
    const candidates: unknown[] = [];
    for (let i = 0; i < runIds.length; i += CHUNK) {
      const slice = runIds.slice(i, i + CHUNK);
      const page = await c.env.DB.prepare(
        `SELECT match_run_id, rank, discogs_id, score, signals_json
           FROM match_candidate
          WHERE match_run_id IN (${slice.map(() => '?').join(',')})
          ORDER BY match_run_id, rank`,
      ).bind(...slice).all();
      candidates.push(...page.results);
    }

    const byRun = new Map<number, unknown[]>();
    for (const cand of candidates) {
      const key = (cand as { match_run_id: number }).match_run_id;
      if (!byRun.has(key)) byRun.set(key, []);
      byRun.get(key)?.push(cand);
    }
    return c.json({
      queue: results.map((r) => ({ ...r, candidates: byRun.get((r as { run_id: number }).run_id) ?? [] })),
    });
  });

  /** A person's verdict on one queued item. The only route to eligibility. */
  app.post('/api/review/:runId{[0-9]+}/resolve', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'body must be JSON' }, 400); }

    const parsed = parseResolve(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const result = await resolveRun(c.env, Number(c.req.param('runId')), parsed.value);
    if (!result) return c.json({ error: 'no such review run' }, 404);
    return c.json(result);
  });

  /** Match statistics, so a run can be judged without reading rows. */
  app.get('/api/match-stats', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT state, COUNT(*) AS n FROM match_run GROUP BY state').all();
    const pending = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM item i WHERE NOT EXISTS (SELECT 1 FROM match_run m WHERE m.item_id = i.id)',
    ).first<{ n: number }>();
    const reviewed = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM review_decision').first<{ n: number }>();
    const eligible = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM v_decision_eligible_item').first<{ n: number }>();
    return c.json({
      byState: results, unmatched: pending?.n ?? 0,
      reviewed: reviewed?.n ?? 0, decisionEligible: eligible?.n ?? 0,
    });
  });

  /**
   * Anything feeding a decision reads through the views, never the
   * base tables. At M1 this is empty by construction — nothing has
   * been confirmed by a person — and that is the point: the endpoint
   * exists so M4 and M5 cannot quietly read around the rule.
   */
  app.get('/api/decision-eligible', async (c) => {
    const items = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM v_decision_eligible_item').first<{ n: number }>();
    const coverage = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM v_eligible_work_coverage').first<{ n: number }>();
    return c.json({ eligibleItems: items?.n ?? 0, eligibleCoverage: coverage?.n ?? 0 });
  });

  // Everything not named above is refused. With no sign-in, an
  // unnamed route is the thing that would become a proxy.
  app.all('*', (c) => c.json({ error: 'no such operation' }, 404));

  app.onError((err, c) => {
    console.error('worker error', err);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}

/**
 * The matcher, driven by cron. Deliberately NOT reachable over HTTP:
 * with no sign-in, a route that triggered Discogs work would be a
 * stranger's lever on the maintainer's rate limit and identity.
 *
 * A batch per tick rather than the whole backlog, so one invocation
 * stays inside its budget and a failure costs one batch.
 *
 * FOUR rows, not twenty-five: the limiter now spaces Discogs requests
 * two seconds apart, and a row costs about five queries, so four rows
 * is roughly forty seconds of a five-minute tick. Sizing this to the
 * pacing rather than to a round number is what keeps an invocation
 * from running past its limit.
 */
/**
 * Rows the matcher may write in one tick before it stops.
 *
 * PROVISIONAL. OPS-SPEND-GUARD asks for this number to be set from the
 * measured write volume of the first full run, not guessed, and that
 * run has not happened yet. 200 is the shape argument until it does: a
 * row costs at most ~10 writes (release + its provenance, the run, five
 * candidates, the item update and its provenance) and a tick takes four
 * rows, so a healthy tick writes ~40 and this leaves 5x headroom. It is
 * a runaway-loop backstop, not a throttle — a normal tick must never
 * reach it, and if one ever does, that is the bug it exists to catch.
 *
 * Cloudflare sells no hard spend cap, so this is the wall.
 */
export const WRITE_BUDGET_PER_TICK = 200;

/**
 * Options rather than four positional arguments, because two of them
 * exist only so a test can run on a fake clock. The limiter and the
 * client already accept injected time; this passes it through, which
 * is the difference between a test suite that takes a second and one
 * that spends 95 of them genuinely waiting out the Discogs spacing.
 */
export interface MatchBatchOptions {
  batchSize?: number;
  writeBudget?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function runMatchBatch(
  env: Env,
  opts: MatchBatchOptions = {},
): Promise<{ processed: number; rowsWritten: number; stoppedShort: boolean }> {
  const {
    batchSize = 4, writeBudget = WRITE_BUDGET_PER_TICK, now, sleep,
  } = opts;
  if (!env.DISCOGS_TOKEN) {
    console.warn('match: DISCOGS_TOKEN is not set; nothing to do');
    return { processed: 0, rowsWritten: 0, stoppedShort: false };
  }
  const limiter = new RateLimiter({
    get: (k) => env.CACHE.get(k),
    put: (k, v, o) => env.CACHE.put(k, v, o),
  }, now);
  // fetchImpl left to the client's own default ON PURPOSE: naming
  // fetch here would put an outbound call in a second file and break
  // the invariant that every upstream request goes through the one
  // rate-limited client. Only the clock is injected.
  const client = new DiscogsClient(env.DISCOGS_TOKEN, limiter, undefined, sleep);

  const rows = await pendingRows(env, batchSize);
  let rowsWritten = 0;
  let processed = 0;
  let stoppedShort = false;

  for (const row of rows) {
    // Checked BEFORE the row, not after: a row costs at most ~10 writes
    // and the budget has multiples of that in headroom, so stopping on
    // the way in keeps every persisted run whole. A half-written run
    // would be worse than a short tick — the next tick would see the
    // item as still pending and search it again, paying the rate limit
    // twice for one row.
    if (rowsWritten >= writeBudget) {
      stoppedShort = true;
      break;
    }
    const result = await matchRow(row, client);
    rowsWritten += await persistRun(env, row, result);
    processed += 1;
  }

  return { processed, rowsWritten, stoppedShort };
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => createApp().fetch(req, env, ctx),
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runMatchBatch(env).then(({ processed, rowsWritten, stoppedShort }) => {
      // Say when it stopped short. A tick that quietly did less than it
      // was asked to looks identical to a quiet night in the logs, and
      // the whole point of the budget is that someone notices.
      console.log(
        `match: processed ${processed} row(s), ${rowsWritten} row(s) written`
        + (stoppedShort ? ` — STOPPED SHORT at the ${WRITE_BUDGET_PER_TICK}-write budget` : ''),
      );
    }));
  },
};
