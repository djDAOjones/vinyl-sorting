import type { SimilarPrice } from '../worker/pricing.ts';
/** Display-only fallbacks. Never write these values back into capture. */
interface Source {
  entity: string; entity_id: number; field: string; source: string;
  confirmed_by: string | null; confirmed_at: string | null;
}
interface SummaryInput {
  item: Record<string, unknown>;
  captures: Record<string, unknown>[];
  release: Record<string, unknown> | null;
  readings: { id: number; field: string; value: string }[];
  provenance: Source[];
}
export interface SummaryField { label: string; value: string | null; note: string; url?: string }
const present = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== '';
const MONEY = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function recordSummary(d: SummaryInput): SummaryField[] {
  const capture = d.captures[0] ?? {};
  const sourceNote = (entity: string, id: unknown, field: string, fallback: string): string => {
    const p = d.provenance.find((p) => p.entity === entity && p.entity_id === Number(id) && p.field === field);
    if (!p) return `${fallback} · provenance not recorded`;
    const names: Record<string, string> = { shelf: 'Read at the shelf', vision: 'Read from a photograph',
      discogs: 'Discogs', musicbrainz: 'MusicBrainz', legacy: 'Legacy import', guess: 'Guess' };
    return `${names[p.source] ?? p.source} · ${p.confirmed_at ? `confirmed by ${p.confirmed_by ?? 'a person'}` : 'unconfirmed'}`;
  };
  const field = (label: string, key: string, releaseKey?: string): SummaryField => {
    if (present(capture[key])) return { label, value: String(capture[key]),
      note: sourceNote('capture', capture.id, key, 'Capture') };
    const reading = d.readings.find((r) => r.field === key && present(r.value));
    if (reading) return { label, value: reading.value,
      note: sourceNote('raw_value', reading.id, reading.field, 'Reading') };
    if (releaseKey && present(d.release?.[releaseKey])) return { label, value: String(d.release![releaseKey]),
      note: sourceNote('release', d.release!.id, releaseKey, 'Matched release') };
    return { label, value: null, note: '' };
  };
  const genre = d.readings.find((r) => ['genre', 'genres', 'genreraw'].includes(r.field.toLowerCase().replace(/[\s_]/g, '')) && present(r.value));
  const release = d.release;
  const priced = typeof release?.lowest_price === 'number' && Number.isFinite(release.lowest_price);
  const estimate = !priced ? release?.similar_price as SimilarPrice | undefined : undefined;
  const checked = present(release?.price_checked_at) ? String(release!.price_checked_at) : null;
  return [
    field('Artist', 'name_raw'), field('Title', 'title_raw'), field('Label', 'label_raw', 'label'),
    field('Year', 'year_raw', 'year'),
    { label: 'Genre', value: genre?.value ?? null,
      note: genre ? sourceNote('raw_value', genre.id, genre.field, 'Reading') : '' },
    { label: 'Value', ...(estimate ? { url: `https://www.discogs.com/release/${estimate.sourceReleaseId}` } : {}),
      value: estimate ? `~${MONEY.format(estimate.amount)} (estimate)` : priced ? `~${MONEY.format(release!.lowest_price as number)}` : checked ? 'None listed' : null,
      note: estimate ? `Similar vinyl edition · lowest asking price · checked ${estimate.checkedAt}` : priced || checked ? `Lowest Discogs listing${checked ? ` · checked ${checked}` : ' · check date not recorded'}` : '' },
  ];
}
