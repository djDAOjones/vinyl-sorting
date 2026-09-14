/** Verify photo bytes without changing a capture's human-entered fields. */
import { SYNC_LEASE_MS, UNDO_MS, type QueuedCapture } from './queue-logic.ts';
export type PhotoReader = (entry: QueuedCapture, index: number) => Promise<ArrayBuffer>;
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Photo verification timed out')), 15000);
  })]); } finally { clearTimeout(timer); }
}
export async function copyVerifiedPhotos(entry: QueuedCapture, reader?: PhotoReader): Promise<QueuedCapture> {
  const photos = [];
  for (const [i, p] of entry.photos.entries()) {
    try {
      const bytes = await bounded(reader ? reader(entry, i) : p.blob.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength !== p.blob.size) throw new Error('Photo bytes are empty or incomplete');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      if (p.sha256 && p.sha256 !== sha256) throw new Error('Photo checksum does not match its saved original');
      photos.push({ ...p, sha256, blob: new Blob([bytes], { type: p.blob.type }) });
    } catch (err) { throw new Error(`Record ${entry.clientId}, photo ${i + 1}: ${String(err)}`); }
  }
  return { ...entry, photos };
}
export async function putVerifiedCapture(entry: QueuedCapture, storage: {
  put: (entry: QueuedCapture) => Promise<unknown>;
  get: (id: string) => Promise<QueuedCapture | undefined>;
  now?: () => number;
}): Promise<void> {
  const now = storage.now ?? Date.now;
  const independent = await copyVerifiedPhotos(entry);
  const verify = async () => {
    const stored = await storage.get(entry.clientId);
    if (!stored || stored.targetItemId !== entry.targetItemId || stored.clientId !== entry.clientId || stored.photos.length !== independent.photos.length) throw new Error('The saved record could not be read back completely');
    if (JSON.stringify(stored.fields) !== JSON.stringify(independent.fields)) throw new Error('The saved record details did not match the entries in hand');
    const checked = await copyVerifiedPhotos(stored);
    for (const [i, p] of independent.photos.entries()) {
      if (checked.photos[i]?.key !== p.key || checked.photos[i]?.sha256 !== p.sha256) throw new Error(`Saved photo ${i + 1} did not match the photograph in hand`);
    }
  };
  // Hold the send while checking. An interrupted save is still retained and
  // can be preflight-checked by the uploader after this finite lease expires.
  await storage.put({ ...independent, nextAttemptAt: now() + SYNC_LEASE_MS });
  await verify();
  // Write from independent in-memory bytes, never a retrieved disk-backed Blob.
  await storage.put({ ...independent, nextAttemptAt: Math.max(entry.nextAttemptAt, now() + UNDO_MS) });
  await verify();
}
/** An item-number receipt alone does not prove that every photo was attached. */
export function completePhotoReceipt(entry: QueuedCapture, itemId: number, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as { item?: { id?: unknown; import_ref?: unknown }; captures?: unknown[]; photos?: { r2_key?: unknown }[] };
  if (v.item?.id !== itemId || (entry.targetItemId ? entry.targetItemId !== itemId : v.item.import_ref !== `capture:${entry.clientId}`) || (!entry.targetItemId && (!Array.isArray(v.captures) || !v.captures.length)) || !Array.isArray(v.photos)) return false;
  const keys = new Set(v.photos.map(p => p?.r2_key));
  return entry.photos.every(p => keys.has(`labels/${p.key}`));
}
