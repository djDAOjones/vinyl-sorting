/**
 * Discogs client. Every call goes through the central rate limiter —
 * AGENTS.md fixes the limits and forbids per-caller limiting, so two
 * people cataloguing at once cannot throttle the account between them.
 *
 * The token never leaves this module. Callers pass structured
 * parameters; there is no method that forwards an arbitrary URL or
 * query string, because with no sign-in there is no caller to trust.
 */

import type { RateLimiter } from './rate-limit.ts';

const BASE = 'https://api.discogs.com';

/** Discogs requires a descriptive user-agent and blocks generic ones. */
export const USER_AGENT = 'VinylSorter/0.1 +https://github.com/djDAOjones/vinyl-sorting';

export interface SearchResult {
  id: number;
  catno?: string;
  label?: string[];
  title?: string;
  year?: string | number;
  format?: string[];
  country?: string;
  uri?: string;
}

export class DiscogsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'DiscogsError';
  }
}

export class DiscogsClient {
  readonly #token: string;
  readonly #limiter: RateLimiter;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  /**
   * `fetchImpl` defaults to a WRAPPER around the global fetch, not to
   * the global itself. Storing the bare global on a field and calling
   * it as `this.#fetch(...)` detaches it from globalThis, and the
   * Workers runtime rejects that with "Illegal invocation: function
   * called with incorrect `this` reference". Node's fetch tolerates it,
   * so this only appeared once deployed — the production cron failed
   * all 12 queries on its first real row.
   */
  constructor(
    token: string,
    limiter: RateLimiter,
    fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => { setTimeout(r, ms); }),
  ) {
    this.#token = token;
    this.#limiter = limiter;
    this.#fetch = fetchImpl;
    this.#sleep = sleep;
  }

  /**
   * Wait for the shared budget rather than failing on it. Throwing here
   * made the matcher report "nothing found" for rows it never actually
   * searched — the local limiter refused, the caller swallowed the
   * error, and 53 rows out of 60 were silently marked unmatched.
   */
  async #awaitBudget(): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const decision = await this.#limiter.take('discogs');
      if (decision.allowed) return;
      await this.#sleep(Math.min(decision.retryAfterMs + 50, 65_000));
    }
    throw new DiscogsError(429, 'shared Discogs budget unavailable after waiting');
  }

  async #get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

    // Discogs enforces its own limit too, and answers 429 with a
    // Retry-After. Honour it rather than hammering.
    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.#awaitBudget();
      const res = await this.#fetch(url.toString(), {
        headers: { Authorization: `Discogs token=${this.#token}`, 'User-Agent': USER_AGENT },
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        await this.#sleep(retryAfter > 0 ? retryAfter * 1000 : 2_000 * attempt);
        continue;
      }
      if (!res.ok) throw new DiscogsError(res.status, `${path} -> HTTP ${res.status}`);
      return res.json();
    }
    throw new DiscogsError(429, `${path} -> throttled by Discogs after 4 attempts`);
  }

  /**
   * Structured search only. `params` is built by the query ladder from
   * stored values, never from a request.
   */
  async search(params: Record<string, string>): Promise<SearchResult[]> {
    const body = await this.#get('/database/search', { ...params, type: 'release', per_page: '20' }) as
      { results?: SearchResult[] };
    return body.results ?? [];
  }

  async getRelease(id: number): Promise<Record<string, unknown>> {
    return await this.#get(`/releases/${id}`) as Record<string, unknown>;
  }
}
