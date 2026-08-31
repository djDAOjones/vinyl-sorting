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

/**
 * Cloudflare KV refuses any TTL below 60 seconds. The spacing key
 * naturally wants ~8 s, so it has to be floored — the value is
 * self-correcting anyway, since a stale timestamp only ever permits a
 * request that the window budget still counts.
 */
const KV_MIN_TTL_SECONDS = 60;
const ttl = (ms: number) => Math.max(KV_MIN_TTL_SECONDS, Math.ceil(ms / 1000));

export interface Budget {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Minimum gap between consecutive requests. A window budget alone
   * permits the whole allowance as an instantaneous burst, which is
   * what a Worker does — it fired twelve requests in a few hundred
   * milliseconds and Discogs answered 429. A laptop hides the fault,
   * because the round-trip paces the calls for you.
   */
  minIntervalMs: number;
}

/**
 * Discogs publishes 60/min, but the rate it actually enforces is lower
 * and it cares about spacing, not just volume — established the hard
 * way, twice: once in the earlier Windsurf CLI work, and again when the
 * deployed cron matcher failed every query while the same token from a
 * laptop had 59 requests remaining. One request per two seconds is the
 * figure that held, so the window budget is set to match rather than
 * to the published number.
 */
export const BUDGETS: Record<'discogs' | 'musicbrainz', Budget> = {
  discogs: { limit: 30, windowMs: 60_000, minIntervalMs: 2_000 },
  musicbrainz: { limit: 1, windowMs: 1_000, minIntervalMs: 1_000 },
};

export interface Decision {
  allowed: boolean;
  /** How long to wait before retrying, in ms. Zero when allowed. */
  retryAfterMs: number;
  remaining: number;
}

/** Key holding the timestamp of the last request to an upstream. */
const lastKey = (upstream: string) => `rl:${upstream}:last`;

/**
 * Key holding a tuning override for the minimum gap, in milliseconds.
 *
 * Exists so the pacing can be tuned WITHOUT A DEPLOY — set it with
 * `wrangler kv key put` and the next tick picks it up. Finding the
 * interval that holds from Cloudflare's shared egress is a
 * measure-and-adjust loop (M2-DISCOGS-PACING), and a loop whose every
 * step costs a deploy does not get run.
 */
export const minIntervalKey = (upstream: string) => `rl:${upstream}:min-interval`;

/**
 * Nothing may sit longer than this between requests; a fat-fingered
 * override should slow the matcher, never wedge it for an hour.
 *
 * 20s, lowered from 60s on 2026-08-31. The old figure was derived as
 * "5 queries x 60s = one cron period", but a row carrying a promoted
 * photo reading walks about twelve rungs, not five — so 60s would have
 * meant 720s for a single row against a 300s period, and that row
 * could never complete at all. 20s x 12 leaves a quarter of the period
 * spare.
 *
 * Kept as a literal rather than imported from the matcher: this module
 * is the one every upstream call funnels through, and it must not
 * depend on the thing it limits.
 */
export const MAX_MIN_INTERVAL_MS = 20_000;

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

  /**
   * The gap actually in force: the shipped budget, or a stored override
   * that WIDENS it.
   *
   * Widen-only, deliberately. The override exists to slow the matcher
   * down while the safe rate is being found; letting it narrow the gap
   * would mean one bad KV value could switch off the spacing that
   * stopped Discogs refusing us — a config typo turning into an
   * account-level throttle. Anything unparseable, negative, narrower
   * than the shipped default or wider than the cap is ignored in favour
   * of the default, because failing closed here costs only recall
   * whereas failing open costs the token.
   */
  async effectiveMinInterval(upstream: keyof typeof BUDGETS): Promise<number> {
    const floor = BUDGETS[upstream].minIntervalMs;
    const raw = await this.#store.get(minIntervalKey(upstream));
    if (raw === null) return floor;
    const wanted = Number(raw);
    if (!Number.isFinite(wanted)) return floor;
    if (wanted < floor || wanted > MAX_MIN_INTERVAL_MS) return floor;
    return wanted;
  }

  async take(upstream: keyof typeof BUDGETS): Promise<Decision> {
    const budget = BUDGETS[upstream];
    const t = this.#now();
    const minInterval = await this.effectiveMinInterval(upstream);

    // Spacing first. Without it the window budget is spent as a burst,
    // which is the shape of request that gets refused however modest
    // the per-minute total.
    const last = Number((await this.#store.get(lastKey(upstream))) ?? 0);
    const since = t - last;
    if (last && since < minInterval) {
      return { allowed: false, retryAfterMs: minInterval - since, remaining: -1 };
    }

    const windowStart = t - (t % budget.windowMs);
    const key = `rl:${upstream}:${windowStart}`;
    const used = Number((await this.#store.get(key)) ?? 0);
    if (used >= budget.limit) {
      return { allowed: false, retryAfterMs: windowStart + budget.windowMs - t, remaining: 0 };
    }

    await this.#store.put(key, String(used + 1), {
      // Outlive the window so a late read cannot resurrect a spent one.
      expirationTtl: ttl(budget.windowMs * 2),
    });
    await this.#store.put(lastKey(upstream), String(t), { expirationTtl: ttl(minInterval * 4) });
    return { allowed: true, retryAfterMs: 0, remaining: budget.limit - used - 1 };
  }
}
