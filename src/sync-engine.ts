/** Upload state machine, independent of browser storage for failure testing. */
import { captureReceipt, markFailed, recoverInterrupted, selectDrainable, shouldStopDraining,
  SYNC_LEASE_MS, toRequestBody, type QueuedCapture } from './queue-logic.ts';
import { copyVerifiedPhotos, type PhotoReader } from './verified-photos.ts';

type Send = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; body: string }>;

interface SyncOptions {
  allEntries: () => Promise<QueuedCapture[]>;
  putEntry: (entry: QueuedCapture) => Promise<unknown>;
  pruneSynced: () => Promise<void>;
  fetch: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  onChange?: () => void;
  onEvent?: (message: string) => void;
  readPhoto?: PhotoReader;
  headers?: () => Record<string, string>;
  verifyReceipt?: (entry: QueuedCapture, itemId: number, send: Send) => Promise<boolean>;
}
class SendError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) { super(message); this.status = status; }
}
export function createSyncController(opts: SyncOptions) {
  let running = false;
  let lastError: string | null = null;
  const now = opts.now ?? Date.now;
  const changed = (): void => { opts.onChange?.(); };
  const event = (message: string): void => { try { opts.onEvent?.(message); } catch { /* diagnostics cannot block uploads */ } };
  const send = async (url: string, init: RequestInit) => {
    const started = now(); event(`${init.method} ${url} started; bytes=${init.body instanceof Blob ? init.body.size : String(init.body ?? '').length}`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await opts.fetch(url, { ...init, signal: controller.signal });
          event(`${init.method} ${url} HTTP ${response.status}; headers after ${now() - started}ms`);
          // Include reading the receipt/error body in the deadline.
          return { ok: response.ok, status: response.status, body: await response.text() };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new SendError('Upload timed out. The entry is still saved on this device.', null));
          }, opts.timeoutMs ?? 45_000);
        }),
      ]);
    } catch (err) {
      event(`${init.method} ${url} failed after ${now() - started}ms: ${String(err)}`);
      if (err instanceof SendError) throw err;
      throw new SendError(err instanceof Error ? err.message : 'Network upload failed', null);
    } finally { clearTimeout(timer); }
  };
  const run = async (at = now(), forceRetry = false): Promise<{ sent: number; failed: number }> => {
    if (running) return { sent: 0, failed: 0 };
    running = true;
    let sent = 0; let failed = 0;
    let unreadable = 0;
    lastError = null;
    try {
      let entries = recoverInterrupted(await opts.allEntries(), at);
      if (forceRetry) entries = entries.map((e) => e.state === 'failed' ? { ...e, nextAttemptAt: at } : e);
      for (const queued of selectDrainable(entries, at)) {
        let entry: QueuedCapture;
        try { entry = await copyVerifiedPhotos(queued, opts.readPhoto); }
        catch (err) {
          // Do not rewrite an unreadable stored Blob just to mark a retry.
          // Leave it intact for recovery and continue with healthy entries.
          failed++; unreadable++;
          lastError = `${unreadable} queued ${unreadable === 1 ? 'entry has' : 'entries have'} unreadable photos. Pause and open Save queued work. Keep this device data.`;
          event(`${lastError} ${String(err)}`); changed(); continue;
        }
        const renew = () => opts.putEntry({ ...entry, state: 'syncing', nextAttemptAt: now() + SYNC_LEASE_MS });
        await renew(); changed();
        try {
          for (const photo of entry.photos) {
            const res = await send(`/api/photos/${encodeURIComponent(photo.key)}`, {
              method: 'PUT', headers: { 'content-type': photo.blob.type || 'image/jpeg' }, body: photo.blob,
            });
            if (!res.ok) throw new SendError(`Photo upload: HTTP ${res.status}. ${res.body.slice(0, 160)}`, res.status);
            let receipt: { r2Key?: unknown } = {};
            try { receipt = JSON.parse(res.body); } catch { /* require the photo receipt below */ }
            if (receipt?.r2Key !== `labels/${photo.key}`) {
              throw new SendError('The server did not confirm the photograph. Entry kept for retry.', null);
            }
            await renew();
          }
          const res = await send(entry.targetItemId ? `/api/items/${entry.targetItemId}/photos` : '/api/captures', { method: 'POST',
            headers: { 'content-type': 'application/json', ...opts.headers?.() }, body: JSON.stringify(entry.targetItemId ? { clientId: entry.clientId, photos: entry.photos.map(p => ({kind: p.kind, r2Key: `labels/${p.key}`})) } : toRequestBody(entry)) });
          if (!res.ok) throw new SendError(`Record upload: HTTP ${res.status}. ${res.body.slice(0, 160)}`, res.status);
          let receipt: unknown;
          try { receipt = JSON.parse(res.body); } catch { /* invalid receipt is a failure below */ }
          const serverItemId = captureReceipt(receipt);
          if (serverItemId === null) throw new SendError('The server did not confirm a record number. Entry kept for retry.', null);
          if (opts.verifyReceipt && !await opts.verifyReceipt(entry, serverItemId, send)) {
            throw new SendError('The server record does not confirm every expected photograph. Keep the local backup and review the upload details.', 409);
          }
          await opts.putEntry({ ...entry, state: 'synced', serverItemId, syncedAt: now(), lastError: undefined });
          sent++; changed();
          event(`Confirmed ${entry.clientId} as server item ${serverItemId}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          event(`Kept ${entry.clientId} for retry: ${message}`);
          await opts.putEntry(markFailed(entry, message, now()));
          failed++; changed();
          if (shouldStopDraining(err instanceof SendError ? err.status : null)) break;
        }
      }
      await opts.pruneSynced();
    } catch (err) {
      lastError = `Phone storage could not update the upload queue: ${err instanceof Error ? err.message : String(err)}`;
    } finally { running = false; changed(); }
    return { sent, failed };
  };
  return { run, error: () => lastError };
}
