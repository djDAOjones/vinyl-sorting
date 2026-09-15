import type { Env } from './env.ts';
import type { QueryInput } from './match/queries.ts';
import { MATCH_COLUMNS, MATCH_FROM } from './match/input.ts';
import { checkRow } from './match/sanity.ts';
import { requestMatch } from './match/recovery.ts';
import { musicbrainzQueries, previewMusicBrainz, type MBPreview } from './musicbrainz.ts';

const PREFIX = '_system/source-preparation/';
const CURSOR = 'source-preparation:cursor:v1';
const MAX_ATTEMPTS = 3;
export interface SourceEvidence {
  inputKey: string; status: 'running' | 'ready' | 'incomplete' | 'paused';
  attempts: number; updatedAt: string; retryAt: string | null;
  preview?: MBPreview; retainedPreview?: MBPreview; error?: string;
}
export interface SourcePreparation {
  status: 'waiting' | 'needs-details' | 'settled' | 'unavailable' | SourceEvidence['status'];
  evidence?: SourceEvidence;
}

/** Canonical saved readings only. A release cannot corroborate its own match. */
export function sourceInput(input: QueryInput): QueryInput {
  return Object.fromEntries(['catnoRaw', 'labelRaw', 'titleRaw', 'nameRaw', 'yearRaw', 'otherNumbers']
    .map(k => [k, (input[k as keyof QueryInput] ?? '').toString().trim() || null]));
}
export async function sourceInputKey(input: QueryInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sourceInput(input))));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const storageKey = (id: number) => `${PREFIX}${id}.json`;
async function readStored(env: Env, id: number) {
  const object = await env.PHOTOS!.get(storageKey(id));
  return { object, evidence: object ? await object.json<SourceEvidence>() : null };
}

/** Reads stored results only; a page load never spends a provider request. */
export async function sourcePreparation(env: Env, id: number, input: QueryInput, settled = false): Promise<SourcePreparation> {
  if (!env.PHOTOS) return { status: 'unavailable' };
  try {
    const { evidence } = await readStored(env, id);
    if (evidence?.inputKey === await sourceInputKey(input)) return { status: evidence.status, evidence };
    if (settled) return { status: 'settled' };
    return { status: checkRow(input).usable && musicbrainzQueries(input).length ? 'waiting' : 'needs-details' };
  } catch { return { status: 'unavailable' }; }
}

type Options = Parameters<typeof previewMusicBrainz>[2];
/** A per-record conditional claim prevents overlapping cron/manual attempts.
 * Results persist beyond the short request cache. Successful bounded searches
 * are not repeated nightly; changed readings or an explicit search start again.
 */
export async function prepareSource(env: Env, id: number, input: QueryInput, manual = false, opts: Options = {}): Promise<SourceEvidence | null> {
  if (!env.PHOTOS) throw new Error('Source evidence storage is unavailable');
  const now = opts?.now ?? Date.now;
  const inputKey = await sourceInputKey(input);
  const { object, evidence } = await readStored(env, id);
  const previous = evidence?.inputKey === inputKey ? evidence : null;
  if (previous?.status === 'running' && Date.parse(previous.retryAt!) > now()) return null;
  if (!manual && previous && (previous.status === 'ready' || previous.status === 'paused'
    || (previous.retryAt && Date.parse(previous.retryAt) > now()))) return null;
  if (!manual && previous && previous.attempts >= MAX_ATTEMPTS) {
    const paused: SourceEvidence = { ...previous, status: 'paused', retryAt: null,
      error: 'The last automatic attempt did not finish. Check the evidence and search again.' };
    await env.PHOTOS.put(storageKey(id), JSON.stringify(paused), { onlyIf: { etagMatches: object!.etag } });
    return paused;
  }
  const attempts = manual ? 1 : (previous?.attempts ?? 0) + 1;
  const running: SourceEvidence = { inputKey, status: 'running', attempts,
    updatedAt: new Date(now()).toISOString(), retryAt: new Date(now() + 120_000).toISOString(),
    ...(previous?.preview ? { preview: previous.preview } : {}),
    ...(previous?.retainedPreview ? { retainedPreview: previous.retainedPreview } : {}),
  };
  const claim = await env.PHOTOS.put(storageKey(id), JSON.stringify(running), {
    onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
  });
  if (!claim) return null;
  let preview: MBPreview | undefined, error: string | undefined;
  try { preview = await previewMusicBrainz(env, sourceInput(input), opts); }
  catch (e) { error = e instanceof Error ? e.message : 'Source search failed'; }
  // A cap on results is useful completed work; only provider failures retry.
  const failed = !!error || !!preview?.attempts.some(a => a.error);
  const status = failed ? attempts >= MAX_ATTEMPTS ? 'paused' : 'incomplete' : 'ready';
  const result: SourceEvidence = { inputKey, attempts, status,
    updatedAt: new Date(now()).toISOString(),
    retryAt: failed && attempts < MAX_ATTEMPTS ? new Date(now() + (attempts === 1 ? 3_600_000 : 21_600_000)).toISOString() : null,
    ...(preview ? { preview } : {}), ...(error ? { error } : {}),
    ...(failed && (previous?.preview?.candidates.length || previous?.retainedPreview?.candidates.length)
      ? { retainedPreview: previous?.preview?.candidates.length ? previous.preview : previous?.retainedPreview } : {}),
  };
  await env.PHOTOS.put(storageKey(id), JSON.stringify(result), { onlyIf: { etagMatches: claim.etag } });
  return result;
}

