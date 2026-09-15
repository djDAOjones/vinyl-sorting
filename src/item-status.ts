/** Current user-facing state. Search history and confirmation stay separate. */
export const STATUS_LABELS = {
  confirmed: 'Confirmed',
  'check-match': 'Check match',
  'needs-review': 'Needs review',
  deferred: 'Decide later',
  'not-identified': 'Not identified',
  'needs-details': 'Needs details',
  'ready-to-search': 'Ready to search',
  waiting: 'Waiting for search',
  searching: 'Searching',
  'search-incomplete': 'Search incomplete',
  'search-failed': 'Search failed',
  unknown: 'Check record',
} as const;
export type ItemStatus = keyof typeof STATUS_LABELS;
export interface StatusEvidence {
  confirmed?: boolean | number;
  choice?: string | null;
  state?: string | null;
  searchable?: boolean;
  ranAt?: string | null;
  queriesRun?: number | null;
  queryErrors?: number | null;
  incomplete?: boolean | number | null;
  retry?: string | null;
  manualReview?: boolean | number | null;
}
export function itemStatus(e: StatusEvidence, now = Date.now()): ItemStatus {
  if (e.confirmed) return 'confirmed';
  if (e.choice === 'skip') return 'deferred';
  if (e.choice === 'none') return 'not-identified';
  if (e.state === 'pending') {
    if (e.retry === 'queued') return 'waiting';
    const started = Date.parse(e.ranAt?.includes('T') ? e.ranAt : `${e.ranAt?.replace(' ', 'T')}Z`);
    return Number.isFinite(started) && now - started < 15 * 60_000 ? 'searching' : 'search-failed';
  }
  if (e.state === 'error') return 'search-failed';
  if (e.incomplete || (e.queryErrors ?? 0) > 0) return 'search-incomplete';
  if (e.manualReview) return 'not-identified';
  if (e.state === 'auto-accepted') return 'check-match';
  if (e.state === 'needs-review') return 'needs-review';
  if (e.state === 'rejected') {
    if (e.searchable === false) return 'needs-details';
    return e.queriesRun === 0 ? 'ready-to-search' : 'not-identified';
  }
  if (!e.state) return e.searchable === false ? 'needs-details' : 'waiting';
  return 'unknown';
}

/** Readable labels for historical evidence; these never describe current work. */
export const SEARCH_LABELS: Record<string, string> = {
  'auto-accepted': 'Match found', 'needs-review': 'Candidates found',
  rejected: 'No match found', error: 'Search failed', pending: 'Search pending',
};
export const DECISION_LABELS: Record<string, string> = {
  candidate: 'Confirmed', manual: 'Confirmed', none: 'Not identified', skip: 'Decide later',
};
