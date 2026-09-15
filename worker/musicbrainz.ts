import { upstreamFetch } from './discogs.ts';
import type { Env } from './env.ts';
import type { QueryInput } from './match/queries.ts';
import { buildQueries, otherCatnoVariants } from './match/queries.ts';
import { RateLimiter } from './rate-limit.ts';

const BASE = 'https://musicbrainz.org/ws/2/release/';
const USER_AGENT = 'VinylSorter/0.1 (+https://github.com/djDAOjones/vinyl-sorting)';
const SLOT = '_system/musicbrainz/search-lease.json';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const normal = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v: unknown, max = 400): string => typeof v === 'string' ? v.slice(0, max) : '';
const quote = (s: string) => `"${s.replace(/[\\"]/g, '\\$&')}"`;
const tokens = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(w => !['the', 'and', 'various', 'unknown', 'compilation'].includes(w)) ?? [];
const overlaps = (a: string, b: string) => tokens(a).some(w => tokens(b).includes(w));

export interface MBQuery { kind: string; query: string }
export interface MBCandidate {
  id: string; title: string; artists: string; labels: string[]; numbers: string[];
  formats: string[]; country: string; date: string; tracks: number | null;
  agreements: string[]; differences: string[]; vinyl: boolean;
}
export interface MBPreview {
  source: 'MusicBrainz'; retrievedAt: string; expiresAt: string; input: QueryInput;
  attempts: { kind: string; query: string; url: string; count?: number; returned?: number; error?: string; requests: number }[];
  candidates: MBCandidate[]; incomplete: boolean; cached?: boolean;
}

/** Bounded aliases, never corrections to capture. No caller-supplied query. */
export function musicbrainzQueries(input: QueryInput): MBQuery[] {
  const variants = [...buildQueries(input).variants, ...otherCatnoVariants(input.otherNumbers)];
  const unique = new Map<string, string>();
  for (const n of variants) if (!unique.has(normal(n))) unique.set(normal(n), n.slice(0, 100));
  const numbers = [...unique.values()].slice(0, 8);
  const out: MBQuery[] = [];
  if (numbers.length) out.push({ kind: 'Catalogue numbers', query: numbers.map(n => `catno:${quote(n)}`).join(' OR ') });
  const title = tokens(clean(input.titleRaw)).slice(0, 6);
  const artists = clean(input.nameRaw).split(/[;\/]|\s+&\s+/).map(s => s.trim()).filter(s => tokens(s).length).slice(0, 3);
  if (title.length && artists.length) out.push({ kind: 'Title and credited names',
    query: `release:(${title.map(quote).join(' AND ')}) AND (${artists.map(s => `artist:${quote(s)}`).join(' OR ')})` });
  else if (title.length) out.push({ kind: 'Title', query: `release:(${title.map(quote).join(' AND ')})` });
  return out;
}

export function musicbrainzCandidate(raw: unknown, input: QueryInput): MBCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID.test(r.id) || typeof r.title !== 'string') return null;
  const credit = Array.isArray(r['artist-credit']) ? r['artist-credit'].slice(0, 30) : [];
  const artists = credit.map(a => clean(a?.name || a?.artist?.name)).filter(Boolean).join('; ');
  const info = Array.isArray(r['label-info']) ? r['label-info'].slice(0, 15) : [];
  const labels = [...new Set<string>(info.map(a => clean(a?.label?.name)).filter(Boolean))];
  const numbers = [...new Set<string>(info.map(a => clean(a?.['catalog-number'], 100)).filter(Boolean))];
  const media = Array.isArray(r.media) ? r.media.slice(0, 30) : [];
  const formats = [...new Set<string>(media.map(m => clean(m?.format, 80)).filter(Boolean))];
  const vinyl = formats.some(f => /vinyl/i.test(f));
  const trackCounts = media.map(m => m?.['track-count']);
  const tracks = media.length && trackCounts.every(n => Number.isSafeInteger(n) && n >= 0) ? trackCounts.reduce((a, n) => a + n, 0) : null;
  const agreements: string[] = [], differences: string[] = [];
  const matchNumber = numbers.some(n => [...buildQueries(input).variants, ...otherCatnoVariants(input.otherNumbers)].some(v => normal(n) === normal(v)));
  if (matchNumber) agreements.push('Catalogue number');
  else if (numbers.length && input.catnoRaw) differences.push('Different catalogue number');
  if (overlaps(clean(input.titleRaw), r.title)) agreements.push('Some title words');
  else if (input.titleRaw) differences.push('No shared title words');
  if (overlaps(clean(input.nameRaw), artists)) agreements.push('Some credited names');
  else if (input.nameRaw && artists) differences.push('No shared credited names');
  if (input.labelRaw && labels.length && !labels.some(l => clean(input.labelRaw).split(/[;\/]/).some(v => normal(v) === normal(l)))) differences.push('Label differs; check imprint/publisher');
  if (!vinyl) differences.push(formats.length ? 'Other format: context only' : 'Format not recorded');
  if (media.length > 1) differences.push('Multiple media: check the complete package');
  return { id: r.id, title: clean(r.title), artists, labels, numbers, formats, country: clean(r.country, 20), date: clean(r.date, 20), tracks, agreements, differences, vinyl };
}

