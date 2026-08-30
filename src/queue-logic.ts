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

/**
 * The photo kinds, in the order a person meets them, with the words the
 * interface uses for each.
 *
 * One frame often cannot hold what a record needs to say: the
 * catalogue number is on the centre label and the title is on the
 * sleeve, and on a boxed set they may be three surfaces apart. The
 * schema always allowed many photos per item — `item_photo` is a table,
 * not a column — and the Worker always stored an array. Only the form
 * insisted on exactly one.
 *
 * Each kind is used at most once per item, which keeps the R2 keys
 * unique without inventing a counter, and keeps the labels honest: a
 * sleeve back photographed as `label_b` would assert something untrue,
 * which is the fault the location fields were just fixed for.
 */
export const PHOTO_KINDS = [
  { kind: 'label_a', label: 'Label' },
  { kind: 'label_b', label: 'Label B' },
  { kind: 'front', label: 'Sleeve front' },
  { kind: 'back', label: 'Sleeve back' },
  { kind: 'runout', label: 'Runout' },
] as const;

/** The kind the big button always takes or retakes. */
export const PRIMARY_KIND = 'label_a';

/** Kinds not yet photographed, in order — what the add-buttons offer. */
export function unusedKinds(taken: readonly string[]): { kind: string; label: string }[] {
  return PHOTO_KINDS.filter((k) => k.kind !== PRIMARY_KIND && !taken.includes(k.kind));
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

/**
 * The long edge a queued photo is downscaled to, and why it is this.
 *
 * A phone frame is around 4 MB, so a crate of twenty is ~80 MB sitting
 * in IndexedDB — on a phone, in a loft, where iOS evicts under storage
 * pressure. 1568 px lands near 800 KB and is what the chat pack sends
 * anyway, so nothing downstream loses anything.
 */
export const PHOTO_LONG_EDGE = 1568;

/**
 * Target dimensions for a downscale, or null when the image is already
 * small enough. Separated from the canvas work so the arithmetic is
 * testable without a browser.
 */
export function scaleTo(width: number, height: number, longEdge = PHOTO_LONG_EDGE):
{ width: number; height: number } | null {
  const long = Math.max(width, height);
  if (!Number.isFinite(long) || long <= 0 || long <= longEdge) return null;
  const ratio = longEdge / long;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/**
 * The only fields a bulk capture carries from the form to every row.
 *
 * Everything else on that form is a claim about ONE disc — its
 * catalogue number, its label, its condition. Copying a catalogue
 * number across twenty rows would manufacture nineteen false values of
 * exactly the kind M0 measured, and they would be indistinguishable
 * from typed ones. Crate is where you are standing, position is
 * countable, and who is capturing does not change between shots.
 */
export const BULK_CARRIED = ['crate', 'position', 'capturedBy'] as const;

/**
 * The fields for the index-th photo of a bulk run.
 *
 * Position auto-increments ONLY from a number the person actually
 * typed. Blank stays blank: photographing in shelf order does make
 * positions sequential, but inventing the starting point would be a
 * guess, and this project's whole rule is that a wrong value costs more
 * than an absent one. Typing 1 before a crate of twenty gets 1–20.
 */
export function bulkFields(base: Record<string, string>, index: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BULK_CARRIED) {
    const v = (base[key] ?? '').trim();
    if (v) out[key] = v;
  }
  const start = Number.parseInt(out.position ?? '', 10);
  if (Number.isFinite(start)) out.position = String(start + index);
  else delete out.position;
  return out;
}

/**
 * Whether a failed send should stop the drain or let it move on.
 *
 * Stopping on every failure is right for one entry and wrong for a
 * crate: a single photo the server refuses would hold nineteen good
 * ones hostage for ever, retrying behind it. So the split is by cause.
 * No status means the fetch never completed — offline, and everything
 * behind it fails identically. 5xx is the server or a missing binding,
 * equally shared. 4xx is about THIS entry alone.
 */
export function shouldStopDraining(status: number | null): boolean {
  if (status === null) return true;
  return status >= 500;
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
