import type { Env } from './env.ts';
import type { DiscogsClient } from './discogs.ts';
import { priceOf } from './match/run.ts';

// Display evidence only. Never feeds confirmed fields, decision views or exports.
export const PRICE_INDEX_KEY = 'pricing:similar-editions:v1';
const MONTH = 30 * 86_400_000;
export interface SimilarPrice {
  amount: number; currency: 'GBP'; sourceReleaseId: number; masterId: number;
  checkedAt: string; country: string; year: number | null; forSale: number | null;
}
interface PriceCheck {
  retryAt: number; estimate: SimilarPrice | null; status: 'exact' | 'similar' | 'none' | 'error';
}
type PriceIndex = Record<string, PriceCheck>;
type Release = Record<string, unknown>;
type Client = Pick<DiscogsClient, 'getRelease' | 'getVersions' | 'budgetSpent'>;
const normal = (v: unknown) => String(v ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const priceValid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Same physical format, disc count, size/speed and programme. A master alone
 * is too broad: Discogs can put remixes, CDs and double LPs in the same group.
 * Country/year/label may differ: that is precisely why this is an estimate.
 */
export function comparableEdition(original: Release, other: Release): boolean {
  if (!positiveId(original.master_id) || original.master_id !== other.master_id) return false;
  const format = (r: Release) => {
    const fs = r.formats as { name?: string; qty?: string; descriptions?: string[] }[] | undefined;
    if (!Array.isArray(fs) || fs.length !== 1 || fs[0]?.name !== 'Vinyl' || !Number(fs[0].qty)) return null;
    const d = fs[0].descriptions ?? [];
    const physical = d.filter(s => /^(LP|7"|10"|12"|33 ⅓ RPM|45 RPM|78 RPM|Album|EP|Single|Mini-Album|Mono|Stereo|Picture Disc|Promo|Test Pressing|Unofficial Release)$/i.test(s));
    // LP implies size/speed, but a missing mono/stereo tag is common; only
    // reject an explicit conflict below rather than invent a channel format.
    return { qty: Number(fs[0].qty), d: physical.map(normal).sort() };
  };
  const a = format(original), b = format(other);
  if (!a || !b || a.qty !== b.qty) return false;
  const channels = ['mono', 'stereo'];
  if (a.d.some(s => channels.includes(s)) && b.d.some(s => channels.includes(s))
    && a.d.find(s => channels.includes(s)) !== b.d.find(s => channels.includes(s))) return false;
  if (a.d.filter(s => !channels.includes(s)).join() !== b.d.filter(s => !channels.includes(s)).join()) return false;
  const tracks = (r: Release) => Array.isArray(r.tracklist)
    ? r.tracklist.filter(t => t.type_ !== 'heading').map(t => normal(t.title)).filter(Boolean) : [];
  const at = tracks(original), bt = tracks(other);
  return at.length > 0 && at.length === bt.length && at.every((t, i) => t === bt[i]);
}

/** At most two version pages and four detailed candidates, closest first.
 * No fuzzy cross-master guessing, and no price taken from a version summary.
 */
export async function findSimilarPrice(original: Release, client: Client, now = Date.now): Promise<SimilarPrice | null> {
  if (!positiveId(original.master_id)) return null;
  const first = await client.getVersions(original.master_id);
  const versions = [...(first.versions ?? [])];
  if ((first.pagination?.pages ?? 1) > 1 && !client.budgetSpent(4)) {
    versions.push(...((await client.getVersions(original.master_id, 2)).versions ?? []));
  }
  const labels = Array.isArray(original.labels) ? original.labels.map(l => normal(l.name)) : [];
  const rank = (v: Release) => (v.country === original.country ? 100 : 0)
    + (labels.includes(normal(v.label)) ? 30 : 0)
    - Math.min(20, Math.abs((Number.parseInt(String(v.released)) || 0) - (Number(original.year) || 0)));
  const candidates = [...new Map(versions.filter(v => positiveId(v.id) && v.id !== original.id
    && Array.isArray(v.major_formats) && v.major_formats.length === 1 && v.major_formats[0] === 'Vinyl')
    .map(v => [v.id, v])).values()].sort((a, b) => rank(b) - rank(a) || Number(a.id) - Number(b.id));
  for (const v of candidates.slice(0, 4)) {
    if (client.budgetSpent(4)) throw new Error('Price check budget reached');
    const release = await client.getRelease(v.id as number);
    const price = priceOf(release);
    if (release.id !== v.id || !comparableEdition(original, release) || !priceValid(price?.lowest) || price?.forSale === 0) continue;
    return { amount: price!.lowest!, currency: 'GBP', sourceReleaseId: v.id as number,
      masterId: original.master_id, checkedAt: new Date(now()).toISOString(),
      country: typeof release.country === 'string' ? release.country : '',
      year: typeof release.year === 'number' ? release.year : null, forSale: price!.forSale };
  }
  return null;
}

export async function readPriceIndex(env: Env): Promise<PriceIndex> {
  try { return JSON.parse(await env.CACHE.get(PRICE_INDEX_KEY) || '{}'); } catch { return {}; }
}
export function similarPriceFor(index: PriceIndex, id: unknown, confirmed: unknown, exact: unknown): SimilarPrice | null {
  if (!confirmed || priceValid(exact)) return null;
  const e = index[String(id)]?.estimate;
  return e && e.currency === 'GBP' && priceValid(e.amount) && positiveId(e.sourceReleaseId) ? e : null;
}

/** Only cron calls this, sharing the existing client and rate budget. At most
 * five records / 90 seconds per idle matcher tick, confirmed releases first.
 * Exact prices stay in release; indicative prices stay in a separate KV index.
 * Errors retry later without making a failed request look like no listings.
 */
export async function runPriceBatch(env: Env, client: Client, now = Date.now) {
  const index = await readPriceIndex(env);
  const { results } = await env.DB.prepare(`SELECT r.id, r.discogs_id, r.lowest_price, r.price_checked_at
    FROM release r WHERE EXISTS (SELECT 1 FROM item i JOIN v_confirmed_field v
      ON v.entity = 'item' AND v.entity_id = i.id AND v.field = 'release_id'
      WHERE i.release_id = r.id)
    ORDER BY r.price_checked_at IS NOT NULL, r.price_checked_at, r.id`).all<{
      id: number; discogs_id: number; lowest_price: number | null; price_checked_at: string | null;
    }>();
  const start = now();
  let checked = 0, similar = 0, failed = 0;
  for (const row of results) {
    const previous = index[String(row.discogs_id)];
    if (previous && previous.retryAt > now()) continue;
    const stamp = row.price_checked_at ? Date.parse(row.price_checked_at.replace(' ', 'T') + (row.price_checked_at.includes('Z') ? '' : 'Z')) : 0;
    if (!previous && priceValid(row.lowest_price) && stamp > now() - MONTH) continue;
    if (checked >= 5 || client.budgetSpent(8) || now() - start > 90_000) break;
    checked++;
    try {
      const release = await client.getRelease(row.discogs_id);
      const price = priceOf(release);
      if (release.id !== row.discogs_id || !price || (price.lowest !== null && !priceValid(price.lowest))) throw new Error('No usable price response');
      await env.DB.prepare(`UPDATE release SET lowest_price = ?, num_for_sale = ?, price_checked_at = ? WHERE id = ?`)
        .bind(price.lowest, price.forSale, new Date(now()).toISOString(), row.id).run();
      const estimate = price.lowest === null ? await findSimilarPrice(release, client, now) : null;
      index[String(row.discogs_id)] = { retryAt: now() + MONTH, estimate,
        status: price.lowest !== null ? 'exact' : estimate ? 'similar' : 'none' };
      if (estimate) similar++;
    } catch {
      failed++;
      index[String(row.discogs_id)] = { retryAt: now() + 3_600_000, estimate: previous?.estimate ?? null, status: 'error' };
    }
  }
  if (checked) await env.CACHE.put(PRICE_INDEX_KEY, JSON.stringify(index));
  return { checked, similar, failed };
}
