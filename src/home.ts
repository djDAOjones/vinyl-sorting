/**
 * The hub (APP-HOME-HUB).
 *
 * Four destinations and the numbers behind them. The app had three
 * screens and no front door: capture sat at the root, so the collection
 * and the review queue were reachable only from each other, and a
 * fourth screen had nowhere to be announced.
 *
 * IT RENDERS BEFORE IT COUNTS. Every number arrives from `/api`, and
 * this page has to be useful in a loft with no signal — so the tiles
 * paint immediately with the counts blank, and the counts fill in when
 * and if the network answers. A hub that waits for a fetch to show its
 * buttons is a hub that shows nothing offline.
 */

import { bootChrome, esc, ROUTES, storedTheme, toast } from './chrome.ts';
import { ensureCapturerCookie, forgetCapturer, storedCapturer } from './who.ts';
import { allEntries } from './queue.ts';
import { summarise } from './queue-logic.ts';

const app = document.getElementById('home')!;
const API = '/api';

interface Stats {
  byState: { state: string; n: number }[];
  unmatched: number;
  reviewed: number;
  decisionEligible: number;
  /** DISCS waiting, not runs — the two differ once a row is re-run. */
  itemsNeedingReview?: number;
}

let stats: Stats | null = null;
let items: number | null = null;
let queued = 0;

const ICONS = {
  add: `<svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2.75" y="5.75" width="18.5" height="13.5" rx="2.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8.5 5.75 10 3.25h4l1.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="12" cy="12.5" r="3.75" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="12" cy="12.5" r="1" fill="currentColor"/></svg>`,
  review: `<svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3.5 6.5h11M3.5 12h11M3.5 17.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="m16.5 16.5 2 2 4-4.5" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  browse: `<svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.25 4.5v15M8 4.5v15M12.4 4.9l-1 14.5" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round"/>
    <rect x="15" y="5.4" width="4.6" height="14.1" rx="1" transform="rotate(6 15 5.4)"
      stroke="currentColor" stroke-width="1.5"/></svg>`,
  settings: `<svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.5"/>
    <path d="M12 2.9v2.2M12 18.9v2.2M21.1 12h-2.2M5.1 12H2.9M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

const DISC = `<svg class="disc" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.3"/>
  <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="0.8" opacity=".4"/>
  <circle cx="12" cy="12" r="4.6" stroke="currentColor" stroke-width="1.1" opacity=".7"/>
  <circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>`;

const stateCount = (state: string): number | null =>
  stats ? (stats.byState.find((s) => s.state === state)?.n ?? 0) : null;

/** A count, or nothing at all until one arrives. Never a zero we do not know. */
const countLine = (n: number | null, one: string, many = `${one}s`, quiet = false): string => {
  if (n === null) return '<span class="count quiet">…</span>';
  return `<span class="count${quiet || n === 0 ? ' quiet' : ''}">${n.toLocaleString('en-GB')} ${n === 1 ? one : many}</span>`;
};

function render(): void {
  const who = storedCapturer();
  // Items, falling back to the run histogram for a Worker deployed
  // before `itemsNeedingReview` existed. The tile is a count of work,
  // and work is measured in discs.
  const needsReview = stats
    ? (stats.itemsNeedingReview ?? stateCount('needs-review'))
    : null;

  app.innerHTML = `
    <div class="hero">
      ${DISC}
      <div>
        <h1>Vinyl sorter</h1>
        <p>Catalogue it, verify it, decide what stays.</p>
      </div>
      <div class="spacer" style="margin-left:auto"></div>
      ${who
    ? `<button type="button" class="btn btn-quiet" id="who" title="Hand the phone over">${esc(who)}</button>`
    : ''}
    </div>

    <nav class="tiles">
      <a class="tile lead" href="${ROUTES.capture}">
        ${ICONS.add}
        <span class="name">Add vinyl</span>
        <span class="what">Photograph a label and queue it. Works with no signal.</span>
        ${queued ? `<span class="count">${queued} waiting to upload</span>` : ''}
      </a>

      <a class="tile" href="${ROUTES.review}">
        ${ICONS.review}
        <span class="name">Resolve entries</span>
        <span class="what">Confirm what the matcher could not settle on its own.</span>
        ${countLine(needsReview, 'to review', 'to review')}
      </a>

      <a class="tile" href="${ROUTES.browse}">
        ${ICONS.browse}
        <span class="name">The collection</span>
        <span class="what">Every record, what is known about it, and where it came from.</span>
        ${countLine(items, 'record')}
      </a>

      <a class="tile" href="${ROUTES.settings}">
        ${ICONS.settings}
        <span class="name">Settings</span>
        <span class="what">Theme, density, matching, and a copy of everything.</span>
        <span class="count quiet">${esc(storedTheme())} theme</span>
      </a>
    </nav>

    <div class="pulse">
      ${stat(stateCount('auto-accepted'), 'matched', 'good')}
      ${stat(needsReview, 'to review', 'on')}
      ${stat(stats ? stats.decisionEligible : null, 'confirmed')}
      ${stat(stats ? stats.unmatched : null, 'never tried')}
    </div>

    <div class="homefoot">
      <span>Press <kbd>?</kbd> anywhere for the keyboard shortcuts.</span>
      <a class="link" href="${ROUTES.browse}">Everything is searchable →</a>
    </div>
    <div id="toast"></div>`;

  document.getElementById('who')?.addEventListener('click', () => {
    // The queue is deliberately untouched: whatever this phone is
    // holding still belongs to the person who photographed it.
    forgetCapturer();
    toast('Name cleared. The next screen will ask.');
    render();
  });
}

const stat = (n: number | null, label: string, kind = ''): string => `
  <div class="stat ${kind}">
    <b>${n === null ? '—' : n.toLocaleString('en-GB')}</b>
    <span>${esc(label)}</span>
  </div>`;

/**
 * The numbers, after the page is already usable.
 *
 * Failure is silent on purpose. Offline is the normal case this app
 * was built for, and an error banner over four working buttons would
 * report a problem the person does not have.
 */
async function loadCounts(): Promise<void> {
  try {
    const [s, h] = await Promise.all([
      fetch(`${API}/match-stats`).then((r) => (r.ok ? r.json() as Promise<Stats> : null)),
      fetch(`${API}/health`).then((r) => (r.ok ? r.json() as Promise<{ items: number }> : null)),
    ]);
    if (s) stats = s;
    if (h) items = h.items;
    render();
  } catch { /* the tiles work without them */ }
}

/** What this phone is still holding. Local, so it works offline. */
async function loadQueue(): Promise<void> {
  try {
    const { pending, failed } = summarise(await allEntries());
    queued = pending + failed;
    if (queued) render();
  } catch { /* IndexedDB unavailable is not worth a message here */ }
}

ensureCapturerCookie();
bootChrome();
render();
void loadQueue();
void loadCounts();
