/**
 * Browse — the screen that shows what is actually in the collection.
 *
 * The app had two screens and neither answered "what have I got?".
 * Capture writes and forgets; the review queue shows one match at a
 * time and drops the item once it is resolved. 465 rows were live in D1
 * and the only way to see one was `GET /api/items` in a browser tab.
 *
 * PROVENANCE IS THE POINT, not a decoration on it. Every value here is
 * marked with where it came from and whether a person has confirmed it,
 * because a `guess` and a value read at the shelf are indistinguishable
 * in every spreadsheet this replaces — which is most of why 9% of the
 * old Discogs matches point at the wrong record. Unconfirmed values are
 * shown, which the provenance rule expressly permits, and are shown as
 * unconfirmed.
 *
 * EDITING lives here too (DATASET-EDIT): click a value to correct it,
 * tick it to confirm it unchanged, promote a photo reading into the
 * field it belongs to. Every write lands as a confirmed `shelf` value
 * with a name on it, and every write needs the shared passphrase.
 *
 * THE PHOTOGRAPHS ARE LISTED, NOT SHOWN, and that is parked rather than
 * unfinished. Rendering one needs a `GET /api/photos/:key` on the
 * Worker, and `photos-pull.test.mjs` asserts that no such route exists:
 * with no sign-in, a photo GET beside a public `/api/items/:id` that
 * already returns every `r2_key` is the household's label photographs
 * behind a URL anyone can walk. Two live records disagree about that,
 * so it is the maintainer's call and not this screen's — see
 * BROWSE-PHOTOS. What is shown instead is what can be said honestly:
 * how many exist, when they were taken, and their keys, which is what
 * `photos-pull` needs to fetch them to a desk.
 */

import { ensureCapturerCookie, storedCapturer } from './who.ts';
import {
  bootChrome, esc, headerHtml, parseJson as parse, toast,
} from './chrome.ts';

/**
 * The header the photo route and the item detail both want.
 *
 * BROWSE-PHOTOS gated both on the typed name — the photograph and its
 * key together, since the key is the photograph's address and gating
 * one without the other would protect nothing. An unnamed device still
 * browses; it just sees that photographs exist rather than what they
 * are.
 */
function whoHeader(): Record<string, string> {
  const who = storedCapturer();
  return who ? { 'x-capturer': who } : {};
}

const app = document.getElementById('browse')!;
const API = '/api';

interface Row {
  id: number;
  crate: string | null; position: string | null;
  media_grade: string | null; sleeve_grade: string | null;
  decision: string; captured_by: string | null; captured_at: string | null;
  import_ref: string | null; last_verified_at: string | null;
  catno_raw: string | null; label_raw: string | null;
  name_raw: string | null; title_raw: string | null; year_raw: string | null;
  discogs_id: number | null; release_label: string | null; release_title: string | null;
  photo_count: number;
  reading_count: number;
  read_catno: string | null;
  read_label: string | null;
  read_name: string | null;
  read_title: string | null;
  read_other: string | null;
  matrix_runout: string | null;
  release_year: number | null;
  match_state: string | null;
  release_confirmed: number;
}

interface Provenance {
  entity: string; entity_id: number; field: string; source: string;
  confidence: number | null; confirmed_by: string | null; confirmed_at: string | null;
}
interface Photo { id: number; kind: string; r2_key: string; added_at: string }
interface Candidate { rank: number; discogs_id: number; score: number; signals_json: string }
interface Decision {
  choice: string; discogs_id: number | null; decided_by: string; decided_at: string; note: string | null;
}
interface Run {
  id: number; state: string; ran_at: string; queries_json: string;
  candidates: Candidate[]; decision: Decision | null;
}
interface Detail {
  item: Record<string, unknown>;
  captures: Record<string, unknown>[];
  photos: Photo[];
  provenance: Provenance[];
  readings: { id: number; field: string; value: string }[];
  runs: Run[];
}

let rows: Row[] = [];
let openId: number | null = null;

/**
 * The shared passphrase, held beside `dg.who` on this device.
 *
 * Not sign-in and it does not pretend to be — OPEN-V1-AUTH decided v1
 * has none. It is a bolt on the one drawer worth bolting: adding a row
 * is not the risk that rewriting 465 is.
 */
const editToken = {
  get(): string { try { return localStorage.getItem('dg.edit') ?? ''; } catch { return ''; } },
  set(v: string): void { try { localStorage.setItem('dg.edit', v); } catch { /* asked again */ } },
  clear(): void { try { localStorage.removeItem('dg.edit'); } catch { /* nothing held */ } },
};

/**
 * One write, and what to do when the door is shut.
 *
 * A 401 clears the stored passphrase rather than retrying with it: a
 * secret that has been changed on the Worker must stop being sent, or
 * every edit for the rest of the session fails silently the same way.
 */
