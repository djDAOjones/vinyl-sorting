import { Hono } from 'hono';
import type { Env } from './env.ts';
import { insertCapture, parseCapture } from './capture.ts';

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
 * When M2 adds matching, that changes: a caller could then drive
 * queries against the maintainer's live token. M2-MATCHER records the
 * gate — add Access then, or keep matching strictly server-side as a
 * queued job with no caller-controlled query.
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

export default { fetch: (req: Request, env: Env, ctx: ExecutionContext) => createApp().fetch(req, env, ctx) };