interface Options { now?: () => number; sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch }
/**
 * R2 conditional writes serialize ALL preview callers. KV alone is eventually
 * consistent and cannot provide a one-request-per-second cross-isolate lock.
 * This single system object has no photo/capture relation and contains no data.
 * The lease expires after a crash; its owner leaves a quiet second on release.
 */
export async function previewMusicBrainz(env: Env, input: QueryInput, opts: Options = {}): Promise<MBPreview> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const fetchImpl = opts.fetchImpl ?? upstreamFetch;
  const queries = musicbrainzQueries(input);
  if (!queries.length) throw new Error('Add a catalogue number or title before searching MusicBrainz.');
  const identity = JSON.stringify({ v: 1, input, queries });
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const key = `musicbrainz:preview:${hash}`;
  const saved = await env.CACHE.get(key);
  if (saved) {
    try { const p = JSON.parse(saved) as MBPreview; if (Date.parse(p.expiresAt) > now()) return { ...p, cached: true }; } catch { /* replace unusable cache */ }
  }
  if (!env.PHOTOS) throw new Error('Shared MusicBrainz search coordination is unavailable.');
  const old = await env.PHOTOS.get(SLOT);
  if (old && (await old.json<{ until: number }>()).until > now()) throw new Error('Another MusicBrainz search is running or cooling down. Try again shortly.');
  const leasedUntil = now() + 90_000;
  const lease = await env.PHOTOS.put(SLOT, JSON.stringify({ until: leasedUntil, owner: crypto.randomUUID() }), {
    onlyIf: old ? { etagMatches: old.etag } : { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' },
  });
  if (!lease) throw new Error('Another MusicBrainz search started. Try again shortly.');
  const limiter = new RateLimiter({ get: k => env.CACHE.get(k), put: (k, v, o) => env.CACHE.put(k, v, o) }, now);
  const attempts: MBPreview['attempts'] = [];
  const candidates = new Map<string, MBCandidate>();
  let incomplete = false;
  let quietMs = 1_100;
  let upstreamPaused = false;
  try {
    for (const spec of queries) {
      const url = new URL(BASE); url.search = new URLSearchParams({ query: spec.query, fmt: 'json', limit: '25' }).toString();
      const attempt: MBPreview['attempts'][number] = { ...spec, url: url.toString(), requests: 0 };
      attempts.push(attempt);
      if (upstreamPaused) { attempt.error = 'Skipped while MusicBrainz requested a pause'; incomplete = true; continue; }
      try {
        for (let retry = 0; retry < 2; retry++) {
          if (now() + 15_000 >= leasedUntil) throw new Error('Search time budget reached');
          let budget = await limiter.take('musicbrainz');
          if (!budget.allowed && budget.retryAfterMs <= 5_000) { await sleep(budget.retryAfterMs + 100); budget = await limiter.take('musicbrainz'); }
          if (!budget.allowed) throw new Error('Shared MusicBrainz request budget unavailable');
          attempt.requests++;
          const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(8_000), redirect: 'manual' });
          if ([429, 503].includes(res.status)) {
            const header = res.headers.get('retry-after');
            const seconds = header && !/^\d+$/.test(header) ? (Date.parse(header) - now()) / 1000 : Number(header ?? 2);
            const wait = Number.isFinite(seconds) ? Math.max(2, seconds) : 30;
            quietMs = Math.max(quietMs, 30_000, wait * 1000);
            if (wait > 5 || retry > 0) upstreamPaused = true;
            if (retry === 0) {
              await res.body?.cancel();
              if (wait > 5) throw new Error(`HTTP ${res.status}; upstream requested a longer pause`);
              await sleep(wait * 1000); continue;
            }
          }
          if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
          const data = await res.json() as { count?: number; releases?: unknown[] };
          if (!Number.isSafeInteger(data.count) || data.count! < 0 || !Array.isArray(data.releases)) throw new Error('Unexpected MusicBrainz response');
          attempt.count = data.count; attempt.returned = Math.min(25, data.releases.length);
          if (data.count! > attempt.returned) incomplete = true;
          for (const raw of data.releases.slice(0, 25)) {
            const candidate = musicbrainzCandidate(raw, input);
            if (candidate) candidates.set(candidate.id, candidate);
            else incomplete = true;
          }
          break;
        }
      } catch (error) { attempt.error = error instanceof Error ? error.message : 'Search failed'; incomplete = true; }
    }
    const preview: MBPreview = { source: 'MusicBrainz', input, retrievedAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + (attempts.some(a => a.error) ? 60_000 : 86_400_000)).toISOString(), attempts,
      candidates: [...candidates.values()].sort((a, b) => {
        const rank = (c: MBCandidate) => (c.agreements.includes('Catalogue number') ? 4 : 0) + c.agreements.length + Number(c.vinyl);
        return rank(b) - rank(a);
      }), incomplete };
    await env.CACHE.put(key, JSON.stringify(preview), { expirationTtl: attempts.some(a => a.error) ? 60 : 86_400 });
    return preview;
  } finally {
    // Conditional release cannot clear a newer owner's lease.
    await env.PHOTOS.put(SLOT, JSON.stringify({ until: now() + quietMs }), { onlyIf: { etagMatches: lease.etag } });
  }
}
