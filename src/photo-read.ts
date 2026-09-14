/** Bounded, read-only Safari recovery. Never writes a replacement blob. */
import { getEntry } from './queue.ts';
import type { QueuedCapture } from './queue-logic.ts';
import { trace } from './sync-debug.ts';
async function deadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after 10 seconds`)), 10000);
  })]); } finally { clearTimeout(timer); }
}
function fileReaderBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => { reader.abort(); reject(new Error('FileReader timed out after 10 seconds')); }, 10000);
    reader.onload = () => { clearTimeout(timer); reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('FileReader returned no bytes')); };
    reader.onerror = () => { clearTimeout(timer); reject(reader.error ?? new Error('FileReader failed')); };
    reader.onabort = () => { clearTimeout(timer); reject(new Error('FileReader aborted')); };
    try { reader.readAsArrayBuffer(blob); } catch (err) { clearTimeout(timer); reject(err); }
  });
}
export async function readStoredPhoto(entry: QueuedCapture, index: number): Promise<ArrayBuffer> {
  const photo = entry.photos[index]!;
  const label = `record ${entry.clientId}, photo ${index + 1}, key ${photo.key}`;
  trace(`Reading ${label}: ${photo.blob.size} bytes`);
  let first: string;
  try { return await deadline(photo.blob.arrayBuffer(), 'Blob read'); }
  catch (err) { first = String(err); trace(`Blob read failed for ${label}: ${first}`); }
  // Reacquire a fresh handle after Safari returns from its share sheet, and
  // use the alternative reader. Failure stays explicit in the ZIP manifest.
  try {
    const fresh = await deadline(getEntry(entry.clientId), 'Fresh record read');
    const retry = fresh?.photos.find(p => p.key === photo.key);
    if (!retry) throw new Error('Photo reference not found in fresh record read');
    const bytes = await fileReaderBytes(retry.blob); trace(`Fresh FileReader recovered ${label}`); return bytes;
  } catch (err) { throw new Error(`${label}: Blob read: ${first}; fresh FileReader: ${String(err)}`); }
}