async function write(path: string, body: unknown): Promise<boolean> {
  const token = editToken.get();
  if (!token) { flash('Unlock editing first.', 'err'); return false; }
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-edit-token': token },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    editToken.clear();
    flash('That passphrase was refused. Unlock again.', 'err');
    return false;
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as { error?: string };
    flash(detail.error ?? `Refused: HTTP ${res.status}`, 'err');
    return false;
  }
  return true;
}

/** The shared toast, which creates its own host if the page has none. */
const flash = toast;

/** What `?` lists for this screen. */
const SCREEN_KEYS = [
  { keys: '/', what: 'Jump to the search box' },
  { keys: 'Esc', what: 'Close the detail panel' },
];

/**
 * What a source means, said in words rather than in jargon.
 *
 * The distinction between these is the whole project. `vision` is new
 * with migration 004 and is deliberately NOT `guess`: the legacy AI
 * values were fabricated outright, while a reading taken off a
 * photograph of the actual disc is evidence of a different kind.
 */
const SOURCE_LABEL: Record<string, string> = {
  shelf: 'read at the shelf',
  discogs: 'from Discogs',
  musicbrainz: 'from MusicBrainz',
  vision: 'read off a photograph',
  legacy: 'legacy import',
  guess: 'guess',
};

/**
 * The match states, and what each one means for the row.
 *
 * `unmatched` is not a state the matcher writes — it is the absence of
 * a run, which is a different thing from a run that found nothing and
 * must not be shown as if it were the same.
 */
/**
 * The capture fields a reading may be promoted into.
 *
 * `worker/edit.ts` holds the authority; this is the display copy that
 * decides whether a promote button appears. Diverging costs a missing
 * button and never a bad write — the Worker allow-lists the field again
 * and answers 400 for anything outside its own list.
 */
const CAPTURE_FIELDS = [
  'catno_raw', 'label_raw', 'name_raw', 'title_raw', 'year_raw', 'matrix_runout',
] as const;

const STATES = ['auto-accepted', 'needs-review', 'rejected', 'error', 'unmatched'] as const;
const stateOf = (r: Row): string => r.match_state ?? 'unmatched';

/* ── Columns, sorts and saved views (CATALOGUE-CONTROLS) ──────────
 *
 * The screen offered two sorts and three filters over eight fixed
 * columns, which is enough to LOOK at 484 rows and not enough to ask a
 * question of them.
 *
 * Every column declares how to read itself and how to sort itself, in
 * one place, so adding one is a line here rather than an edit in four
 * functions — which is what the old fixed `<th>` list plus a hand-
 * written `rowHtml` had become.
 */
interface Column {
  key: string;
  label: string;
  get: (r: Row) => unknown;
  /** Right-aligned and sorted numerically. */
  num?: boolean;
  mono?: boolean;
  /** A machine reading rather than something a person typed. */
  reading?: boolean;
  /** Rendered by hand — a chip, a tick, something that is not text. */
  html?: (r: Row) => string;
}

const COLUMNS: Column[] = [
  { key: 'id', label: 'id', get: (r) => r.id, num: true },
  { key: 'catno_raw', label: 'catalogue', get: (r) => r.catno_raw, mono: true },
  { key: 'label_raw', label: 'label', get: (r) => r.label_raw },
  { key: 'name_raw', label: 'name', get: (r) => r.name_raw },
  { key: 'title_raw', label: 'title', get: (r) => r.title_raw },
  { key: 'year_raw', label: 'year', get: (r) => r.year_raw, mono: true },
  { key: 'crate', label: 'crate', get: (r) => [r.crate, r.position].filter(Boolean).join(' · ') },
  { key: 'matrix_runout', label: 'matrix', get: (r) => r.matrix_runout, mono: true },
  { key: 'media_grade', label: 'media', get: (r) => r.media_grade },
  { key: 'sleeve_grade', label: 'sleeve', get: (r) => r.sleeve_grade },
  {
    key: 'photo_count',
    label: 'photos',
    get: (r) => r.photo_count,
    num: true,
    html: (r) => `<td class="num">${r.photo_count || '<span class="empty">—</span>'}</td>`,
  },
  {
    key: 'reading_count',
    label: 'read',
    get: (r) => r.reading_count ?? 0,
    num: true,
    html: (r) => `<td class="num">${r.reading_count || '<span class="empty">—</span>'}</td>`,
  },
  {
    key: 'match_state',
    label: 'match',
    get: (r) => stateOf(r),
    html: (r) => `<td><span class="chip s-${stateOf(r)}">${stateOf(r)}</span>${
      r.release_confirmed ? '<span class="tick" title="release confirmed by a person">✓</span>' : ''}</td>`,
  },
  // The reading's own columns. Marked `.reading` so they never look
  // like something a person typed — the provenance rule permits showing
  // an unconfirmed value anywhere and requires it be shown AS
  // unconfirmed.
  { key: 'read_catno', label: 'read catalogue', get: (r) => r.read_catno, mono: true, reading: true },
  { key: 'read_label', label: 'read label', get: (r) => r.read_label, reading: true },
  { key: 'read_name', label: 'read name', get: (r) => r.read_name, reading: true },
  { key: 'read_title', label: 'read title', get: (r) => r.read_title, reading: true },
  { key: 'read_other', label: 'other numbers', get: (r) => r.read_other, mono: true, reading: true },
  { key: 'release_title', label: 'discogs title', get: (r) => r.release_title },
  { key: 'release_label', label: 'discogs label', get: (r) => r.release_label },
  { key: 'release_year', label: 'released', get: (r) => r.release_year, num: true },
  { key: 'discogs_id', label: 'discogs id', get: (r) => r.discogs_id, num: true, mono: true },
  { key: 'decision', label: 'decision', get: (r) => r.decision },
  { key: 'captured_by', label: 'by', get: (r) => r.captured_by },
  { key: 'captured_at', label: 'captured', get: (r) => r.captured_at, mono: true },
  { key: 'last_verified_at', label: 'verified', get: (r) => r.last_verified_at, mono: true },
  { key: 'import_ref', label: 'imported', get: (r) => r.import_ref, mono: true },
];

