/** Read-only ZIP export. Each readable photo is copied into independent bytes
 * so the finished archive does not depend on live IndexedDB blob handles. */
import type { QueuedCapture } from './queue-logic.ts';
const enc = new TextEncoder();
const LIMIT = 0xffffffff;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = LIMIT;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255]! ^ (crc >>> 8);
  return (crc ^ LIMIT) >>> 0;
}
export function backupParts(entries: QueuedCapture[], maxBytes = 32 * 1024 * 1024): QueuedCapture[][] {
  const parts: QueuedCapture[][] = []; let group: QueuedCapture[] = []; let size = 0;
  for (const entry of entries) {
    const bytes = entry.photos.reduce((n, p) => n + p.blob.size, 0);
    if (group.length && (group.length >= 20 || size + bytes > maxBytes)) { parts.push(group); group = []; size = 0; }
    group.push(entry); size += bytes;
  }
  if (group.length) parts.push(group);
  return parts;
}
export interface BackupIssue { clientId: string; photoIndex: number; key: string; error: string }
export interface BackupOptions {
  part: number; totalParts: number; origin: string; progress?: (done: number, total: number) => void;
  allowPartial?: boolean;
  readPhoto?: (entry: QueuedCapture, index: number) => Promise<ArrayBuffer>;
  onIssue?: (issue: BackupIssue) => void;
}
export function queueMetadata(entries: QueuedCapture[], origin: string): string {
  return JSON.stringify({ format: 'vinyl-capture-metadata', version: 1, exportedAt: new Date().toISOString(),
    origin, containsPhotoBytes: false, entryCount: entries.length,
    photoCount: entries.reduce((n, e) => n + e.photos.length, 0),
    entries: entries.map(({ photos, ...metadata }) => ({ ...metadata,
      photos: photos.map(p => ({ key: p.key, kind: p.kind, type: p.blob.type, size: p.blob.size, status: 'not-read' })) })) }, null, 2);
}
function header(size: number) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
export async function buildQueueBackupReport(entries: QueuedCapture[], options: BackupOptions): Promise<{
  blob: Blob; issues: BackupIssue[]; includedPhotoCount: number; sourcePhotoCount: number;
}> {
  const chunks: BlobPart[] = [], central: BlobPart[] = [];
  let offset = 0, centralSize = 0, fileCount = 0;
  const add = (name: string, blob: Blob, crc: number) => {
    const nameBytes = enc.encode(name), size = blob.size;
    if (size > LIMIT || offset + size + 30 + nameBytes.length > LIMIT || fileCount >= 65534) throw new Error('Backup part exceeds ZIP limits; use smaller parts.');
    const h = header(30); h.view.setUint32(0, 0x04034b50, true); h.view.setUint16(4, 20, true);
    h.view.setUint16(6, 0x800, true); h.view.setUint16(12, 33, true); // UTF-8, stored, 1980-01-01
    h.view.setUint32(14, crc, true); h.view.setUint32(18, size, true); h.view.setUint32(22, size, true); h.view.setUint16(26, nameBytes.length, true);
    const c = header(46); c.view.setUint32(0, 0x02014b50, true); c.view.setUint16(4, 20, true); c.view.setUint16(6, 20, true);
    c.view.setUint16(8, 0x800, true); c.view.setUint16(14, 33, true); c.view.setUint32(16, crc, true);
    c.view.setUint32(20, size, true); c.view.setUint32(24, size, true); c.view.setUint16(28, nameBytes.length, true); c.view.setUint32(42, offset, true);
    chunks.push(h.bytes, nameBytes, blob); central.push(c.bytes, nameBytes);
    offset += 30 + nameBytes.length + size; centralSize += 46 + nameBytes.length; fileCount++;
  };
  const rows = []; const issues: BackupIssue[] = []; let done = 0, includedPhotoCount = 0;
  const total = entries.reduce((n, e) => n + e.photos.length, 0);
  for (const [i, entry] of entries.entries()) {
    const { photos, ...metadata } = entry; const images = [];
    for (const [j, photo] of photos.entries()) {
      // Paths are generated, never derived from client-controlled keys.
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' } as Record<string, string>)[photo.blob.type] ?? 'bin';
      const path = `photos/${i + 1}/${j + 1}.${extension}`;
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = new Uint8Array(await (options.readPhoto ? options.readPhoto(entry, j) : photo.blob.arrayBuffer()));
        if (bytes.length !== photo.blob.size || !bytes.length) throw new Error(`Photo size check failed: expected ${photo.blob.size}, read ${bytes.length} bytes`);
      } catch (err) {
        const issue = { clientId: entry.clientId, photoIndex: j + 1, key: photo.key, error: String(err) };
        if (!options.allowPartial) throw new Error(`Cannot read record ${entry.clientId}, photo ${j + 1} (${photo.key}): ${String(err)}`);
        issues.push(issue); options.onIssue?.(issue);
        images.push({ key: photo.key, kind: photo.kind, type: photo.blob.type, size: photo.blob.size,
          status: 'unreadable', path: null, sha256: null, error: issue.error });
        options.progress?.(++done, total); continue;
      }
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
      const crc = crc32(bytes); add(path, new Blob([bytes], { type: photo.blob.type }), crc);
      images.push({ key: photo.key, kind: photo.kind, type: photo.blob.type, size: photo.blob.size, path, sha256, status: 'included' });
      includedPhotoCount++;
      options.progress?.(++done, total);
    }
    rows.push({ ...metadata, photos: images });
  }
  const manifest = enc.encode(JSON.stringify({ format: 'vinyl-capture-backup', version: 2,
    exportedAt: new Date().toISOString(), origin: options.origin, part: options.part, totalParts: options.totalParts,
    complete: issues.length === 0, entryCount: rows.length, photoCount: total, includedPhotoCount,
    missingPhotoCount: issues.length, issues, entries: rows }, null, 2));
  add('manifest.json', new Blob([manifest]), crc32(manifest));
  if (issues.length) {
    const report = enc.encode(JSON.stringify({ warning: 'INCOMPLETE: these photo bytes could not be read. Source records have not been changed.', issues }, null, 2));
    add('MISSING-PHOTOS.json', new Blob([report]), crc32(report));
  }
  const readme = enc.encode('Vinyl sorter device queue backup\n\nmanifest.json contains every saved field, client ID, state and original photo key.\nPhoto files are original bytes; MIME type and SHA-256 are in the manifest.\nEach ZIP part is independent. Keep all parts. This export does not delete or modify the phone queue.\nA technician can verify hashes and restore using the same client IDs to avoid duplicate records.\n');
  add('README.txt', new Blob([readme]), crc32(readme));
  if (offset + centralSize > LIMIT) throw new Error('Backup part exceeds ZIP limits.');
  const end = header(22); end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, fileCount, true); end.view.setUint16(10, fileCount, true);
  end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
  return { blob: new Blob([...chunks, ...central, end.bytes], { type: 'application/zip' }), issues, includedPhotoCount, sourcePhotoCount: total };
}

/** Strict compatibility helper: never silently returns an incomplete backup. */
export async function buildQueueBackup(entries: QueuedCapture[], options: BackupOptions): Promise<Blob> {
  return (await buildQueueBackupReport(entries, { ...options, allowPartial: false })).blob;
}
