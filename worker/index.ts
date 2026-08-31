import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from './env.ts';
import { insertCapture, parseCapture } from './capture.ts';
import { DiscogsClient, MAX_ATTEMPTS_PER_QUERY, SUBREQUEST_BUDGET } from './discogs.ts';
import { RateLimiter } from './rate-limit.ts';
import { claimRow, matchRow, pendingRows, persistRun } from './match/run.ts';
import { parseResolve, resolveRun } from './review.ts';
// The roster is shared with the client on purpose: one list, so the
// gate and the sign-in cannot disagree about who exists.
import { resolveCapturer } from '../src/who.ts';
import { applyEdit, parseEdit, parsePromote, promoteReading, tokenMatches } from './edit.ts';
import { exportCsv, exportJson, readSettings, writeSettings } from './admin.ts';

/**
 * Vinyl sorter Worker.
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
  /**
   * Serve one label photograph.
   *
   * BROWSE-PHOTOS, maintainer sign-off 2026-08-31: yes, serve them,
   * gated by the typed name.
   *
   * SAY WHAT THIS GATE IS. The roster is six household first names and
   * it SHIPS IN THE CLIENT BUNDLE — `src/who.ts` says so itself, and
   * calls the name "a speed bump and an honest label on a row, not
   * access control". Anyone who opens the JavaScript can read the six
   * valid answers. So this stops a crawler and a stranger guessing a
   * URL; it does not stop anyone who looks. The maintainer took that
   * trade knowingly, having already settled OPEN-V1-AUTH as "no sign-in
   * for v1".
   *
   * What it is NOT is theatre, and the difference is the next route
   * down: `/api/items/:id` returns every `r2_key`, so gating the
   * photograph while leaving the keys anonymous would have protected
   * nothing at all. Both moved behind the same header together.
   *
   * The key is matched against `item_photo` rather than passed to R2 as
   * given. `parseCapture` only trims `r2Key`, so a stored key can be
   * any string a capture chose — and a key that reaches R2 unchecked is
   * a path the caller controls.
   */
  /**
   * The named caller, from a header OR a cookie.
   *
   * BOTH, because the two callers cannot use the same one. `fetch` sets
   * a header and cannot set a cookie for an image it does not make;
   * `<img src>` sends cookies and can set no headers at all. Gating on
   * the header alone made every photograph on both screens a broken
   * image while curl passed — the request a browser actually makes for
   * an `<img>` was never the request being tested.
   */
  const namedCaller = (c: Context<{ Bindings: Env }>): boolean => {
    if (resolveCapturer(c.req.header('x-capturer') ?? '')) return true;
    const raw = /(?:^|;\s*)dg_who=([^;]*)/.exec(c.req.header('cookie') ?? '')?.[1] ?? '';
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* a malformed cookie is not a name */ }
    return Boolean(resolveCapturer(decoded));
  };

  const capturerGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
    if (!namedCaller(c)) {
      return c.json({ error: 'name yourself first — this is the household app' }, 401);
    }
    await next();
  };

  app.get('/api/photos/:key{[A-Za-z0-9._/-]{1,160}}', capturerGuard, async (c) => {
    if (!c.env.PHOTOS) return c.json({ error: 'photo storage is not configured' }, 503);
    const key = c.req.param('key');
    // Known to the database, or not served. R2 never sees a key the
    // caller invented.
    const known = await c.env.DB.prepare('SELECT 1 AS ok FROM item_photo WHERE r2_key = ?')
      .bind(key).first<{ ok: number }>();
    if (!known) return c.json({ error: 'no such photograph' }, 404);

    const obj = await c.env.PHOTOS.get(key);
    if (!obj) return c.json({ error: 'no such photograph' }, 404);
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
        // Private: a household photograph must not sit in a shared
        // cache. Immutable because the key is client-assigned and its
        // content never changes.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  });

  app.get('/api/items', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
    const after = Number(c.req.query('after') ?? 0) || 0;
    // ONE ROW PER ITEM. This used to LEFT JOIN `capture` unaggregated,
    // so an item with two capture rows came back twice — a list that
    // counts its own collection wrong, and a bug that would have been
    // found by a duplicate rather than by reading. One capture per item
    // holds today and nothing enforces it, so the newest is chosen
    // explicitly instead of relying on that.
    const { results } = await c.env.DB.prepare(
      `SELECT i.id, i.crate, i.position, i.media_grade, i.sleeve_grade, i.decision,
              i.captured_by, i.captured_at, i.import_ref, i.last_verified_at,
              c.catno_raw, c.label_raw, c.name_raw, c.title_raw, c.year_raw,
              r.discogs_id, r.label AS release_label, r.title AS release_title,
              c.matrix_runout, r.year AS release_year,
              (SELECT COUNT(*) FROM item_photo p WHERE p.item_id = i.id) AS photo_count,
              -- Whether a photograph has been READ, which is a
              -- different question from whether one was taken. The
              -- mop-up crate is exactly the rows where both are true
              -- and the release still is not settled: photographed,
              -- read, and still unresolved (CATALOGUE-CONTROLS).
              (SELECT COUNT(*) FROM raw_value v2 WHERE v2.item_id = i.id) AS reading_count,
              -- The READING, kept in its own columns beside capture's
              -- and never merged into them. A photo-only row has an
              -- empty capture and its values in raw_value, so the list
              -- showed nineteen rows of dashes — but COALESCEing the
              -- two would erase the distinction the whole project rests
              -- on: capture is what a PERSON read, a reading is what a
              -- machine read off a photograph, and duplicate detection
              -- depends on telling them apart.
              (SELECT r2.value FROM raw_value r2
                WHERE r2.item_id = i.id AND r2.field = 'catno_raw') AS read_catno,
              (SELECT r2.value FROM raw_value r2
                WHERE r2.item_id = i.id AND r2.field = 'label_raw') AS read_label,
              (SELECT r2.value FROM raw_value r2
                WHERE r2.item_id = i.id AND r2.field = 'name_raw') AS read_name,
              (SELECT r2.value FROM raw_value r2
                WHERE r2.item_id = i.id AND r2.field = 'title_raw') AS read_title,
              (SELECT r2.value FROM raw_value r2
                WHERE r2.item_id = i.id AND r2.field = 'other_numbers') AS read_other,
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
    ).bind(after, limit).all();
    const next = results.length === limit ? (results[results.length - 1] as { id: number }).id : null;
    return c.json({ items: results, nextAfter: next });
  });

  app.get('/api/items/:id{[0-9]+}', async (c) => {
    const id = Number(c.req.param('id'));
    const named = namedCaller(c);
    const item = await c.env.DB.prepare('SELECT * FROM item WHERE id = ?').bind(id).first();
    if (!item) return c.json({ error: 'not found' }, 404);

    // The match history is what makes a wrong match explicable a month
    // later. The review queue shows it once and throws it away.
    const [captures, photos, provenance, readings, runs, decisions] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM capture WHERE item_id = ? ORDER BY captured_at DESC, id DESC')
        .bind(id).all(),
      // `r2_key` only for a named caller. Gating the photograph while
      // handing out its key anonymously would have protected nothing —
      // the key IS the photograph's address. A stranger still learns
      // that photographs exist and when they were taken, which is the
      // count the browse screen needs and says nothing about a record.
      c.env.DB.prepare(
        `SELECT id, kind, added_at${named ? ', r2_key' : ''} FROM item_photo
          WHERE item_id = ? ORDER BY id`,
      ).bind(id).all(),
      c.env.DB.prepare(
        `SELECT entity, entity_id, field, source, confidence, confirmed_by, confirmed_at
           FROM field_source
          WHERE (entity = 'item' AND entity_id = ?)
             OR (entity = 'capture' AND entity_id IN (SELECT id FROM capture WHERE item_id = ?))
             OR (entity = 'raw_value' AND entity_id IN (SELECT id FROM raw_value WHERE item_id = ?))`,
      ).bind(id, id, id).all(),
      // Readings that have no home in the four-entity model yet — a
      // photograph's, or a legacy column's. Displayed and marked as
      // what they are; the decision views cannot see them at all.
      c.env.DB.prepare('SELECT id, field, value FROM raw_value WHERE item_id = ? ORDER BY field')
        .bind(id).all(),
      c.env.DB.prepare(
        // Bounded, so the candidate lookup below can never approach
        // D1's 100-parameter limit however often a row is re-verified.
        'SELECT id, state, ran_at, queries_json FROM match_run WHERE item_id = ? ORDER BY id DESC LIMIT 20',
      ).bind(id).all(),
      c.env.DB.prepare(
        `SELECT id, match_run_id, choice, discogs_id, decided_by, decided_at, note
           FROM review_decision WHERE item_id = ? ORDER BY id DESC`,
      ).bind(id).all(),
    ]);

    const runIds = runs.results.map((r) => (r as { id: number }).id);
    const candidates = runIds.length
      ? (await c.env.DB.prepare(
        `SELECT match_run_id, rank, discogs_id, score, signals_json
           FROM match_candidate
          WHERE match_run_id IN (${runIds.map(() => '?').join(',')})
          ORDER BY match_run_id DESC, rank`,
      ).bind(...runIds).all()).results
      : [];

    return c.json({
      item,
      captures: captures.results,
      photos: photos.results,
      provenance: provenance.results,
      readings: readings.results,
      runs: runs.results.map((r) => {
        const runId = (r as { id: number }).id;
        return {
          ...r,
          candidates: candidates.filter((x) => (x as { match_run_id: number }).match_run_id === runId),
          decision: decisions.results.find(
            (d) => (d as { match_run_id: number }).match_run_id === runId,
          ) ?? null,
        };
      }),
    });
  });

  /**
   * Correcting a reading, and confirming one — the only routes that
   * write `capture` after the fact, and the only ones behind the shared
   * passphrase. See `edit.ts` for why the hard rule permits it.
   *
   * `POST /api/captures` and the photo upload stay OPEN on purpose: an
   * offline queue in a loft must not acquire a way to fail, and adding
   * a row is not the risk that rewriting 465 is.
   */
  //
  // The guard is attached PER ROUTE rather than as a mounted sub-app: a
  // wildcard middleware answered before the 404 fallthrough, so every
  // unnamed path started replying 401/503 — which both leaks that a
  // passphrase exists everywhere and breaks "an unnamed route is
  // refused rather than falling through".
  const guard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
    // An unset secret means editing is unavailable, not unlocked.
    if (!c.env.EDIT_TOKEN) {
      return c.json({ error: 'editing is not configured on this deployment' }, 503);
    }
    if (!tokenMatches(c.env.EDIT_TOKEN, c.req.header('x-edit-token') ?? null)) {
      return c.json({ error: 'a passphrase is required to change a reading' }, 401);
    }
    await next();
  };

  app.post('/api/items/:id{[0-9]+}/field', guard, async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'body must be JSON' }, 400); }
    const parsed = parseEdit(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const result = await applyEdit(c.env, Number(c.req.param('id')), parsed.value);
    if (!result) return c.json({ error: 'not found' }, 404);
    return c.json(result);
  });

  app.post('/api/items/:id{[0-9]+}/promote', guard, async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'body must be JSON' }, 400); }
    const parsed = parsePromote(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const result = await promoteReading(c.env, Number(c.req.param('id')), parsed.value);
    if (result === 'no-reading') return c.json({ error: 'no reading held for that field' }, 404);
    if (!result) return c.json({ error: 'not found' }, 404);
    return c.json(result);
  });

  /**
   * Collection settings.
   *
   * READING IS OPEN, writing is not. What comes back is three numbers
   * about how the matcher paces itself — it names no record, no person
   * and no secret — and the settings screen has to render before it can
   * ask for a passphrase. Writing changes what everyone sees, so it
   * sits behind the same passphrase that already guards correcting a
   * reading.
   */
  app.get('/api/settings', async (c) => c.json(await readSettings(c.env)));

  app.post('/api/settings', guard, async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'body must be JSON' }, 400); }
    // Every field is clamped in `parseSettings`, so a bad number is
    // pulled into range rather than refused: this is a preference
    // screen, not an API, and rejecting 10000 days outright would be a
    // worse answer than storing the maximum.
    return c.json(await writeSettings(c.env, body));
  });

  /**
   * Everything, back out again.
   *
   * Read-only, so it cannot break anything, and it is the answer to
   * "what if this all goes away". Behind the passphrase because the
   * whole collection in one response is a different thing from one row
   * at a time — and because a household's records are nobody else's.
   *
   * TWO FORMATS, answering two different questions. `json` is the
   * structured dump that could be restored; `csv` is the flattened
   * collection somebody can open in a spreadsheet, sort, and hand to a
   * person.
   */
  app.get('/api/export', guard, async (c) => {
    const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return new Response(await exportCsv(c.env), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="vinyl-sorter-${stamp}.csv"`,
        },
      });
    }
    return new Response(JSON.stringify(await exportJson(c.env), null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="vinyl-sorter-${stamp}.json"`,
      },
    });
  });

  /**
   * The review queue: what the matcher could not settle, with the
   * candidates it weighed. Read-only — a caller may look at what the
   * cron job decided, and cannot make it run.
   */
  app.get('/api/review-queue', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    const named = namedCaller(c);
    // Skipped items leave the default queue but are re-queueable:
    // re-verification is a normal operation, not a migration.
    const includeSkipped = c.req.query('include') === 'skipped';
    const { results } = await c.env.DB.prepare(
      `SELECT m.id AS run_id, m.item_id, m.state, m.ran_at, m.queries_json,
              c.catno_raw, c.label_raw, c.title_raw, c.name_raw,
              i.crate, i.position, i.last_verified_at,
              ${named
    // The photographs of the record being judged. A match cannot be
    // checked against a disc you cannot see — which is what the
    // maintainer met on 2026-08-31, confirming two items with nothing
    // on screen to compare. Keys only for a named caller, same as
    // everywhere else, because the key is the photograph's address.
    ? `(SELECT group_concat(p.r2_key, char(10)) FROM item_photo p WHERE p.item_id = i.id) AS photo_keys`
    : `NULL AS photo_keys`}
         FROM match_run m
         JOIN item i ON i.id = m.item_id
         LEFT JOIN capture c ON c.item_id = i.id
         LEFT JOIN review_decision d ON d.match_run_id = m.id
        WHERE m.state = 'needs-review'
          -- THE NEWEST RUN PER ITEM, NOT EVERY RUN. One run per item
          -- held until MATCH-REVERIFY-SWEEP made re-running a normal
          -- operation: a swept row that still cannot auto-accept writes
          -- a SECOND needs-review run, and without this the same disc
          -- appears in the queue twice — so a sweep meant to refresh
          -- the queue would double it instead. Found on the live queue
          -- rather than in a test, which is why the test below now
          -- exists.
          AND m.id = (SELECT MAX(m2.id) FROM match_run m2 WHERE m2.item_id = i.id)
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
    // ITEMS waiting, not RUNS waiting, and the two stopped being the
    // same number when re-running became a normal operation. `byState`
    // is deliberately left as a histogram of runs — it is how a run is
    // judged — but "how much work is in the queue" is a question about
    // discs, and the home screen asks it that way.
    const waiting = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item i
        WHERE (SELECT m.state FROM match_run m WHERE m.item_id = i.id
                ORDER BY m.id DESC LIMIT 1) = 'needs-review'
          AND NOT EXISTS (SELECT 1 FROM review_decision d
                           WHERE d.match_run_id = (SELECT MAX(m2.id) FROM match_run m2
                                                    WHERE m2.item_id = i.id)
                             AND d.choice <> 'skip')`,
    ).first<{ n: number }>();
    return c.json({
      byState: results, unmatched: pending?.n ?? 0,
      reviewed: reviewed?.n ?? 0, decisionEligible: eligible?.n ?? 0,
      itemsNeedingReview: waiting?.n ?? 0,
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
/**
 * A row costs about five Discogs queries — the ladder stops as soon as
 * scored candidates exist, so this is the observed average, not the
 * worst case.
 */
export const QUERIES_PER_ROW = 12;

/**
 * Wall-clock a tick may spend waiting on the Discogs spacing.
 *
 * 40s of a five-minute tick. It exists so that WIDENING the gap
 * narrows the batch automatically, keeping the invocation the same
 * length instead of quietly doubling.
 *
 * QUERIES_PER_ROW was 5, estimated before there was anything to
 * measure. On 2026-08-31, sixteen rows carrying promoted photo
 * readings ran 9.4-12 queries each: a reading supplies label, title and
 * name as well as a catalogue number, so the ladder has far more
 * permutations to walk than a capture-only row did at 4.7. Batch
 * sizing was dividing by a number that had stopped being true, so a
 * tick took twice the rows it had budgeted for.
 */
export const TICK_WORK_BUDGET_MS = 240_000;

/** How often the cron fires. One row must always fit inside this. */
export const CRON_PERIOD_MS = 300_000;

/**
 * Rows per tick: the smaller of what time allows and what Cloudflare
 * allows.
 *
 * TWO CEILINGS, and the tight one changes with the gap. Time was the
 * only one considered before, at a 40s budget, which was really a
 * proxy for "do not run long" — but waiting is not CPU and the actual
 * constraint is finishing inside CRON_PERIOD_MS, so the budget is now
 * 240s of that 300s and time binds only at wide gaps.
 *
 * The other ceiling is Cloudflare's per-invocation subrequest cap,
 * which time cannot buy any relief from: at 12 queries a row and 36
 * attempts to spend, three rows is the most an invocation can attempt
 * however slowly it goes. That is the ceiling the matcher actually hit
 * on 2026-08-31, and no amount of widening would have helped.
 *
 * The floor of one row deliberately outranks both: a tick rounding
 * down to no rows would stall the matcher for good, which is worse
 * than a long tick or a truncated ladder.
 */
export const batchSizeFor = (minIntervalMs: number): number => Math.max(1, Math.min(
  Math.floor(TICK_WORK_BUDGET_MS / (QUERIES_PER_ROW * Math.max(1, minIntervalMs))),
  // Attempts, not queries: a throttled query costs up to four
  // subrequests, and sizing on one apiece left no headroom at all.
  Math.floor(SUBREQUEST_BUDGET / (QUERIES_PER_ROW * MAX_ATTEMPTS_PER_QUERY)),
));

export interface MatchBatchOptions {
  batchSize?: number;
  writeBudget?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * How long to stop asking after a tick that reached nothing.
 *
 * Two cron periods. Long enough that a spell of refusals is not met
 * with more requests, short enough that a transient one costs ten
 * minutes rather than an evening.
 */
export const COOLDOWN_MS = 2 * CRON_PERIOD_MS;

export async function runMatchBatch(
  env: Env,
  opts: MatchBatchOptions = {},
): Promise<{
  processed: number; rowsWritten: number; stoppedShort: boolean;
  cooledDown?: boolean; interval?: number; errorRate?: number;
}> {
  const { batchSize, writeBudget = WRITE_BUDGET_PER_TICK, now, sleep } = opts;
  if (!env.DISCOGS_TOKEN) {
    console.warn('match: DISCOGS_TOKEN is not set; nothing to do');
    return { processed: 0, rowsWritten: 0, stoppedShort: false };
  }
  const limiter = new RateLimiter({
    get: (k) => env.CACHE.get(k),
    put: (k, v, o) => env.CACHE.put(k, v, o),
  }, now);
  // Derived from the gap in force rather than fixed, so tuning the
  // pacing cannot silently change how long an invocation runs.
  // Sitting out is the point: when Discogs is refusing, a further
  // request is one that will also be refused. It spends the subrequest
  // budget and the shared window and returns nothing.
  if (await limiter.inCooldown('discogs')) {
    return { processed: 0, rowsWritten: 0, stoppedShort: false, cooledDown: true };
  }
  const rowsThisTick = batchSize ?? batchSizeFor(await limiter.effectiveMinInterval('discogs'));

  /**
   * How many rows the re-verification sweep may still take today.
   *
   * THE CAP IS ABOUT THE MAINTAINER'S TIME, not about money. Every
   * swept row that fails to auto-accept lands in the review queue —
   * which is a person's evening — so an uncapped sweep would refill a
   * queue somebody is trying to empty, faster than they can clear it,
   * while being individually correct about every row.
   *
   * Counted in KV against the date, so the count resets on its own and
   * nothing has to remember to clear it. A KV failure yields zero
   * allowance rather than infinite: the sweep is the optional half, and
   * the safe answer when the counter cannot be read is not to sweep.
   */
  const settings = await readSettings(env);
  const today = new Date().toISOString().slice(0, 10);
  const sweepKey = `sweep:${today}`;
  let sweptToday = 0;
  let sweepAllowance = 0;
  if (settings.reverify) {
    try {
      sweptToday = Number(await env.CACHE.get(sweepKey)) || 0;
      sweepAllowance = Math.max(0, settings.reverifyMaxPerDay - sweptToday);
    } catch { sweepAllowance = 0; }
  }
  // fetchImpl left to the client's own default ON PURPOSE: naming
  // fetch here would put an outbound call in a second file and break
  // the invariant that every upstream request goes through the one
  // rate-limited client. Only the clock is injected.
  const client = new DiscogsClient(env.DISCOGS_TOKEN, limiter, undefined, sleep);

  const found = await pendingRows(env, rowsThisTick,
    sweepAllowance > 0 ? { reverifyOlderThanDays: settings.reverifyMinDays } : {});
  // `pendingRows` tops the batch up to the tick size and does not know
  // the daily allowance; trimming here keeps that query about ordering
  // and this function about budget.
  const fresh = found.filter((r) => !r.lastRunAt);
  const swept = found.filter((r) => r.lastRunAt).slice(0, sweepAllowance);
  const rows = [...fresh, ...swept];
  if (swept.length) {
    // Written BEFORE the work, so a tick that dies half way through has
    // still spent its allowance. Over-counting a sweep costs a delay;
    // under-counting it costs the queue filling up unnoticed.
    try {
      await env.CACHE.put(sweepKey, String(sweptToday + swept.length), { expirationTtl: 172_800 });
    } catch { /* the cap degrades to per-tick, which is still a cap */ }
  }
  let rowsWritten = 0;
  let processed = 0;
  let stoppedShort = false;
  let queriesRun = 0;
  let queryErrors = 0;

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
    // Stop taking NEW rows once the invocation's outbound budget is
    // nearly gone. A row started with nothing left to spend produces an
    // error run and burns a claim for no information.
    if (client.budgetSpent?.()) {
      stoppedShort = true;
      break;
    }
    // Claimed before the search, so an invocation that overruns the
    // cron period cannot have the next tick pick the same row up.
    const runId = await claimRow(env, row.itemId);
    rowsWritten += 1;
    const result = await matchRow(row, client);
    rowsWritten += await persistRun(env, row, result, runId);
    processed += 1;
    queriesRun += result.outcome.queriesRun;
    queryErrors += result.outcome.queryErrors;
  }

  /**
   * Learn the pace rather than being told it.
   *
   * The interval was a number a person put in KV and tuned by hand,
   * three times in one day. The tick already knows how many of its
   * queries were refused, which is the only input that tuning ever
   * used — so it adjusts itself: wider fast when refused, narrower
   * slowly when clean, and never below the shipped floor.
   *
   * A tick that ran queries and got nothing but errors stops asking
   * for a while. That is the difference between traffic and useful
   * traffic.
   */
  const errorRate = queriesRun ? queryErrors / queriesRun : 0;
  let interval: number | undefined;
  if (queriesRun) {
    interval = await limiter.adjustAutoInterval('discogs', errorRate);
    if (queryErrors === queriesRun) await limiter.startCooldown('discogs', COOLDOWN_MS);
  }

  return { processed, rowsWritten, stoppedShort, interval, errorRate };
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => createApp().fetch(req, env, ctx),
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runMatchBatch(env).then(({
      processed, rowsWritten, stoppedShort, cooledDown, interval, errorRate,
    }) => {
      if (cooledDown) {
        console.log('match: in cooldown after a tick that reached nothing — not asking');
        return;
      }
      // Say when it stopped short. A tick that quietly did less than it
      // was asked to looks identical to a quiet night in the logs, and
      // the whole point of the budget is that someone notices.
      console.log(
        `match: processed ${processed} row(s), ${rowsWritten} row(s) written`
        + (errorRate !== undefined ? `, ${(errorRate * 100).toFixed(0)}% queries refused` : '')
        + (interval !== undefined ? `, pacing now ${interval}ms` : '')
        + (stoppedShort ? ` — STOPPED SHORT at the ${WRITE_BUDGET_PER_TICK}-write budget` : ''),
      );
    }));
  },
};
