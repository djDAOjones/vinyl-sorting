/**
 * The offline queue's decisions, kept free of IndexedDB so they can be
 * tested without a browser. `queue.ts` is the thin storage adapter.
 *
 * Offline is a hard requirement, not a nicety: crates live in lofts
 * and garages. The UI never awaits the network, and a queued entry
 * survives a hard refresh.
 */

export type QueueState = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueuedPhoto {
  kind: 'label_a' | 'label_b' | 'front' | 'back' | 'runout';
  blob: Blob;
  /** Assigned client-side so an upload can be retried to the same key. */
  key: string;
}

export interface QueuedCapture {
  clientId: string;
  createdAt: number;
  /** Time from starting this disc to submitting it. The done-when is
   *  a measured median under 30 s, so the app measures itself. */
  msToCapture: number;
  fields: Record<string, string>;
  photos: QueuedPhoto[];
  state: QueueState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

/**
 * Exponential backoff, capped. A loft has no signal for as long as it
 * takes to walk out of it, so retrying every second is pure battery
 * drain; capping at five minutes means a returning connection is
 * noticed promptly without a thundering retry loop.
 */
export function nextBackoffMs(attempts: number): number {
  const base = 2_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 5 * 60_000);
}

/** Entries due for a sync attempt, oldest first so the queue drains in order. */
export function selectDrainable(entries: QueuedCapture[], now: number): QueuedCapture[] {
  return entries
    .filter((e) => (e.state === 'pending' || e.state === 'failed') && e.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** True median — with an even count, the mean of the middle two. */
export function medianMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2));
}

/** What the queue badge shows: how much work is outstanding. */
export function summarise(entries: QueuedCapture[]): {
  pending: number; failed: number; synced: number; medianMs: number | null;
} {
  return {
    pending: entries.filter((e) => e.state === 'pending' || e.state === 'syncing').length,
    failed: entries.filter((e) => e.state === 'failed').length,
    synced: entries.filter((e) => e.state === 'synced').length,
    medianMs: medianMs(entries.map((e) => e.msToCapture).filter((m) => m > 0)),
  };
}

/** Record a failed attempt without losing the entry. */
export function markFailed(entry: QueuedCapture, error: string, now: number): QueuedCapture {
  const attempts = entry.attempts + 1;
  return { ...entry, state: 'failed', attempts, lastError: error, nextAttemptAt: now + nextBackoffMs(attempts) };
}

/** Only the fields the Worker accepts; empty values are omitted entirely. */
export function toRequestBody(entry: QueuedCapture): Record<string, unknown> {
  const body: Record<string, unknown> = { clientId: entry.clientId };
  for (const [k, v] of Object.entries(entry.fields)) {
    const t = v.trim();
    if (t) body[k] = t;
  }
  if (entry.photos.length) {
    body.photos = entry.photos.map((p) => ({ kind: p.kind, r2Key: `labels/${p.key}` }));
  }
  return body;
}
