/**
 * Drains the offline queue to the Worker. Nothing in the capture path
 * ever awaits this: the UI's job is finished the moment an entry is on
 * disk, and syncing is a background concern that may fail for hours.
 */

import { allEntries, deleteEntry, putEntry, pruneSynced } from './queue.ts';
import {
  markFailed, selectDrainable, shouldStopDraining, toRequestBody, type QueuedCapture,
} from './queue-logic.ts';

const API = '/api';

/**
 * A send failure that knows whether it was about this entry or about
 * the world. `status` is null when the fetch never completed at all,
 * which is what being offline looks like from here.
 */
class SendError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

/** Fetch that turns an offline TypeError into a statusless SendError. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new SendError(err instanceof Error ? err.message : String(err), null);
  }
}

async function uploadPhotos(entry: QueuedCapture): Promise<void> {
  for (const photo of entry.photos) {
    const res = await send(`${API}/photos/${encodeURIComponent(photo.key)}`, {
      method: 'PUT',
      headers: { 'content-type': photo.blob.type || 'image/jpeg' },
      body: photo.blob,
    });
    // 201 on success. A 409-free design: the key is client-assigned, so
    // re-uploading the same photo overwrites itself harmlessly.
    if (!res.ok) throw new SendError(`photo ${photo.key}: HTTP ${res.status}`, res.status);
  }
}

async function sendOne(entry: QueuedCapture): Promise<void> {
  await uploadPhotos(entry);
  const res = await send(`${API}/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toRequestBody(entry)),
  });
  // The Worker is idempotent on clientId, so both 201 (created) and
  // 200 (already had it) mean the entry is safely stored.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new SendError(`capture: HTTP ${res.status} ${detail.slice(0, 120)}`, res.status);
  }
}

let running = false;

/**
 * One drain pass. Safe to call often — concurrent calls collapse into
 * the one already running.
 */
export async function drain(now = Date.now()): Promise<{ sent: number; failed: number }> {
  if (running) return { sent: 0, failed: 0 };
  running = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const entry of selectDrainable(await allEntries(), now)) {
      await putEntry({ ...entry, state: 'syncing' });
      try {
        await sendOne(entry);
        await putEntry({ ...entry, state: 'synced', lastError: undefined });
        sent++;
      } catch (err) {
        // The entry is never dropped. A failure schedules a retry.
        await putEntry(markFailed(entry, err instanceof Error ? err.message : String(err), Date.now()));
        failed++;
        // Offline or a server fault stops the pass — everything behind
        // this would fail identically, and burning the queue costs
        // battery for nothing. A fault in THIS entry does not stop it:
        // one photo the server refuses must not hold a crate of twenty
        // hostage behind it for ever.
        if (shouldStopDraining(err instanceof SendError ? err.status : null)) break;
      }
    }
    await pruneSynced();
  } finally {
    running = false;
  }
  return { sent, failed };
}

/** Retry on a timer, when the tab is shown, and when the browser reconnects. */
export function startSync(onChange: () => void): void {
  const tick = () => { void drain().then(onChange); };
  setInterval(tick, 15_000);
  addEventListener('online', tick);
  addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
}
