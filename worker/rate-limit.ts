/**
 * Central rate limiting. AGENTS.md: enforced centrally in the Worker,
 * never per caller — Discogs 50/min shared, MusicBrainz 1/sec with a
 * real user-agent. Two people cataloguing at once must not be able to
 * throttle the account between them.
 *
 * Built in M1 although nothing calls it yet, so M2 cannot skip it.
 *
 * The store is pluggable on purpose. KV is eventually consistent, so
 * two Workers can briefly both believe they hold the last token of a
 * window; that is tolerable at 50/min against a limit Discogs enforces
 * with 429s, and not tolerable if the limit ever has to be exact. When
 * M2 needs exactness, swap in a Durable Object — the interface below
 * is all it has to satisfy.
 */

export interface CounterStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts: { expirationTtl: number }): Promise<void>;
}

export interface Budget {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** The two upstreams, with the limits AGENTS.md fixes. */
export const BUDGETS: Record<'discogs' | 'musicbrainz', Budget> = {
  discogs: { limit: 50, windowMs: 60_000 },
  musicbrainz: { limit: 1, windowMs: 1_000 },
};

export interface Decision {
  allowed: boolean;
  /** How long to wait before retrying, in ms. Zero when allowed. */
  retryAfterMs: number;
  remaining: number;
}

/**
 * Fixed-window counter. Chosen over a sliding log because the state is
 * one integer per window rather than a list of timestamps, which is
 * what makes it cheap enough to share across isolates.
 */
export class RateLimiter {
  // Declared as fields rather than constructor parameter properties:
  // the project runs these files through Node's type stripping, which
  // only erases syntax and cannot synthesise assignments.
  readonly #store: CounterStore;
  readonly #now: () => number;

  constructor(store: CounterStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  async take(upstream: keyof typeof BUDGETS): Promise<Decision> {
    const budget = BUDGETS[upstream];
    const t = this.#now();
    const windowStart = t - (t % budget.windowMs);
    const key = `rl:${upstream}:${windowStart}`;

    const used = Number((await this.#store.get(key)) ?? 0);
    if (used >= budget.limit) {
      return { allowed: false, retryAfterMs: windowStart + budget.windowMs - t, remaining: 0 };
    }
    await this.#store.put(key, String(used + 1), {
      // Outlive the window so a late read cannot resurrect a spent one.
      expirationTtl: Math.ceil((budget.windowMs * 2) / 1000),
    });
    return { allowed: true, retryAfterMs: 0, remaining: budget.limit - used - 1 };
  }
}
