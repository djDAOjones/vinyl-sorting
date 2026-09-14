/** Photo follow-up uses namespaced raw metadata, never capture or release fields. */
import type { Env } from './env.ts';
import { parseCapture } from './capture.ts';
export const REQUEST_PREFIX = 'photo-request:';
export interface PhotoRequest { id: string; reason: string; requestedBy: string; requestedAt: string; afterPhotoId: number; resolvedBy?: string; resolvedAt?: string }
export async function photoRequests(env: Env, id: number): Promise<PhotoRequest[]> {
  const { results } = await env.DB.prepare("SELECT value FROM raw_value WHERE item_id = ? AND field LIKE 'photo-request:%' ORDER BY id").bind(id).all<{value: string}>();
  return results.map(r => JSON.parse(r.value) as PhotoRequest);
}
export async function requestPhoto(env: Env, id: number, body: Record<string, unknown>, who: string): Promise<PhotoRequest | string> {
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) return 'Invalid request ID';
  const field = REQUEST_PREFIX + requestId;
  const old = await env.DB.prepare('SELECT value FROM raw_value WHERE item_id = ? AND field = ?').bind(id, field).first<{value: string}>();
  if (body.action === 'resolve') {
    if (!old) return 'Photo request not found';
    const request = JSON.parse(old.value) as PhotoRequest;
    if (request.resolvedAt) return request;
    const added = await env.DB.prepare('SELECT id FROM item_photo WHERE item_id = ? AND id > ? LIMIT 1').bind(id, request.afterPhotoId).first();
    if (!added) return 'Add the requested photo online before marking it checked';
    request.resolvedBy = who; request.resolvedAt = new Date().toISOString();
    await env.DB.prepare('UPDATE raw_value SET value = ? WHERE item_id = ? AND field = ?').bind(JSON.stringify(request), id, field).run();
    return request;
  }
  if (body.action !== 'request') return 'Unknown photo request action';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 300) return 'Describe the photograph needed in 1–300 characters';
  if (old) {
    const previous = JSON.parse(old.value) as PhotoRequest;
    return previous.reason === reason ? previous : 'Request ID already used';
  }
  const last = await env.DB.prepare('SELECT MAX(id) AS id FROM item_photo WHERE item_id = ?').bind(id).first<{id: number | null}>();
  const request: PhotoRequest = { id: requestId, reason, requestedBy: who, requestedAt: new Date().toISOString(), afterPhotoId: last?.id ?? 0 };
  await env.DB.prepare('INSERT INTO raw_value (item_id, field, value) VALUES (?, ?, ?) ON CONFLICT (item_id, field) DO NOTHING').bind(id, field, JSON.stringify(request)).run();
  return request;
}
export async function attachPhotos(env: Env, id: number, body: unknown): Promise<string | null> {
  const parsed = parseCapture(body, []);
  if (!parsed.ok) return parsed.error;
  const photos = parsed.value.photos ?? [];
  if (!photos.length || photos.length > 20) return 'Add between 1 and 20 photographs';
  if (!env.PHOTOS) return 'Photo storage unavailable';
  for (const photo of photos) {
    const owner = await env.DB.prepare('SELECT item_id FROM item_photo WHERE r2_key = ?').bind(photo.r2Key).first<{item_id: number}>();
    if (owner && owner.item_id !== id) return 'A photograph already belongs to another record';
    const object = await env.PHOTOS.get(photo.r2Key);
    if (!object || !object.size) return 'A photograph has not reached online storage';
    await object.body.cancel();
  }
  await env.DB.batch(photos.map(p => env.DB.prepare('INSERT INTO item_photo (item_id, kind, r2_key) VALUES (?, ?, ?) ON CONFLICT (r2_key) DO NOTHING').bind(id, p.kind, p.r2Key)));
  for (const p of photos) {
    const row = await env.DB.prepare('SELECT item_id FROM item_photo WHERE r2_key = ?').bind(p.r2Key).first<{item_id: number}>();
    if (row?.item_id !== id) return 'Photograph attachment could not be confirmed';
  }
  return null;
}
