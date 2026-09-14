import { allEntries, putEntry } from './photo-addition-store.ts';
import { createSyncController } from './sync-engine.ts';
import { readStoredPhoto } from './photo-read.ts';
import { completePhotoReceipt } from './verified-photos.ts';
import { storedCapturer } from './who.ts';
import { trace } from './sync-debug.ts';
let notify = () => {};
const headers = (): Record<string, string> => { let token=''; try { token=localStorage.getItem('dg.edit') ?? ''; } catch { /* upload remains local */ } return { 'x-edit-token': token, 'x-capturer': storedCapturer() ?? '' }; };
const controller = createSyncController({ allEntries, putEntry, pruneSynced: async () => {},
  fetch: (...args) => fetch(...args), headers, readPhoto: readStoredPhoto,
  onChange: () => notify(), onEvent: trace,
  verifyReceipt: async (entry, id, send) => {
    const res = await send(`/api/items/${id}`, { method: 'GET', headers: { 'x-capturer': storedCapturer() ?? '' }, cache: 'no-store' });
    try { return res.ok && completePhotoReceipt(entry, id, JSON.parse(res.body)); } catch { return false; }
  },
});
export const additionError = controller.error;
export async function drainAdditions(force = false) {
  if (!headers()['x-edit-token'] || !storedCapturer()) { notify(); return {sent: 0, failed: 0}; }
  if (navigator.locks) return navigator.locks.request('vinyl-photo-addition-upload', {ifAvailable: true}, lock => lock ? controller.run(Date.now(), force) : {sent: 0, failed: 0});
  return controller.run(Date.now(), force);
}
export function startAdditions(callback: () => void) {
  notify = callback;
  const tick = () => { void drainAdditions().catch(err => { trace(String(err)); notify(); }); };
  setInterval(tick, 15000); addEventListener('online', tick);
  addEventListener('visibilitychange', () => { if (!document.hidden) tick(); }); tick();
}
