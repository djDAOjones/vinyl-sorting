import type { MiddlewareHandler } from 'hono';
import type { Env } from './env.ts';

export const dailyReadLimit = (error: unknown): boolean =>
  /D1.*(?:daily row read limit|rows read limit)/i.test(String(error));
export function allowanceReset(now = Date.now()): string {
  const date = new Date(now); date.setUTCHours(24, 0, 0, 0); return date.toISOString();
}
export function collectionCacheKey(path: string, query: Record<string, string>): string | null {
  if (path === '/api/lists') return '_system/collection-cache/v1/lists.json';
  if (path !== '/api/items') return null;
  const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
  const after = Number(query.after ?? 0) || 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(after) || after < 0) return null;
  return `_system/collection-cache/v1/items-${after}-${limit}.json`;
}

/** A failed live read may serve the last successful public list response.
 * Only these two read routes are cached: never details, photos or writes.
 * R2 is independent of the database allowance; snapshots are explicitly dated.
 */
export const collectionCache: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const key = c.req.method === 'GET' ? collectionCacheKey(c.req.path, c.req.query()) : null;
  await next();
  if (!key || !c.env.PHOTOS) return;
  if (c.res.status === 200) {
    try {
      const body = await c.res.clone().json();
      await c.env.PHOTOS.put(key, JSON.stringify({ savedAt: new Date().toISOString(), body }),
        { httpMetadata: { contentType: 'application/json' } });
    } catch { /* Cache failure must never turn a successful live read into an outage. */ }
  } else if (c.res.status >= 500) {
    try {
      const failure = await c.res.clone().json() as { code?: string; resumesAt?: string };
      const object = await c.env.PHOTOS.get(key);
      if (!object) return;
      const saved = await new Response(object.body).json() as { savedAt: string; body: Record<string, unknown> };
      if (!saved.body || !Number.isFinite(Date.parse(saved.savedAt))) return;
      c.res = c.json({ ...saved.body, snapshot: { savedAt: saved.savedAt,
        reason: failure.code === 'daily-read-limit' ? 'daily-read-limit' : 'unavailable',
        resumesAt: failure.resumesAt ?? null } });
      c.header('Cache-Control', 'no-store');
    } catch { /* Preserve the service error if no usable snapshot exists. */ }
  }
};