const UNRESOLVED = `NOT EXISTS (SELECT 1 FROM v_confirmed_field v WHERE v.entity = 'item'
  AND v.entity_id = i.id AND v.field = 'release_id')
  AND COALESCE((SELECT m.state FROM match_run m WHERE m.item_id = i.id ORDER BY m.id DESC LIMIT 1), '') != 'auto-accepted'`;

/** Ten inspected rows and at most one source search per five-minute tick.
 * The cursor advances past completed/paused rows so no failure starves others.
 * No provider response enters capture, release, match scores or decision views.
 */
export async function runSourcePreparation(env: Env, opts: Options = {}) {
  if (!env.PHOTOS) return { inspected: 0, prepared: 0, retriesQueued: 0 };
  const cursor = Number(await env.CACHE.get(CURSOR)) || 0;
  const { results } = await env.DB.prepare(`SELECT ${MATCH_COLUMNS} ${MATCH_FROM}
    WHERE ${UNRESOLVED} AND i.id > ? ORDER BY i.id LIMIT 10`).bind(cursor).all();
  let inspected = 0, prepared = 0, retriesQueued = 0, lastId = cursor;
  try {
  for (const row of results as unknown as (QueryInput & { itemId: number })[]) {
    inspected++;
    lastId = row.itemId;
    // Re-read: a person may have changed or settled this row since selection.
    const input = await env.DB.prepare(`SELECT ${MATCH_COLUMNS},
      (SELECT m.state FROM match_run m WHERE m.item_id=i.id ORDER BY m.id DESC LIMIT 1) AS state,
      (SELECT m.queries_json FROM match_run m WHERE m.item_id=i.id ORDER BY m.id DESC LIMIT 1) AS queries_json
      ${MATCH_FROM} WHERE i.id = ? AND ${UNRESOLVED}`).bind(row.itemId)
      .first<QueryInput & { state: string | null; queries_json: string | null }>();
    if (!input || !checkRow(input).usable) continue;
    const last = input.state ? input : null;
    let metadata: { input?: QueryInput; queriesRun?: number; manualReview?: boolean } = {};
    try { metadata = JSON.parse(last?.queries_json || '{}') ?? {}; } catch { /* old evidence stays for review */ }
    if (!retriesQueued && last && ['rejected', 'needs-review', 'error'].includes(last.state!) && !metadata.manualReview
      && ((metadata.input && await sourceInputKey(metadata.input) !== await sourceInputKey(input))
        || (!metadata.input && metadata.queriesRun === 0))) {
      const queued = await requestMatch(env, row.itemId, 'Automatic source preparation');
      if (queued.status === 202) retriesQueued++;
    }
    if (!musicbrainzQueries(input).length) continue;
    const result = await prepareSource(env, row.itemId, input, false, opts);
    if (result) { prepared++; break; }
  }
  } finally {
    // KV permits only one write per second to a key. Advance once per tick,
    // including on a failed row, so an unavailable object cannot starve others.
    await env.CACHE.put(CURSOR, results.length ? String(lastId) : '0');
  }
  return { inspected, prepared, retriesQueued };
}