const COLUMN = new Map(COLUMNS.map((c) => [c.key, c]));

/** What the screen showed before it could be changed. */
const DEFAULT_COLS = ['id', 'catno_raw', 'label_raw', 'name_raw', 'title_raw',
  'crate', 'photo_count', 'match_state'];

/**
 * Named views, because two of these are questions somebody actually
 * asks and rebuilding them by hand every time is how they stop being
 * asked.
 *
 * `mop-up` is the one with a job: the maintainer ruled on 2026-08-31
 * that the sleeve-only rows get re-shot from the disc, and without a
 * filter naming them the crate gets assembled from memory. It is a
 * composition of state the row already carries — has a photograph, has
 * a reading off it, and still has no confirmed release.
 */
/**
 * A preset may set COLUMNS as well as filters.
 *
 * The mop-up crate is why. Those rows are photo-only, so their capture
 * columns are empty and the default eight rendered nineteen rows of
 * dashes — a filter that produces a list of ids answers "how many" and
 * not "which discs do I go and find". A view that changes what is
 * being looked FOR should be allowed to change what is shown.
 */
interface Preset { key: string; label: string; hint: string; apply: (v: View) => void }

const PRESETS: Preset[] = [
  {
    key: 'all',
    label: 'Everything',
    hint: 'No filter at all',
    apply: (v) => { v.state = ''; v.photos = ''; v.readings = ''; v.confirmed = ''; },
  },
  {
    key: 'review',
    label: 'Needs review',
    hint: 'What the matcher could not settle',
    apply: (v) => { v.state = 'needs-review'; v.photos = ''; v.readings = ''; v.confirmed = ''; },
  },
  {
    key: 'mop-up',
    label: 'Mop-up crate',
    hint: 'Photographed, read, and still unresolved — the discs to re-shoot',
    apply: (v) => {
      v.state = ''; v.photos = 'with'; v.readings = 'with'; v.confirmed = 'no';
      v.cols = ['id', 'read_catno', 'read_label', 'read_name', 'read_other',
        'photo_count', 'match_state'];
    },
  },
  {
    key: 'unphotographed',
    label: 'Never photographed',
    hint: 'The rows imported from the spreadsheet',
    apply: (v) => { v.state = ''; v.photos = 'without'; v.readings = ''; v.confirmed = ''; },
  },
  {
    key: 'settled',
    label: 'Confirmed',
    hint: 'A person has accepted the release',
    apply: (v) => { v.state = ''; v.photos = ''; v.readings = ''; v.confirmed = 'yes'; },
  },
];

interface View {
  text: string;
  state: string;
  photos: string;
  readings: string;
  confirmed: string;
  sort: string;
  dir: 'asc' | 'desc';
  cols: string[];
}

const view: View = {
  text: '', state: '', photos: '', readings: '', confirmed: '',
  sort: 'id', dir: 'asc', cols: [...DEFAULT_COLS],
};

/**
 * A view is a URL, which is what makes it shareable and bookmarkable —
 * and is how the mop-up crate gets used twice without being rebuilt.
 *
 * `replaceState`, not `pushState`: typing four characters into the
 * search box should not put four entries in the back button.
 */
function readUrl(): void {
  const q = new URLSearchParams(location.search);
  const preset = PRESETS.find((p) => p.key === q.get('view'));
  if (preset) preset.apply(view);
  for (const k of ['text', 'state', 'photos', 'readings', 'confirmed'] as const) {
    const v = q.get(k);
    if (v !== null) view[k] = v;
  }
  const sort = q.get('sort');
  if (sort && COLUMN.has(sort)) view.sort = sort;
  if (q.get('dir') === 'desc') view.dir = 'desc';
  const cols = q.get('cols')?.split(',').filter((c) => COLUMN.has(c));
  if (cols?.length) view.cols = cols;
}

