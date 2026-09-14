import type { QueuedCapture } from './queue-logic.ts';
const DB_NAME = 'vinyl-photo-additions';
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
    let req: IDBRequest<T>;
    try { req = run(t.objectStore(STORE)); }
    catch (err) { db.close(); reject(err); return; }
    // A successful request can still be rolled back by a quota or disk
    // error at commit. Never tell capture it is saved until commit wins.
    let result: T;
    req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onabort = () => { db.close(); reject(t.error ?? req.error ?? new Error('Phone storage transaction was aborted')); };
    t.onerror = () => { /* onabort reports the transaction failure */ };
  }));
}

export const putEntry = (entry: QueuedCapture): Promise<IDBValidKey> =>
  tx('readwrite', (s) => s.put(entry) as IDBRequest<IDBValidKey>);

export const allEntries = (): Promise<QueuedCapture[]> =>
  tx('readonly', (s) => s.getAll() as IDBRequest<QueuedCapture[]>);

export const getEntry = (clientId: string): Promise<QueuedCapture | undefined> =>
  tx('readonly', (s) => s.get(clientId) as IDBRequest<QueuedCapture | undefined>);

