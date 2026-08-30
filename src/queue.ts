/**
 * IndexedDB storage for the capture queue. Deliberately thin: the
 * decisions live in queue-logic.ts, which is tested without a browser.
 *
 * Photos are stored as Blobs in IndexedDB alongside the entry, so a
 * capture taken with no signal is complete on disk — including its
 * image — and survives a hard refresh.
 */

import type { QueuedCapture } from './queue-logic.ts';

// Stays `deep-groove` after the 2026-08-30 rename, and must. This names
// the IndexedDB store on the phone: change it and every capture already
// queued on a device becomes unreachable — photographs taken in a loft
// with no signal, silently orphaned by a cosmetic edit. It is invisible
// to everyone.
const DB_NAME = 'deep-groove';
const STORE = 'captures';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientId' }).createIndex('state', 'state');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  }));
}

export const putEntry = (entry: QueuedCapture): Promise<IDBValidKey> =>
  tx('readwrite', (s) => s.put(entry) as IDBRequest<IDBValidKey>);

export const allEntries = (): Promise<QueuedCapture[]> =>
  tx('readonly', (s) => s.getAll() as IDBRequest<QueuedCapture[]>);

export const deleteEntry = (clientId: string): Promise<undefined> =>
  tx('readwrite', (s) => s.delete(clientId) as IDBRequest<undefined>);

/** Keep the last N synced entries for the median, discard the rest. */
export async function pruneSynced(keep = 50): Promise<void> {
  const synced = (await allEntries())
    .filter((e) => e.state === 'synced')
    .sort((a, b) => b.createdAt - a.createdAt);
  await Promise.all(synced.slice(keep).map((e) => deleteEntry(e.clientId)));
}