function writeUrl(): void {
  const q = new URLSearchParams();
  for (const k of ['text', 'state', 'photos', 'readings', 'confirmed'] as const) {
    if (view[k]) q.set(k, view[k]);
  }
  if (view.sort !== 'id') q.set('sort', view.sort);
  if (view.dir !== 'asc') q.set('dir', view.dir);
  if (view.cols.join(',') !== DEFAULT_COLS.join(',')) q.set('cols', view.cols.join(','));
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

/**
 * Filtering and sorting are client-side, and that is a decision rather
 * than a shortcut: the whole collection arrives in one fetch, and a
 * filter that costs a round trip is a filter nobody uses. It stops
 * being true past the deferred 2,000–6,000 record batch, and
 * `/api/items` is already keyset-paged for that day.
 */
function visible(): Row[] {
  const needle = view.text.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (view.state && stateOf(r) !== view.state) return false;
    if (view.photos === 'with' && !r.photo_count) return false;
    if (view.photos === 'without' && r.photo_count) return false;
    if (view.readings === 'with' && !r.reading_count) return false;
    if (view.readings === 'without' && r.reading_count) return false;
    if (view.confirmed === 'yes' && !r.release_confirmed) return false;
    if (view.confirmed === 'no' && r.release_confirmed) return false;
    if (!needle) return true;
    // Search reaches every column that can be SHOWN, not the eight the
    // table happened to start with — a screen that can display a matrix
    // number and cannot find one is only half a tool.
    return COLUMNS.some((c) => String(c.get(r) ?? '').toLowerCase().includes(needle));
  });

  const col = COLUMN.get(view.sort) ?? COLUMN.get('id')!;
  const sign = view.dir === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    const x = col.get(a);
    const y = col.get(b);
    // ABSENT SORTS LAST IN BOTH DIRECTIONS, never first. A null is not
    // a small number and not an early date: 287 rows have never been
    // verified, and floating them to the top would bury whatever the
    // sort was actually asked for. The existing `verified` sort already
    // had to learn this.
    const ax = x === null || x === undefined || x === '';
    const bx = y === null || y === undefined || y === '';
    if (ax !== bx) return ax ? 1 : -1;
    if (ax && bx) return a.id - b.id;
    const cmp = col.num
      ? Number(x) - Number(y)
      : String(x).localeCompare(String(y), 'en-GB', { numeric: true });
    return (cmp || 0) * sign || a.id - b.id;
  });
  return out;
}

