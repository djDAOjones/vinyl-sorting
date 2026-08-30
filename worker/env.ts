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
  PHOTOS: R2Bucket;
  CACHE: KVNamespace;
  /** Set with `wrangler secret put DISCOGS_TOKEN`. Unused until M2. */
  DISCOGS_TOKEN?: string;
}
