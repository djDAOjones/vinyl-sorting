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
  kind: 'label_a' | 'label_b' | 'front' | 'back' | 'runout' | 'other';
  blob: Blob;
  /** Assigned client-side so an upload can be retried to the same key. */
  key: string;
}

/**
 * The kind every photograph taken in the app is stored as.
 *
 * Capture takes as many photographs of a record as it needs and does
 * not ask which is which. The maintainer's reasoning, and it is the
 * project's own rule pointed at the interface: "there will be no
 * consistency, so any attempt to ascribe information is dishonest and a
 * waste of time."
 *
 * The five specific kinds each make a claim — this is the side-A label,
 * the sleeve front, the deadwax. With nobody asserting any of them,
 * writing one would invent a fact, and nothing downstream could tell an
 * assumed `label_a` from a confirmed one. `other` claims nothing, which
 * is the only honest thing to say about a photograph nobody described.
 *
 * Order is kept in the R2 key instead, which is a fact about the
 * sequence rather than a claim about the content.
 */
export const CAPTURED_KIND = 'other';

/**
 * What to ask the camera for.
 *
 * Resolution is the whole point: the field this exists to read is a
 * catalogue number printed smaller than everything around it, and a
 * video frame is already a weaker image than the phone's own still —
 * no HDR, no multi-frame stacking. So ask for far more than the 2048 px
 * the photo is eventually stored at, and let the browser give what it
 * can. `ideal` rather than `exact` so a device that cannot manage 4K
 * hands back its best instead of failing outright.
 *
 * The ask ROSE WITH THE STORAGE SIZE, from 3840 to 4096. When
 * CAPTURE-GUIDANCE took the stored long edge from 1568 to 2048, a 3840
 * ask stopped being twice what is kept — and "far more than is stored"
 * is the property that keeps small print legible, so the number that
 * had to move was the ask, not the invariant. `ideal` costs nothing to
 * raise: a phone whose best video mode is 3840 still hands back 3840.
 */
export function videoConstraints(): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 4096 },
      height: { ideal: 3072 },
    },
    audio: false,
  };
}

/**
 * Whether this camera can hold its lamp on.
 *
 * `torch` is a continuous lamp rather than a shutter-synchronised
 * flash, which is what is wanted anyway: a label held under a steady
 * light can be framed before the shutter, where a flash fires after the
 * decision is made. Chrome on Android supports it; Safari on iOS does
 * not expose it at all, so the control has to be capability-gated
 * rather than shown and hoped for.
 */
export function torchSupported(capabilities: unknown): boolean {
  return Boolean(capabilities && typeof capabilities === 'object' && 'torch' in capabilities
    && (capabilities as { torch?: unknown }).torch);
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

/**
 * How long a filed disc is held back from the network so Undo is real.
 *
 * There is no un-queue once an entry has been sent — captures drain on
 * their own and the Worker has them for good — so the only honest undo
 * is one taken before the send. Five seconds is long enough to notice a
 * mis-tap on a control a thumb's width from the shutter and short
 * enough that nobody waits for it.
 */
export const UNDO_MS = 5_000;

/**
 * Queue an entry, but hold its first send until the undo window closes.
 *
 * The entry is on disk the instant it is written, so the offline
 * guarantee is untouched: only the SEND waits, and it waits in
 * `nextAttemptAt`, the field the drain already honours for backoff.
 * That is the whole mechanism — no new state, nothing to leak. A tab
 * closed inside the window leaves an ordinary pending entry that goes
 * out on the next tick.
 */
export function heldForUndo(entry: QueuedCapture, now: number): QueuedCapture {
  return { ...entry, nextAttemptAt: now + UNDO_MS };
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
 * pressure. That constraint is real and unchanged.
 *
 * IT WAS 1568, AND THIS COMMENT USED TO CLAIM "nothing downstream loses
 * anything". That is now known to be false. Item 481's catalogue number
 * is printed on the Ace of Clubs badge, in the right place, and is not
 * in the stored file: the resize took it. Cropping and enlarging the
 * badge finds the digits are simply gone (CAPTURE-GUIDANCE,
 * 2026-08-31).
 *
 * FRAMING IS THE DOMINANT FIX, NOT PIXELS, and the arithmetic says so.
 * A whole 12" disc at 1568 px puts the 4" label across ~520 px, so an
 * eight-character catalogue number gets ~16 px a character before JPEG
 * finishes it off. The same label FILLING the frame gets ~50 px a
 * character and is never in doubt. The guidance sheet buys more than
 * any resolution does, and costs nothing — which is why the number
 * moved one step rather than four.
 *
 * 2048 px is ~1.3 MB against 800 KB: ~70% more in a queue that has to
 * survive a loft with no signal, bought to restore the margin for a
 * shot framed in a hurry. Keeping a full-resolution original was
 * refused — roughly five times the storage to buy less than the
 * guidance gives away free.
 *
 * Neither half helps the 483 rows already photographed. Those are the
 * mop-up crate.
 */
export const PHOTO_LONG_EDGE = 2048;

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
 * NOTHING CALLS THESE TWO. Read this before you go looking.
 *
 * CAPTURE-ONE-SCREEN removed the crate-in-one-pass button and `saveBulk`
 * with it on 2026-08-31, and left the logic here. It is not broken, not
 * half-wired and not waiting on anything: there is simply no caller, and
 * the mode is retired on a reason that will not reverse — more than one
 * photograph of a disc is always wanted, so one row per photograph
 * manufactured three discs where one stood.
 *
 * They stay because deleting them deletes their tests, and "no
 * weakening or deleting tests" is a stop-and-ask boundary in AGENTS.md
 * that an autonomous session may not cross on its own judgement
 * (CAPTURE-BULK-REMNANT, 2026-08-31). Removing this block and its
 * assertions in `queue-logic.test.mjs` is the maintainer's to take, and
 * costs nothing either way — which is why it was not worth guessing at.
 *
 * ─────────────────────────────────────────────────────────────────
 *
 * The only fields a bulk capture carried from the form to every row.
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
 * The fields for the index-th photo of a bulk run. NO CALLER — see
 * `BULK_CARRIED` above.
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
