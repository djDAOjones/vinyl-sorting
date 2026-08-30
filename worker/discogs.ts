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
export const USER_AGENT = 'DeepGroove/0.1 +https://github.com/djDAOjones/vinyl-sorting';

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

  constructor(token: string, limiter: RateLimiter, fetchImpl: typeof fetch = fetch) {
    this.#token = token;
    this.#limiter = limiter;
    this.#fetch = fetchImpl;
  }

  async #get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const decision = await this.#limiter.take('discogs');
    if (!decision.allowed) {
      throw new DiscogsError(429, `rate limited locally; retry in ${decision.retryAfterMs}ms`);
    }
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

    const res = await this.#fetch(url.toString(), {
      headers: { Authorization: `Discogs token=${this.#token}`, 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new DiscogsError(res.status, `${path} -> HTTP ${res.status}`);
    return res.json();
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
