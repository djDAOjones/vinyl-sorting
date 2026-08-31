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

/**
 * Outbound attempts one invocation may spend.
 *
 * Cloudflare allows 50 subrequests per invocation on the Free plan.
 * 36 leaves headroom for the release fetches an accepted match makes
 * after the ladder, and for anything else the tick does — the cap is
 * per INVOCATION, not per client, so spending it all on search would
 * kill the write that records the result.
 */
export const SUBREQUEST_BUDGET = 36;

/**
 * Attempts one query may cost.
 *
 * `#get` retries a 429 up to four times, so a query is not one
 * subrequest — it is up to four. Exported because `batchSizeFor` was
 * sizing the batch as though every query succeeded first time: three
 * rows at twelve queries came to exactly the 36-attempt budget with
 * NOTHING left for a retry, so the first throttled query ate the next
 * row's allowance. Items 451 and 466 spent the whole budget on nine
 * queries on 2026-08-31, which is 3.7 attempts each.
 */
export const MAX_ATTEMPTS_PER_QUERY = 4;

export class DiscogsClient {
  readonly #token: string;
  readonly #limiter: RateLimiter;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  /**
   * Outbound HTTP attempts made by this client, and the ceiling.
   *
   * Cloudflare caps subrequests PER INVOCATION — 50 on the Free plan —
   * and that is a different wall from the Discogs rate limit. Spacing
   * requests further apart does not help: the cap counts requests, not
   * time. On 2026-08-31 a single row spent twelve ladder rungs at up to
   * four retry attempts each and hit it, killing the whole invocation
   * with "Too many subrequests by single Worker invocation".
   *
   * Counted here because this is the one file that makes an outbound
   * request, so it is the only place the number can be right. Every
   * ATTEMPT counts, including retries — a retried 429 is a subrequest
   * to Cloudflare however it looks to Discogs.
   */
  #attempts = 0;
  #budget: number;

  /** Attempts spent so far this invocation. */
  get attempts(): number { return this.#attempts; }

  /**
   * True once the ladder should stop rather than risk killing the tick.
   *
   * Declared optional at the call sites: a client that does not track a
   * budget genuinely has none, and requiring every test double to grow
   * this method would be the tail wagging the dog.
   */
  budgetSpent(): boolean { return this.#attempts >= this.#budget; }

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
    budget: number = SUBREQUEST_BUDGET,
  ) {
    this.#token = token;
    this.#limiter = limiter;
    this.#fetch = fetchImpl;
    this.#sleep = sleep;
    this.#budget = budget;
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
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_QUERY; attempt++) {
      // Refused BEFORE the request, so the invocation survives to write
      // what it already found. Hitting Cloudflare's cap instead kills
      // the whole tick and loses every row in it.
      if (this.budgetSpent()) {
        throw new DiscogsError(429, `${path} -> subrequest budget spent (${this.#attempts})`);
      }
      this.#attempts += 1;
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
    throw new DiscogsError(429, `${path} -> throttled by Discogs after ${MAX_ATTEMPTS_PER_QUERY} attempts`);
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