async function load(): Promise<void> {
  rows = [];
  let after = 0;
  // Paged rather than assumed. 484 rows arrive in one fetch at 500, and
  // the loop is what keeps that an optimisation rather than a limit.
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${API}/items?limit=500&after=${after}`, { headers: whoHeader() });
    if (!res.ok) throw new Error(`items: HTTP ${res.status}`);
    const body = await res.json() as { items: Row[]; nextAfter: number | null };
    rows.push(...body.items);
    if (body.nextAfter === null) break;
    after = body.nextAfter;
  }
  render();
}

const activePreset = (): string => PRESETS.find((p) => {
  const probe: View = { ...view, cols: [...view.cols] };
  p.apply(probe);
  return probe.state === view.state && probe.photos === view.photos
    && probe.readings === view.readings && probe.confirmed === view.confirmed;
})?.key ?? '';

function render(): void {
  writeUrl();
  const shown = visible();
  const withPhotos = rows.filter((r) => r.photo_count).length;
  const preset = activePreset();

  app.innerHTML = `
    ${headerHtml({ here: 'browse', title: 'The collection',
    aside: `<div class="tally"><b>${shown.length}</b> of ${rows.length} shown<br>
      ${withPhotos} photographed</div>` })}

    <div class="views">
      ${PRESETS.map((p) => `<button type="button" class="viewchip${p.key === preset ? ' on' : ''}"
        data-preset="${p.key}" title="${esc(p.hint)}">${esc(p.label)}</button>`).join('')}
      <button type="button" class="viewchip cols" id="colsBtn">Columns…</button>
    </div>

    <div class="filters controls">
      <label class="field grow"><span>Search</span>
        <input id="fText" type="search" placeholder="anything in any column"
          value="${esc(view.text)}"></label>
      <label class="field"><span>Match state</span>
        <select id="fState">
          <option value="">any</option>
          ${STATES.map((st) => `<option value="${st}"${view.state === st ? ' selected' : ''}>${st}
            (${rows.filter((r) => stateOf(r) === st).length})</option>`).join('')}
        </select></label>
      <label class="field"><span>Photographs</span>
        <select id="fPhotos">
          <option value="">any</option>
          <option value="with"${view.photos === 'with' ? ' selected' : ''}>has one</option>
          <option value="without"${view.photos === 'without' ? ' selected' : ''}>none</option>
        </select></label>
      <label class="field"><span>Reading</span>
        <select id="fReadings">
          <option value="">any</option>
          <option value="with"${view.readings === 'with' ? ' selected' : ''}>read</option>
          <option value="without"${view.readings === 'without' ? ' selected' : ''}>not read</option>
        </select></label>
      <label class="field"><span>Release</span>
        <select id="fConfirmed">
          <option value="">any</option>
          <option value="yes"${view.confirmed === 'yes' ? ' selected' : ''}>confirmed</option>
          <option value="no"${view.confirmed === 'no' ? ' selected' : ''}>not confirmed</option>
        </select></label>
    </div>

    <div class="tablewrap">
      <table class="rows">
        <thead><tr>${view.cols.map((k) => {
    const c = COLUMN.get(k);
    if (!c) return '';
    const on = view.sort === k;
    return `<th class="sortable" data-sort="${k}"${on ? ` aria-sort="${view.dir}ending"` : ''}
      >${esc(c.label)}${on ? `<span class="arrow"> ${view.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`;
  }).join('')}</tr></thead>
        <tbody>${shown.map(rowHtml).join('')}</tbody>
      </table>
    </div>
    ${shown.length ? '' : '<p class="empty-note">Nothing matches those filters.</p>'}

    <div class="detail" id="detail" hidden></div>
    <div id="toast"></div>`;

  const on = (id: string, ev: string, fn: (el: HTMLInputElement) => void): void => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener(ev, () => fn(el));
  };
  on('fText', 'input', (el) => { view.text = el.value; repaintList(); });
  on('fState', 'change', (el) => { view.state = el.value; render(); });
  on('fPhotos', 'change', (el) => { view.photos = el.value; render(); });
  on('fReadings', 'change', (el) => { view.readings = el.value; render(); });
  on('fConfirmed', 'change', (el) => { view.confirmed = el.value; render(); });

  for (const btn of app.querySelectorAll<HTMLButtonElement>('button[data-preset]')) {
    btn.addEventListener('click', () => {
      PRESETS.find((p) => p.key === btn.dataset.preset)?.apply(view);
      render();
    });
  }
  for (const th of app.querySelectorAll<HTMLElement>('th[data-sort]')) {
    th.addEventListener('click', () => {
      const k = th.dataset.sort ?? 'id';
      // Clicking the column already sorted turns it round; clicking a
      // new one starts ascending, which is what every table does.
      if (view.sort === k) view.dir = view.dir === 'asc' ? 'desc' : 'asc';
      else { view.sort = k; view.dir = 'asc'; }
      render();
    });
  }
  document.getElementById('colsBtn')?.addEventListener('click', openColumns);

  bindRows();
  if (openId !== null) void openDetail(openId);
}

/** The column chooser. Order follows COLUMNS, not the order ticked. */
function openColumns(): void {
  let dlg = document.getElementById('colsDlg') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'colsDlg';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Columns</h2></div>
    <div class="dlg-body">
      <div class="colgrid">
        ${COLUMNS.map((c) => `<label class="colopt">
          <input type="checkbox" value="${c.key}"${view.cols.includes(c.key) ? ' checked' : ''}>
          <span>${esc(c.label)}</span></label>`).join('')}
      </div>
      <p class="note">The view is in the address bar, so a set of columns and filters can be
        bookmarked or sent to somebody.</p>
    </div>
    <div class="dlg-foot">
      <button class="btn btn-ghost" id="colsReset" type="button">Reset</button>
      <button class="btn btn-primary" id="colsDone" type="button">Done</button>
    </div>`;
  const apply = (): void => {
    const ticked = [...dlg!.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
    // At least one column, or the table becomes an invisible list of
    // rows that still respond to clicks.
    view.cols = ticked.length ? COLUMNS.filter((c) => ticked.includes(c.key)).map((c) => c.key) : [...DEFAULT_COLS];
  };
  dlg.querySelector('#colsDone')?.addEventListener('click', () => { apply(); dlg?.close(); render(); });
  dlg.querySelector('#colsReset')?.addEventListener('click', () => {
    view.cols = [...DEFAULT_COLS];
    dlg?.close();
    render();
  });
  dlg.showModal();
}

/**
 * Repaint the rows without rebuilding the filter bar.
 *
 * Typing in the search box must not take the focus out of it, which is
 * what a full `render()` on every keystroke did.
 */
function repaintList(): void {
  writeUrl();
  const shown = visible();
  const body = app.querySelector('tbody');
  if (body) body.innerHTML = shown.map(rowHtml).join('');
  const counts = app.querySelector('.tally');
  if (counts) {
    counts.innerHTML = `<b>${shown.length}</b> of ${rows.length} shown<br>`
      + `${rows.filter((r) => r.photo_count).length} photographed`;
  }
  bindRows();
}

function bindRows(): void {
  for (const tr of app.querySelectorAll<HTMLElement>('tr[data-id]')) {
    tr.addEventListener('click', () => { void openDetail(Number(tr.dataset.id)); });
  }
}

const cell = (v: unknown, c: Column): string => (v === null || v === undefined || v === ''
  ? '<td class="empty">—</td>'
  : `<td class="${c.num ? 'num' : ''}${c.mono ? ' mono' : ''}${c.reading ? ' reading' : ''}"${
    c.reading ? ' title="read off a photograph — not confirmed by a person"' : ''
  }>${esc(v)}</td>`);

function rowHtml(r: Row): string {
  return `<tr data-id="${r.id}" tabindex="0" class="${openId === r.id ? 'open' : ''}">${
    view.cols.map((k) => {
      const c = COLUMN.get(k);
      if (!c) return '';
      return c.html ? c.html(r) : cell(c.get(r), c);
    }).join('')}</tr>`;
}

async function openDetail(id: number): Promise<void> {
  openId = id;
  const panel = document.getElementById('detail')!;
  panel.hidden = false;
  panel.innerHTML = '<p class="empty-note">Loading…</p>';
  const res = await fetch(`${API}/items/${id}`, { headers: whoHeader() });
  if (!res.ok) { panel.innerHTML = `<p class="empty-note">Could not load item ${id}.</p>`; return; }
  panel.innerHTML = detailHtml(await res.json() as Detail);
  panel.querySelector('#closeDetail')?.addEventListener('click', () => {
    openId = null;
    panel.hidden = true;
    for (const tr of app.querySelectorAll('tr.open')) tr.classList.remove('open');
  });
  wireEditing(panel, id);
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * The four operations, bound after the panel is painted.
 *
 * Every one of them RELOADS rather than patching the DOM in place. The
 * provenance mark is the thing that changed and showing it stale would
 * be worse than the round trip is slow — and the row in the table above
 * carries the same value, so a detail that refreshed alone left a
 * corrected crate reading its old value two inches higher up.
 */
async function afterWrite(message: string): Promise<void> {
  // `load` repaints the list and re-opens the detail, which also
  // rebuilds the toast element — so the message goes up afterwards.
  await load();
  flash(message);
}
function wireEditing(panel: HTMLElement, id: number): void {
  const unlock = panel.querySelector<HTMLFormElement>('#unlock');
  panel.querySelector('#lockBtn')?.addEventListener('click', () => {
    if (!unlock) return;
    unlock.hidden = !unlock.hidden;
    if (!unlock.hidden) panel.querySelector<HTMLInputElement>('#tokenBox')?.focus();
  });
  unlock?.addEventListener('submit', (e) => {
    e.preventDefault();
    const box = panel.querySelector<HTMLInputElement>('#tokenBox');
    if (!box?.value) return;
    editToken.set(box.value);
    box.value = '';
    unlock.hidden = true;
    void openDetail(id);
  });

  /** A name is required: an unattributed confirmation is nobody's. */
  const who = (): string | null => {
    const name = storedCapturer();
    if (!name) flash('Set your name on the review queue first — a confirmation must say who made it.', 'err');
    return name;
  };

  for (const btn of panel.querySelectorAll<HTMLButtonElement>('button.ok')) {
    btn.addEventListener('click', async () => {
      const name = who();
      if (!name) return;
      const ok = await write(`/items/${id}/field`, {
        entity: btn.dataset.entity, field: btn.dataset.field, confirmedBy: name,
      });
      if (ok) await afterWrite(`${btn.dataset.field} confirmed.`);
    });
  }

  for (const btn of panel.querySelectorAll<HTMLButtonElement>('button.promote')) {
    btn.addEventListener('click', async () => {
      const name = who();
      if (!name) return;
      const ok = await write(`/items/${id}/promote`, { field: btn.dataset.field, confirmedBy: name });
      if (ok) await afterWrite(`${btn.dataset.field} taken from the photograph.`);
    });
  }

  for (const btn of panel.querySelectorAll<HTMLButtonElement>('button.edit')) {
    btn.addEventListener('click', () => {
      const cell = btn.closest('dd');
      if (!cell || cell.querySelector('input')) return;
      const entity = btn.dataset.entity ?? '';
      const field = btn.dataset.field ?? '';
      const before = btn.dataset.value ?? '';

      // In place, per the maintainer's decision: the value becomes a
      // box where it stands, Enter saves and Escape puts it back.
      const editor = document.createElement('form');
      editor.className = 'inline';
      editor.innerHTML = `<input value="${esc(before)}" autocomplete="off" spellcheck="false">
        <button type="submit" class="tiny ok-save" title="Save">save</button>
        <button type="button" class="tiny cancel" title="Leave it alone">cancel</button>`;
      const kept = cell.innerHTML;
      cell.innerHTML = '';
      // `appendChild`, not `append`: with @cloudflare/workers-types in
      // scope the bare `append` resolves to the Worker FormData one.
      cell.appendChild(editor);
      const box = editor.querySelector('input')!;
      box.focus();
      box.select();

      const restore = (): void => { cell.innerHTML = kept; wireEditing(panel, id); };
      editor.querySelector('button.cancel')?.addEventListener('click', restore);
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') restore(); });
      editor.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = who();
        if (!name) return;
        // Unchanged text is a confirmation, not a correction, and it is
        // filed as one — the schema cannot tell them apart afterwards,
        // so the distinction has to be made here or not at all.
        const value = box.value.trim();
        const body: Record<string, unknown> = { entity, field, confirmedBy: name };
        if (value !== before.trim()) body.value = value === '' ? null : value;
        const ok = await write(`/items/${id}/field`, body);
        if (ok) await afterWrite(value === before.trim() ? `${field} confirmed.` : `${field} corrected.`);
        else restore();
      });
    });
  }
}

/**
 * The mark on one field: where the value came from, and whether a
 * person has said it is right.
 *
 * Absent provenance is said out loud rather than left blank. A field
 * with no `field_source` row is not the same as one sourced at the
 * shelf, and the difference is exactly what this screen exists to show.
 */
function mark(p: Provenance | undefined): string {
  if (!p) return '<span class="prov none">no provenance recorded</span>';
  const label = SOURCE_LABEL[p.source] ?? p.source;
  return p.confirmed_at
    ? `<span class="prov ok">${esc(label)} · confirmed by ${esc(p.confirmed_by)}</span>`
    : `<span class="prov">${esc(label)} · unconfirmed</span>`;
}

function detailHtml(d: Detail): string {
  const item = d.item as Record<string, string | number | null>;
  const capture = (d.captures[0] ?? {}) as Record<string, string | null>;
  const captureId = Number(capture.id ?? -1);

  const provOf = (entity: string, entityId: number, field: string): Provenance | undefined =>
    d.provenance.find((p) => p.entity === entity && p.entity_id === entityId && p.field === field);

  /**
   * One field: its value, its provenance, and the two things a person
   * can say about it.
   *
   * `data-*` rather than closures because the panel is rebuilt from a
   * string; the handlers are bound once, after.
   */
  const line = (label: string, value: unknown, entity: string, entityId: number, field: string,
    editable = true): string => {
    const shown = value === null || value === undefined || value === ''
      ? '<span class="empty">—</span>' : esc(value);
    const tools = editable
      ? `<span class="ftools">
          <button type="button" class="tiny edit" data-entity="${entity}" data-field="${field}"
            data-value="${esc(value ?? '')}" title="Correct this value">✎</button>
          <button type="button" class="tiny ok" data-entity="${entity}" data-field="${field}"
            title="Confirm this value is right">✓</button>
        </span>`
      : '';
    return `<dt>${esc(label)}</dt><dd data-field-cell="${entity}.${field}">${shown}${tools}<br>${
      mark(provOf(entity, entityId, field))}</dd>`;
  };

  return `
    <div class="dhead">
      <h2>Item ${esc(item.id)}</h2>
      <div class="dtools">
        <span class="prov">${storedCapturer()
    ? `editing as ${esc(storedCapturer())}`
    : '<span class="warnish">no name on this device — set one on the review queue</span>'}</span>
        <button type="button" id="lockBtn" class="btn btn-quiet">${
  editToken.get() ? 'Editing unlocked' : 'Unlock editing'}</button>
        <button type="button" id="closeDetail" class="btn btn-quiet">Close</button>
      </div>
    </div>
    <form class="unlock" id="unlock" hidden>
      <label class="field"><span>Passphrase</span><input id="tokenBox" type="password"
        autocomplete="current-password"></label>
      <button type="submit" class="btn btn-ghost">Keep on this device</button>
    </form>

    <div class="dsplit">
      <section>
        <h3>Read off the disc</h3>
        <dl class="facts">
          ${line('Catalogue number', capture.catno_raw, 'capture', captureId, 'catno_raw')}
          ${line('Label', capture.label_raw, 'capture', captureId, 'label_raw')}
          ${line('Name', capture.name_raw, 'capture', captureId, 'name_raw')}
          ${line('Title', capture.title_raw, 'capture', captureId, 'title_raw')}
          ${line('Matrix / runout', capture.matrix_runout, 'capture', captureId, 'matrix_runout')}
          ${line('Year', capture.year_raw, 'capture', captureId, 'year_raw')}
        </dl>
        ${d.captures.length > 1
    ? `<p class="empty-note">${d.captures.length} capture rows on this item; the newest is shown.</p>`
    : ''}

        <h3>The physical record</h3>
        <dl class="facts">
          ${line('Crate', item.crate, 'item', Number(item.id), 'crate')}
          ${line('Position', item.position, 'item', Number(item.id), 'position')}
          ${line('Media', item.media_grade, 'item', Number(item.id), 'media_grade')}
          ${line('Sleeve', item.sleeve_grade, 'item', Number(item.id), 'sleeve_grade')}
          ${line('Notes', item.notes, 'item', Number(item.id), 'notes')}
          ${/* Not editable here: only the review queue may confirm a
                release, which is the one thing that opens the decision
                views. A screen that could set it would route around the
                corroboration gate entirely. */ ''}
          ${line('Release', item.release_id, 'item', Number(item.id), 'release_id', false)}
          <dt>Captured by</dt><dd>${item.captured_by ? esc(item.captured_by) : '<span class="empty">—</span>'}
            ${item.captured_at ? `<br><span class="prov">${esc(item.captured_at)}</span>` : ''}</dd>
          <dt>Imported from</dt><dd>${item.import_ref ? esc(item.import_ref) : '<span class="empty">—</span>'}</dd>
        </dl>

        ${d.readings.length ? `
        <h3>Readings not yet in the model</h3>
        <p class="empty-note">Held in <code>raw_value</code> — displayed, and unreachable from
          any cluster, coverage check or sell list until a person confirms one.</p>
        <dl class="facts">${d.readings.map((r) => `<dt>${esc(r.field)}</dt><dd>${esc(r.value)}${
    (CAPTURE_FIELDS as readonly string[]).includes(r.field)
      ? `<span class="ftools"><button type="button" class="tiny promote" data-field="${esc(r.field)}"
           title="Yes, that is what the label says">promote</button></span>`
      : ''}<br>${mark(provOf('raw_value', r.id, r.field))}</dd>`).join('')}</dl>` : ''}
      </section>

      <section>
        <h3>Photographs ${d.photos.length ? `<span class="n">${d.photos.length}</span>` : ''}</h3>
        ${d.photos.length
    ? `<div class="shots">${d.photos.map((p, i) => `
         <figure class="shotfig">
           <img src="${API}/photos/${encodeURI(p.r2_key)}"
                alt="Photograph ${i + 1} of item ${d.item.id}">
           <figcaption><span class="n">${i + 1}</span>
             ${esc(p.added_at)}${p.kind === 'other' ? '' : ` · ${esc(p.kind)}`}</figcaption>
         </figure>`).join('')}</div>`
    : '<p class="empty-note">No photograph. This is one of the 446 rows imported from the spreadsheet.</p>'}

        <h3>Match history</h3>
        ${d.runs.length ? d.runs.map(runHtml).join('')
    : '<p class="empty-note">Never matched. The matcher runs from cron and has not reached this row.</p>'}
      </section>
    </div>`;
}

function runHtml(run: Run): string {
  const reason = parse<{ reason?: string }>(run.queries_json, {}).reason ?? '';
  return `<div class="run">
    <div class="rhead"><span class="state s-${esc(run.state)}">${esc(run.state)}</span>
      <span class="prov">${esc(run.ran_at)}</span></div>
    ${reason ? `<p class="why">${esc(reason)}</p>` : ''}
    ${run.candidates.map((cand) => {
    const sig = parse<{ families?: string[] }>(cand.signals_json, {});
    return `<div class="cand-row"><span class="rank">${cand.rank}</span>
        <span class="did">Discogs ${cand.discogs_id}</span>
        <span class="fams">${(sig.families ?? []).map((f) => `<span class="chip accent">${esc(f)}</span>`).join('')}</span>
        <span class="score">${cand.score}</span></div>`;
  }).join('')}
    ${run.decision
    ? `<p class="verdict"><strong>${esc(run.decision.choice)}</strong>${
      run.decision.discogs_id ? ` → Discogs ${run.decision.discogs_id}` : ''
    } · ${esc(run.decision.decided_by)} · ${esc(run.decision.decided_at)}${
      run.decision.note ? ` · ${esc(run.decision.note)}` : ''}</p>`
    : '<p class="verdict none">No decision recorded.</p>'}
  </div>`;
}

app.innerHTML = '<p class="empty-note">Loading the collection…</p>';
// A device that named itself before photographs needed a cookie has one
// in localStorage and none in document.cookie; without this its images
// stay broken for reasons it cannot see.
ensureCapturerCookie();
readUrl();
bootChrome(SCREEN_KEYS);

/**
 * Escape closes the detail panel.
 *
 * `chrome.ts` handles Escape for dialogs and for leaving a field; a
 * panel that is neither has to say so itself. The order matters: the
 * shared handler blurs a focused input first, so pressing Escape while
 * editing a value leaves the editor rather than closing the row under
 * it.
 */
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || openId === null) return;
  const panel = document.getElementById('detail');
  if (!panel || panel.hidden) return;
  if (document.querySelector('dialog[open]')) return;
  openId = null;
  panel.hidden = true;
  for (const tr of app.querySelectorAll('tr.open')) tr.classList.remove('open');
});
load().catch((err: unknown) => {
  app.innerHTML = `<p class="note-bad">Could not load the collection: ${
    esc(err instanceof Error ? err.message : String(err))}</p>`;
});
