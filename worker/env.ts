/**
 * Bindings the Worker is given. DISCOGS_TOKEN is declared here so the
 * type system knows it exists, and is deliberately unused for the
 * whole of M1: capture is a person typing what is printed on a label,
 * so nothing in the capture path needs Discogs.
 *
 * That matters because v1 has no sign-in. An unauthenticated Worker
 * that could reach Discogs on a caller's behalf would let anyone spend
 * the maintainer's rate limit through their credential. The token is
 * unreachable here not by policy but because no route touches it —
 * `worker.test.mjs` asserts it.
 */
export interface Env {
  DB: D1Database;
  /**
   * Absent until R2 is enabled in the Cloudflare dashboard, which the
   * API cannot do for you. The Worker deploys and serves everything
   * else without it; photo uploads answer 503 and the phone keeps them
   * queued, so nothing is lost by turning R2 on later.
   */
  PHOTOS?: R2Bucket;
  CACHE: KVNamespace;
  /** The built client. Static assets are matched before the Worker runs. */
  ASSETS?: Fetcher;
  /** Set with `wrangler secret put DISCOGS_TOKEN`. Unused until M2. */
  DISCOGS_TOKEN?: string;
  /**
   * The shared passphrase on the edit endpoints, set with
   * `wrangler secret put EDIT_TOKEN` (DATASET-EDIT, maintainer sign-off
   * 2026-08-31). Unset means editing is UNAVAILABLE, never open: an
   * absent secret must not read as an unlocked door.
   */
  EDIT_TOKEN?: string;
}
