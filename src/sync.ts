/** Browser wiring for the tested, receipt-based upload controller. */
import { allEntries, putEntry } from './queue.ts';
import { createSyncController } from './sync-engine.ts';
import { trace } from './sync-debug.ts';

let onChange = (): void => {};
// Temporary incident retention: keep even confirmed records/photos for backup.
const controller = createSyncController({ allEntries, putEntry, pruneSynced: async () => {},
  fetch: (...args) => fetch(...args), onChange: () => onChange(), onEvent: trace });
export const syncError = controller.error;

export async function drain(now = Date.now(), forceRetry = false): Promise<{ sent: number; failed: number }> {
  // Avoid two tabs claiming the same queue. Older browsers remain safe
  // through expiring leases and the Worker's clientId idempotency.
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('vinyl-capture-upload', { ifAvailable: true },
      (lock) => { if (lock) return controller.run(now, forceRetry);
        trace('Upload deferred: another tab holds the upload lock'); return { sent: 0, failed: 0 }; });
  }
  return controller.run(now, forceRetry);
}

export function startSync(notify: () => void): void {
  onChange = notify;
  const tick = (): void => { void drain().then(notify).catch(err => { trace(`Upload could not start: ${String(err)}`); notify(); }); };
  setInterval(tick, 15_000);
  addEventListener('online', tick);
  addEventListener('offline', notify);
  addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
}
