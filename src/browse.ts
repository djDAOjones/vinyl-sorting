import type { SimilarPrice } from '../worker/pricing.ts';
import type { SourcePreparation } from '../worker/source-preparation.ts';
import { musicbrainzPanelHtml, wireMusicbrainz } from './musicbrainz-panel.ts';
import { followupHtml, wirePhotoActions, refreshAdditionStatus, type PhotoRequest } from './collection-photos.ts';
import { startAdditions } from './photo-additions.ts';
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
  returnToTopHtml, bootChrome, choiceLabel, esc, headerHtml, isKnownList, knownLists, labelOf, parseJson as parse,
  restoreListFocus, storedList, toast,
} from './chrome.ts';
import { recordSummary } from './record-summary.ts';
import { itemStatus, STATUS_LABELS, SEARCH_LABELS, DECISION_LABELS, type ItemStatus } from './item-status.ts';
import { checkRow } from '../worker/match/sanity.ts';
import type { MatchRow } from '../worker/match/run.ts';
import type { ListChoice } from './lists.ts';

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
  list: string | null;
  crate: string | null; position: string | null;
  media_grade: string | null; sleeve_grade: string | null;
  decision: string; captured_by: string | null; captured_at: string | null;
  import_ref: string | null; last_verified_at: string | null;
  catno_raw: string | null; label_raw: string | null;
  name_raw: string | null; title_raw: string | null; year_raw: string | null;
  discogs_id: number | null; release_label: string | null; release_title: string | null;
  photo_count: number;
  photo_needed?: string | null;
  reading_count: number;
  read_catno: string | null;
  read_label: string | null;
  read_name: string | null;
  read_title: string | null;
  read_other: string | null;
  matrix_runout: string | null;
  release_year: number | null;
  match_state: string | null;
  review_choice?: string | null;
  match_ran_at?: string | null;
  match_queries_run?: number | null;
  match_query_errors?: number | null;
  match_incomplete?: number | null;
  match_retry?: string | null;
  match_manual_review?: number | null;
  release_confirmed: number;
  similar_price?: SimilarPrice | null;
  lowest_price: number | null;
  num_for_sale: number | null;
  price_checked_at: string | null;
}

interface Provenance {
  entity: string; entity_id: number; field: string; source: string;
  confidence: number | null; confirmed_by: string | null; confirmed_at: string | null;
}
interface Photo { id: number; kind: string; r2_key?: string; added_at: string }
interface Candidate { rank: number; discogs_id: number; score: number; signals_json: string }
interface Decision {
  choice: string; discogs_id: number | null; decided_by: string; decided_at: string; note: string | null;
}
interface Run {
  id: number; state: string; ran_at: string; queries_json: string;
  candidates: Candidate[]; decision: Decision | null;
}
interface Detail {
  sourcePreparation?: SourcePreparation | null;
  matching?: { input: MatchRow; usable: boolean; reason: string } | null;
  photoRequests?: PhotoRequest[];
  release: Record<string, unknown> | null;
  item: Record<string, unknown>;
  captures: Record<string, unknown>[];
  photos: Photo[];
  provenance: Provenance[];
  readings: { id: number; field: string; value: string }[];
  runs: Run[];
}

let rows: Row[] = [];
let snapshot: { savedAt: string; resumesAt: string | null } | null = null;
let openId: number | null = null;
let detailRequest = 0;
interface CollectionPosition { x: number; y: number; left: number; top: number; row: number | null }
let collectionPosition: CollectionPosition = { x: 0, y: 0, left: 0, top: 0, row: null };
const recordInUrl = (): number | null => {
  const raw = new URLSearchParams(location.search).get('item');
  return raw && /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
};

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
    headers: { 'content-type': 'application/json', 'x-edit-token': token, ...whoHeader() },
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
  { keys: 'Esc', what: 'Back to the collection' },
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

const STATES = Object.keys(STATUS_LABELS) as ItemStatus[];
const stateOf = (r: Row): ItemStatus => itemStatus({
  confirmed: r.release_confirmed, choice: r.review_choice, state: r.match_state,
  ranAt: r.match_ran_at, queriesRun: r.match_queries_run, queryErrors: r.match_query_errors,
  incomplete: r.match_incomplete, retry: r.match_retry, manualReview: r.match_manual_review,
  searchable: checkRow({
    catnoRaw: r.catno_raw?.trim() || r.read_catno, labelRaw: r.label_raw?.trim() || r.read_label,
    titleRaw: r.title_raw?.trim() || r.read_title, nameRaw: r.name_raw?.trim() || r.read_name,
    otherNumbers: r.read_other,
  }).usable,
});

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
/** Present, where an empty string is as absent as a null. */
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/**
 * The price, in the ONE currency every stored figure is in.
 *
 * `release.lowest_price` is a bare REAL with no currency column beside
 * it, and `PRICE_CURRENCY` in `worker/discogs.ts` is what every writer
 * fetches in. If that constant ever changes, this must change with it
 * and the stored figures must be re-fetched — a column holding two
 * currencies is a column holding neither.
 */
const MONEY = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A D1 `datetime('now')` string, which is UTC and space-separated.
 *
 * `new Date('2026-09-14 12:00:00')` is not a format the standard
 * defines — Safari has historically returned an Invalid Date for it —
 * so it is made explicit rather than left to the engine.
 */
function stamp(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.replace(' ', 'T')}${/[Z+]/.test(iso) ? '' : 'Z'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const daysSince = (iso: string | null): number | null => {
  const d = stamp(iso);
  return d ? (Date.now() - d.getTime()) / 86_400_000 : null;
};

/** How old a price may be before the screen says so out loud. */
const PRICE_STALE_DAYS = 30;

/**
 * The `~value` cell.
 *
 * THREE STATES, NOT TWO, and conflating any of them is the whole
 * reason this column stayed empty rather than being faked:
 *
 *   never checked      an em-dash. Nothing is claimed.
 *   checked, none for   `none` — a FACT about the marketplace, and the
 *     sale             opposite of a missing reading. Some of these are
 *                      the rare ones.
 *   checked, priced    `~£12.50`, tilde included: this is the cheapest
 *                      listing somebody is ASKING, not a valuation and
 *                      not what the disc would fetch.
 *
 * A figure over PRICE_STALE_DAYS old is dimmed and dated in place, so a
 * stale market snapshot cannot read as today's (CATALOGUE-CONTROLS).
 */
function valueCell(r: Row): string {
  if (!has(r.lowest_price) && r.similar_price) {
    const e = r.similar_price;
    const at = stamp(e.checkedAt);
    const stale = (daysSince(e.checkedAt) ?? 0) > PRICE_STALE_DAYS;
    return `<td class="num money${stale ? ' stale' : ''}">~${esc(MONEY.format(e.amount))}
      <a class="asat" href="https://www.discogs.com/release/${e.sourceReleaseId}" target="_blank" rel="noopener noreferrer"
        title="Estimate from another vinyl edition · lowest asking price · ${esc([e.country, e.year, at ? DAY.format(at) : e.checkedAt].filter(Boolean).join(' · '))}">similar edition</a>
      ${stale && at ? `<span class="asat">${esc(DAY.format(at))}</span>` : ''}</td>`;
  }
  const when = r.price_checked_at;
  if (!has(r.lowest_price) && !when) return '<td class="empty">—</td>';
  const at = stamp(when);
  // A date that will not parse is still a date SOMETHING wrote. Saying
  // "never checked" for it would turn a formatting fault into a false
  // claim about the collection, so the raw value is shown instead.
  const checked = at ? `checked ${DAY.format(at)}` : when ? `checked ${when}` : 'never checked';
  if (!has(r.lowest_price)) {
    return `<td class="num empty" title="nothing listed on Discogs — ${esc(checked)}">none</td>`;
  }
  const age = daysSince(when);
  const stale = age !== null && age > PRICE_STALE_DAYS;
  const listings = has(r.num_for_sale)
    ? `lowest of ${r.num_for_sale} listing${r.num_for_sale === 1 ? '' : 's'} on Discogs`
    : 'lowest listing on Discogs';
  return `<td class="num money${stale ? ' stale' : ''}" title="${esc(listings)} — ${esc(checked)}"
    >~${esc(MONEY.format(r.lowest_price as number))}${
    stale && at ? `<span class="asat"> ${esc(DAY.format(at))}</span>` : ''}</td>`;
}

/**
 * A capture column that falls back, in provenance order, to whatever
 * the row actually knows: what a person typed, then what a machine read
 * off a photograph, then what Discogs says.
 *
 * WHY IT HAS TO FALL BACK AT ALL. The mop-up rows were photographed and
 * read but never typed at, and the 446 imported rows kept their label
 * in `release.label` because M0's spreadsheet column came FROM Discogs
 * — so `label` was filled on 61 of 500 rows and the column the
 * maintainer asked for was 88% em-dashes. A collection screen that
 * cannot name its own records is not answering the question.
 *
 * EACH TIER IS SHOWN AS WHAT IT IS. The provenance rule permits
 * displaying a `guess`, a `legacy` or an unconfirmed `discogs` value
 * anywhere, and requires it be displayed AS unconfirmed: both machine
 * tiers lean, and the tooltip says which machine and that nobody has
 * confirmed it. Only a value a PERSON stands behind stands upright.
 *
 * DISPLAY ONLY, and that is the boundary. `/api/items` still returns
 * capture, reading and release in separate columns and nothing merges
 * them there — duplicate detection runs on what a person read, and this
 * function is not in that path. Nor does anything here reach a cluster,
 * a coverage check or a sell list, which read the `v_*` views. The
 * separate `read name` / `discogs label` columns stay choosable for
 * anyone who wants the tiers side by side.
 */
interface Tier { get: (r: Row) => unknown; cls: string; why: string }

const readThrough = (key: string, label: string, ...tiers: Tier[]): Column => {
  const firstKnown = (r: Row): Tier | undefined => tiers.find((t) => has(t.get(r)));
  return {
    key,
    label,
    // Sorting and searching see whatever the cell SHOWS. A label you
    // can read on screen and cannot find by typing it is the worse bug.
    get: (r) => firstKnown(r)?.get(r),
    html: (r) => {
      const tier = firstKnown(r);
      if (!tier) return '<td class="empty">—</td>';
      return `<td class="${tier.cls}"${tier.why ? ` title="${esc(tier.why)}"` : ''}>${esc(tier.get(r))}</td>`;
    },
  };
};

/** What a person typed at the shelf, and stands behind. */
const typed = (get: (r: Row) => unknown): Tier => ({ get, cls: '', why: '' });
/** What a machine read off a photograph of the disc. */
const read = (get: (r: Row) => unknown): Tier => ({
  get, cls: 'reading', why: 'read off a photograph — not confirmed by a person',
});
/** What Discogs says about the matched release. */
const sourced = (get: (r: Row) => unknown): Tier => ({
  get, cls: 'sourced', why: 'from Discogs — not confirmed by a person',
});

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
  // Label reaches Discogs; name and title do not. `release_title` is a
  // combined "artist — title" string filled on 14 rows, so falling back
  // to it would write an artist into the title column to gain almost
  // nothing — and capture already answers name on 365 rows and title on
  // 410 of 500.
  readThrough('label_raw', 'label',
    typed((r) => r.label_raw), read((r) => r.read_label), sourced((r) => r.release_label)),
  readThrough('name_raw', 'name', typed((r) => r.name_raw), read((r) => r.read_name)),
  readThrough('title_raw', 'title', typed((r) => r.title_raw), read((r) => r.read_title)),
  { key: 'year_raw', label: 'year', get: (r) => r.year_raw, mono: true },
  { key: 'crate', label: 'crate', get: (r) => [r.crate, r.position].filter(Boolean).join(' · ') },
  // The list a disc is on (FOUR-LISTS). Unsorted is an empty cell, not
  // a word: it is the absence of a filing rather than a fifth list.
  { key: 'list', label: 'list', get: (r) => (isKnownList(r.list) ? labelOf(r.list) : r.list) },
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
    label: 'status',
    get: (r) => STATUS_LABELS[stateOf(r)],
    html: (r) => `<td><span class="chip s-${stateOf(r)}">${STATUS_LABELS[stateOf(r)]}</span></td>`,
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
  /**
   * What the collection screen was asked for and could not answer.
   *
   * Sorted on `lowest_price` and NOT on the cell's text, so `none` and
   * `—` both fall to the end in both directions — which is the rule
   * every absent value on this screen already follows, and the one
   * CATALOGUE-CONTROLS closes on.
   */
  { key: 'value', label: '~value', get: (r) => r.lowest_price ?? r.similar_price?.amount ?? null, num: true, html: valueCell },
  // The date on its own, for anyone who wants staleness as a column
  // rather than as a tooltip — the same shape as `verified`.
  { key: 'price_checked_at', label: 'priced', get: (r) => r.price_checked_at, mono: true },
  { key: 'num_for_sale', label: 'for sale', get: (r) => r.num_for_sale, num: true },
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

/**
 * The six columns the collection screen opens on — maintainer's call,
 * 2026-09-14, in this order: id, name, title, label, ~value, match.
 *
 * The nine it replaces are not gone: catalogue, crate, list, photos and
 * eighteen more are one tick away in the column chooser, and any set
 * travels in the URL. What changed is what the screen answers WITHOUT
 * being configured — what have I got, and what is it worth — rather
 * than where each disc is filed, which the list selector in the header
 * now answers by itself.
 */
const DEFAULT_COLS = ['id', 'name_raw', 'title_raw', 'label_raw', 'value', 'match_state'];

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

const needsPhotos = (r: Row) => Boolean(r.photo_needed) || r.photo_count === 0;
const PRESETS: Preset[] = [
  { key: 'unresolved', label: 'Not confirmed', hint: 'Prepare every record that still needs an identification',
    apply: v => { v.state = ''; v.photos = ''; v.readings = ''; v.confirmed = 'no'; } },
  { key: 'needs-photos', label: 'Needs photos', hint: 'Requested photographs and records with no photos', apply: v => { v.state=''; v.photos='needed'; v.readings=''; v.confirmed=''; } },
  {
    key: 'all',
    label: 'Everything',
    hint: 'No filter at all',
    apply: (v) => { v.state = ''; v.photos = ''; v.readings = ''; v.confirmed = ''; },
  },
  {
    key: 'review',
    label: 'Needs review',
    hint: 'Candidates waiting for a decision',
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
  Object.assign(view, { text: '', state: '', photos: '', readings: '', confirmed: '',
    sort: 'id', dir: 'asc', cols: [...DEFAULT_COLS] });
  const q = new URLSearchParams(location.search);
  const preset = PRESETS.find((p) => p.key === q.get('view'));
  if (preset) preset.apply(view);
  for (const k of ['text', 'state', 'photos', 'readings', 'confirmed'] as const) {
    const v = q.get(k);
    if (v !== null) view[k] = v;
  }
  const oldStates: Record<string, ItemStatus> = {
    'auto-accepted': 'check-match', rejected: 'not-identified', error: 'search-failed', pending: 'searching', unmatched: 'waiting',
  };
  view.state = oldStates[view.state] ?? view.state;
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
  if (openId !== null) q.set('item', String(openId));
  const s = q.toString();
  history.replaceState(history.state, '', s ? `?${s}` : location.pathname);
}

/**
 * Filtering and sorting are client-side, and that is a decision rather
 * than a shortcut: the whole collection arrives in one fetch, and a
 * filter that costs a round trip is a filter nobody uses. It stops
 * being true past the deferred 2,000–6,000 record batch, and
 * `/api/items` is already keyset-paged for that day.
 */
/**
 * Whether a row is on the list in view (FOUR-LISTS).
 *
 * The device's list is the outermost filter on this screen and is NOT
 * part of the URL: a view sent to somebody shows their list, which is
 * the point of the setting being per device. Everything else about
 * the view still travels.
 */
const inScope = (r: Row, scope: ListChoice): boolean =>
  (scope === '' ? true : scope === 'unsorted' ? r.list === null : r.list === scope);

/** The header count: what is shown, out of what is on the list in view. */
function tallyHtml(shown: number): string {
  const scope = storedList();
  const base = rows.filter((r) => inScope(r, scope));
  return `<b>${shown}</b> of ${base.length} shown<br>`
    + `${base.filter((r) => r.photo_count).length} photographed`
    + (scope ? `<br>${esc(choiceLabel(scope))}` : '');
}

function visible(): Row[] {
  const needle = view.text.trim().toLowerCase();
  const scope = storedList();
  const out = rows.filter((r) => {
    if (!inScope(r, scope)) return false;
    if (view.state && stateOf(r) !== view.state) return false;
    if (view.photos === 'needed' && !needsPhotos(r)) return false;
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
    return (r.photo_needed ?? '').toLowerCase().includes(needle) || COLUMNS.some((c) => String(c.get(r) ?? '').toLowerCase().includes(needle));
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
    const ax = !has(x);
    const bx = !has(y);
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
  snapshot = null;
  let after = 0;
  // Paged rather than assumed. 484 rows arrive in one fetch at 500, and
  // the loop is what keeps that an optimisation rather than a limit.
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${API}/items?limit=500&after=${after}`, { headers: whoHeader() });
    if (!res.ok) {
      const failure = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error || `items: HTTP ${res.status}`);
    }
    const body = await res.json() as { items: Row[]; nextAfter: number | null; snapshot?: { savedAt: string; resumesAt: string | null } };
    if (body.snapshot && (!snapshot || body.snapshot.savedAt < snapshot.savedAt)) snapshot = body.snapshot;
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
  void refreshAdditionStatus().catch(() => {});
  writeUrl();
  const shown = visible();
  const scope = storedList();
  const preset = activePreset();

  app.innerHTML = `
    ${snapshot ? `<p class="photo-needs" role="status">Saved list · ${esc(new Date(snapshot.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${snapshot.resumesAt ? `Live access resumes at ${esc(new Date(snapshot.resumesAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}` : 'Live access temporarily unavailable'} · <a href="${esc(location.href)}">Refresh</a></p>` : ''}
    <div id="collectionView"${openId !== null ? ' hidden' : ''}>
    ${headerHtml({ here: 'browse', title: 'The collection',
    aside: `<div class="tally">${tallyHtml(shown.length)}</div>` })}

    <div class="views">
      ${PRESETS.map((p) => `<button type="button" class="viewchip${p.key === preset ? ' on' : ''}"
        data-preset="${p.key}" title="${esc(p.hint)}">${esc(p.label)}${p.key === 'needs-photos' ? ` · ${rows.filter(r => inScope(r, scope) && needsPhotos(r)).length}` : ''}</button>`).join('')}
      <button type="button" class="viewchip cols" id="colsBtn">Columns…</button>
    </div>

    <p class="photo-needs" data-collection-upload-status role="status" hidden></p>
    <div class="filters controls">
      <label class="field grow"><span>Search</span>
        <input id="fText" type="search" placeholder="anything in any column"
          value="${esc(view.text)}"></label>
      <label class="field"><span>Status</span>
        <select id="fState">
          <option value="">any</option>
          ${STATES.map((st) => `<option value="${st}"${view.state === st ? ' selected' : ''}>${STATUS_LABELS[st]}
            (${rows.filter((r) => inScope(r, scope) && stateOf(r) === st).length})</option>`).join('')}
        </select></label>
      <label class="field"><span>Photographs</span>
        <select id="fPhotos">
          <option value="">any</option>
          <option value="needed"${view.photos === 'needed' ? ' selected' : ''}>needs photos</option>
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
        <thead><tr>${columnHeadersHtml()}</tr></thead>
        <tbody>${shown.map(rowHtml).join('')}</tbody>
      </table>
    </div>
    ${shown.length ? '' : '<p class="empty-note">Nothing matches those filters.</p>'}
    ${returnToTopHtml}

    </div>
    <section class="detail" id="detail" aria-label="Record details" hidden></section>
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
  bindSortHeaders();
  document.getElementById('colsBtn')?.addEventListener('click', openColumns);

  bindRows();
  if (openId !== null) void openDetail(openId, false);
  restoreListFocus();
}

function columnHeadersHtml(): string {
  return view.cols.map((k) => {
    const c = COLUMN.get(k);
    if (!c) return '';
    const on = view.sort === k;
    return `<th class="sortable" data-sort="${k}"${on ? ` aria-sort="${view.dir}ending"` : ''}
      >${esc(c.label)}${on ? `<span class="arrow"> ${view.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`;
  }).join('');
}

function bindSortHeaders(): void {
  for (const th of app.querySelectorAll<HTMLElement>('th[data-sort]')) {
    th.addEventListener('click', () => {
      const k = th.dataset.sort ?? 'id';
      // Clicking the column already sorted turns it round; clicking a
      // new one starts ascending, which is what every table does.
      if (view.sort === k) view.dir = view.dir === 'asc' ? 'desc' : 'asc';
      else { view.sort = k; view.dir = 'asc'; }
      repaintTable();
    });
  }
}

/** Sorting/columns change the table, not the open editor or its photos. */
function repaintTable(): void {
  const wrap = app.querySelector<HTMLElement>('.tablewrap');
  const left = wrap?.scrollLeft ?? 0;
  const top = wrap?.scrollTop ?? 0;
  const pageX = window.scrollX;
  const pageY = window.scrollY;
  const header = app.querySelector('thead tr');
  if (header) header.innerHTML = columnHeadersHtml();
  repaintList();
  bindSortHeaders();
  if (wrap) { wrap.scrollLeft = left; wrap.scrollTop = top; }
  window.scrollTo({ left: pageX, top: pageY, behavior: 'instant' });
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
  dlg.querySelector('#colsDone')?.addEventListener('click', () => { apply(); dlg?.close(); repaintTable(); });
  dlg.querySelector('#colsReset')?.addEventListener('click', () => {
    view.cols = [...DEFAULT_COLS];
    dlg?.close();
    repaintTable();
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
  if (counts) counts.innerHTML = tallyHtml(shown.length);
  bindRows();
}

function bindRows(): void {
  for (const tr of app.querySelectorAll<HTMLElement>('tr[data-id]')) {
    tr.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('a')) enterDetail(Number(tr.dataset.id));
    });
    tr.addEventListener('keydown', (e) => {
      if ((e.target as Element).closest('a')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); enterDetail(Number(tr.dataset.id));
      }
    });
  }
}

const cell = (v: unknown, c: Column): string => (!has(v)
  ? '<td class="empty">—</td>'
  : `<td class="${c.num ? 'num' : ''}${c.mono ? ' mono' : ''}${c.reading ? ' reading' : ''}"${
    c.reading ? ' title="read off a photograph — not confirmed by a person"' : ''
  }>${esc(v)}</td>`);

function rowHtml(r: Row): string {
  return `<tr data-id="${r.id}" tabindex="0" class="${openId === r.id ? 'open' : ''}">${
    view.cols.map((k, index) => {
      const c = COLUMN.get(k);
      if (!c) return '';
      const html = c.html ? c.html(r) : cell(c.get(r), c);
      return index === 0 && needsPhotos(r) ? html.replace('</td>', `<span class="photo-needed-badge" title="${esc(r.photo_needed || 'No photos yet')}">Needs photos<small>${esc(r.photo_needed || 'No photos yet')}</small></span></td>`) : html;
    }).join('')}</tr>`;
}

function enterDetail(id: number): void {
  if (snapshot) { flash('This is a saved list. Live record details are temporarily unavailable.', 'err'); return; }
  const wrap = app.querySelector<HTMLElement>('.tablewrap');
  collectionPosition = { x: scrollX, y: scrollY, left: wrap?.scrollLeft ?? 0,
    top: wrap?.scrollTop ?? 0, row: id };
  history.replaceState({ ...history.state, collectionPosition }, '');
  const url = new URL(location.href);
  url.searchParams.set('item', String(id));
  history.pushState({ collectionPosition, fromCollection: true }, '', url);
  void openDetail(id);
}

function showCollection(): void {
  document.querySelector<HTMLDialogElement>('.photo-viewer[open]')?.close();
  detailRequest++;
  openId = null;
  document.getElementById('detail')!.hidden = true;
  document.getElementById('collectionView')!.hidden = false;
  const wrap = app.querySelector<HTMLElement>('.tablewrap');
  if (wrap) { wrap.scrollLeft = collectionPosition.left; wrap.scrollTop = collectionPosition.top; }
  const row = app.querySelector<HTMLElement>(`tr[data-id="${collectionPosition.row}"]`);
  row?.focus({ preventScroll: true });
  window.scrollTo({ left: collectionPosition.x, top: collectionPosition.y, behavior: 'instant' });
}

function leaveDetail(): void {
  if (history.state?.fromCollection) history.back();
  else {
    const url = new URL(location.href);
    url.searchParams.delete('item');
    history.replaceState({ collectionPosition }, '', url);
    showCollection();
  }
}

async function openDetail(id: number, moveToTop = true): Promise<void> {
  if (snapshot) { showCollection(); return; }
  const request = ++detailRequest;
  openId = id;
  const panel = document.getElementById('detail')!;
  document.getElementById('collectionView')!.hidden = true;
  panel.hidden = false;
  panel.innerHTML = `<div class="dhead"><button class="btn btn-ghost" id="closeDetail" type="button">← Back to collection</button>
    <h1 tabindex="-1">Item ${id}</h1></div><p class="empty-note" role="status">Loading record…</p>`;
  panel.querySelector('#closeDetail')!.addEventListener('click', leaveDetail);
  if (moveToTop) {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    panel.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }
  try {
    const res = await fetch(`${API}/items/${id}`, { headers: whoHeader() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json() as Detail;
    if (request !== detailRequest || openId !== id) return;
    panel.innerHTML = detailHtml(detail);
    panel.querySelector('#closeDetail')!.addEventListener('click', leaveDetail);
    wireEditing(panel, id);
    wireMusicbrainz(panel, id, () => ({ ...whoHeader(), 'x-edit-token': editToken.get() }));
    panel.querySelector<HTMLButtonElement>('[data-start-review]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        if (await write(`/items/${id}/start-review`, {})) location.href = `/review.html?item=${id}`;
      } catch { flash('Could not open review. Refresh before trying again.', 'err'); }
      finally { button.disabled = false; }
    });
    panel.querySelector<HTMLButtonElement>('[data-retry-match]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        if (await write(`/items/${id}/retry-match`, {})) await afterWrite('Search requested. Refresh shortly to see the result.');
      } catch { flash('Could not start the search. Check the connection and refresh before retrying.', 'err'); }
      finally { button.disabled = false; }
    });
    panel.querySelector('[data-edit-details]')?.addEventListener('click', () => {
      const more = panel.querySelector<HTMLDetailsElement>('.record-more');
      if (more) { more.open = true; more.scrollIntoView({ behavior: 'smooth' }); }
    });
    panel.querySelector('[data-refresh-match]')?.addEventListener('click', () => { void openDetail(id, false); });
    const summary = recordSummary(detail);
    const title = summary.filter(f => ['Artist', 'Title'].includes(f.label)).map(f => f.value).filter(Boolean).join(' — ') || `Item ${id}`;
    wirePhotoActions(panel, id, title, () => afterWrite('Photo details updated.'));
    panel.querySelector('[data-next-photo]')?.addEventListener('click', () => {
      const needing = visible().filter(r => needsPhotos(r) && r.id !== id);
      const next = needing.find(r => r.id > id) ?? needing[0];
      if (!next) return;
      const url = new URL(location.href); url.searchParams.set('item', String(next.id));
      history.replaceState(history.state, '', url); void openDetail(next.id);
    });
    if (moveToTop) panel.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  } catch (err) {
    if (request !== detailRequest || openId !== id) return;
    panel.querySelector('[role="status"]')!.textContent = `Could not load item ${id}: ${err instanceof Error ? err.message : String(err)}. Go back to the collection to try again.`;
  }
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
      // A field with a closed set of answers edits through a select
      // rather than a box: typing "Dance" into the list field is a
      // spelling test the Worker would fail you on (FOUR-LISTS).
      const options = btn.dataset.options?.split(',').filter(Boolean);
      const editor = document.createElement('form');
      editor.className = 'inline';
      editor.innerHTML = `${options
        ? `<select>${['', ...options].map((o) => `<option value="${esc(o)}"${o === before ? ' selected' : ''}>${
          o ? esc(labelOf(o)) : '— none'}</option>`).join('')}</select>`
        : `<input value="${esc(before)}" autocomplete="off" spellcheck="false">`}
        <button type="submit" class="tiny ok-save" title="Save">save</button>
        <button type="button" class="tiny cancel" title="Leave it alone">cancel</button>`;
      const kept = cell.innerHTML;
      cell.innerHTML = '';
      // `appendChild`, not `append`: with @cloudflare/workers-types in
      // scope the bare `append` resolves to the Worker FormData one.
      cell.appendChild(editor);
      // A cast, not the generic: see the note in chrome.ts on
      // HTMLSelectElement and the merged Element type.
      const box = editor.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
      box.focus();
      if (box instanceof HTMLInputElement) box.select();

      const restore = (): void => { cell.innerHTML = kept; wireEditing(panel, id); };
      editor.querySelector('button.cancel')?.addEventListener('click', restore);
      box.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') restore(); });
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
        if (!ok) { restore(); return; }
        await afterWrite(value === before.trim() ? `${field} confirmed.`
          : field === 'list' ? (value ? `Moved to ${labelOf(value)}.` : 'Taken off every list.')
            : `${field} corrected.`);
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

  /**
   * The list, with a select behind the pencil: moving a disc to
   * another list is the one edit here with a closed set of answers
   * (FOUR-LISTS). Unsorted is shown as what it is rather than as a
   * dash, because it is a state somebody may need to go and fix.
   */
  const listLine = (): string => {
    const raw = typeof item.list === 'string' ? item.list : '';
    const shown = raw ? esc(labelOf(raw)) : '<span class="empty">unsorted</span>';
    return `<dt>List</dt><dd data-field-cell="item.list">${shown}<span class="ftools">
          <button type="button" class="tiny edit" data-entity="item" data-field="list"
            data-value="${esc(raw)}" data-options="${esc(knownLists().map((l) => l.key).join(','))}" title="Move this disc to another list">✎</button>
          <button type="button" class="tiny ok" data-entity="item" data-field="list"
            title="Confirm this disc is on the right list">✓</button>
        </span><br>${mark(provOf('item', Number(item.id), 'list'))}</dd>`;
  };

  const photos = `<section class="record-photos" aria-label="Photographs">
    <h2>Photographs</h2>
    ${followupHtml(d.photoRequests ?? [], d.photos.length, Math.max(0, ...d.photos.map(p => p.id)))}
    ${d.photos.length ? `<div class="shots">${d.photos.map((p, i) => `
      <figure class="shotfig">
        ${p.r2_key ? `<a data-photo-viewer href="${API}/photos/${encodeURI(p.r2_key)}"
          aria-label="Open photograph ${i + 1} of item ${esc(item.id)} full-screen">
          <img src="${API}/photos/${encodeURI(p.r2_key)}" alt="Photograph ${i + 1} of item ${esc(item.id)}">
        </a>` : '<p class="empty-note">Set your name on this device to view this photograph.</p>'}
        <figcaption><span class="n">${i + 1}</span>${p.kind === 'other' ? '' : ` · ${esc(p.kind)}`}</figcaption>
      </figure>`).join('')}</div>` : '<p class="empty-note">No photographs recorded.</p>'}
    </section>`;

  return `
    <div class="dhead">
      <button type="button" id="closeDetail" class="btn btn-ghost">← Back to collection</button>
      <h1 tabindex="-1">Item ${esc(item.id)}</h1>
      ${visible().some(r => needsPhotos(r) && r.id !== Number(item.id)) ? '<button class="btn btn-ghost" data-next-photo>Next needing photos →</button>' : ''}
    </div>
    <div class="record-overview">
      <dl class="record-facts">${recordSummary(d).map((f) => `
        <div><dt>${esc(f.label)}</dt><dd>${f.value === null ? '<span class="empty">Not recorded</span>' : esc(f.value)}
        ${f.note ? `<small>${esc(f.note)}</small>` : ''}${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Similar edition ↗</a>` : ''}</dd></div>`).join('')}</dl>
      ${photos}
    </div>
    ${preparationHtml(d)}
    ${musicbrainzPanelHtml(d.sourcePreparation)}
    <details class="record-more">
      <summary>More details and editing</summary>
      <div class="dtools">
        <span class="prov">${storedCapturer() ? `editing as ${esc(storedCapturer())}`
    : '<span class="warnish">no name on this device — set one on the review queue</span>'}</span>
        <button type="button" id="lockBtn" class="btn btn-quiet">${editToken.get() ? 'Editing unlocked' : 'Unlock editing'}</button>
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
          ${listLine()}
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
        <h3>Other photo readings</h3>
        <p class="empty-note">Read from photographs. Check these details before using them to identify the record.</p>
        <dl class="facts">${d.readings.map((r) => `<dt>${esc(r.field)}</dt><dd>${esc(r.value)}${
    (CAPTURE_FIELDS as readonly string[]).includes(r.field)
      ? `<span class="ftools"><button type="button" class="tiny promote" data-field="${esc(r.field)}"
           title="Yes, that is what the label says">promote</button></span>`
      : ''}<br>${mark(provOf('raw_value', r.id, r.field))}</dd>`).join('')}</dl>` : ''}
      </section>

      <section>
        ${d.photos.length ? `<h3>Photograph details</h3><dl class="facts">${d.photos.map((p, i) =>
    `<dt>Photograph ${i + 1}</dt><dd>${esc(p.kind)} · ${esc(p.added_at)}</dd>`).join('')}</dl>` : ''}
        <h3>Match history</h3>
        ${d.runs.length ? d.runs.map(runHtml).join('')
    : '<p class="empty-note">This record has not been searched yet.</p>'}
      </section>
    </div>
    </details>`;
}

function preparationHtml(d: Detail): string {
  if (!d.matching) return '';
  const { input, usable } = d.matching;
  const latest = d.runs[0];
  const previousDecision = d.runs.find(run => run.decision)?.decision;
  const audit = parse<{ incomplete?: boolean; queriesRun?: number; queryErrors?: number; reason?: string; retry?: string; manualReview?: boolean }>(latest?.queries_json ?? '', {});
  const confirmed = d.provenance.some(p => p.entity === 'item' && p.field === 'release_id' && p.confirmed_by && p.confirmed_at);
  const elapsed = latest ? Date.now() - (stamp(latest.ran_at)?.getTime() ?? Date.now()) : Infinity;
  const busy = latest?.state === 'pending' && (audit.retry === 'queued' || elapsed < 15 * 60_000);
  const recent = elapsed < 5 * 60_000;
  const disabled = confirmed || !usable || busy || recent;
  const currentStatus = itemStatus({ confirmed, choice: latest?.decision?.choice,
    state: latest?.state, searchable: usable, ranAt: latest?.ran_at, ...audit });
  const facts = [
    ['Catalogue number', input.catnoRaw], ['Label', input.labelRaw],
    ['Title', input.titleRaw], ['Artist / performer', input.nameRaw], ['Other numbers', input.otherNumbers],
  ];
  const search = [input.labelRaw, input.catnoRaw].filter(Boolean).join(' ') || [input.nameRaw, input.titleRaw].filter(Boolean).join(' ');
  return `<section class="match-preparation" aria-label="Prepare to resolve">
    <h2>Prepare to resolve</h2>
    <p><strong>${STATUS_LABELS[currentStatus]}</strong></p>
    ${!usable && !confirmed ? '<p>Add clear label details to identify this record.</p>' : ''}
    <dl class="match-inputs">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value ? esc(value) : 'Not recorded'}</dd></div>`).join('')}</dl>
    <p class="prov">Search uses saved label details, with photo readings filling empty fields. Check these against the photographs; a photo reading is still unconfirmed.</p>
    ${!input.labelRaw || !input.titleRaw || !input.nameRaw ? '<p>Add the label, title and artist or performer where legible. These help distinguish records sharing a catalogue number.</p>' : ''}
    ${latest ? `<details><summary>Search details</summary><p><strong>Last attempt: ${esc(SEARCH_LABELS[latest.state] ?? 'Search result')}</strong> · ${esc(latest.ran_at)} UTC<br>${esc(audit.reason ?? 'No search explanation recorded.')}
      ${audit.queriesRun !== undefined ? `<br>${audit.queriesRun} searches attempted · ${audit.queryErrors ?? 0} failed` : ''}</p></details>` : '<p>No search has been attempted yet.</p>'}
    ${previousDecision ? `<p>Previous decision: ${esc(DECISION_LABELS[previousDecision.choice] ?? 'Recorded')}${previousDecision.note ? ` — ${esc(previousDecision.note)}` : ''}</p>` : ''}
    <div class="match-actions">
      <button class="btn btn-ghost" type="button" data-edit-details>Check / edit label details</button>
      <button class="btn btn-primary" type="button" data-retry-match ${disabled ? 'disabled' : ''}>${busy ? 'Search pending' : 'Search again'}</button>
      ${latest && latest.state !== 'pending' ? `<a class="btn btn-ghost" href="/review.html?item=${Number(d.item.id)}">Review / link a release</a>` : ''}
      ${!latest && !confirmed ? '<button class="btn btn-ghost" type="button" data-start-review>Review / link a release</button>' : ''}
      ${search ? `<a class="btn btn-ghost" href="https://www.discogs.com/search/?type=release&amp;q=${encodeURIComponent(search)}" target="_blank" rel="noopener noreferrer">Search Discogs</a>` : ''}
      <button class="btn btn-quiet" type="button" data-refresh-match>Refresh status</button>
    </div>
    <p class="prov">${confirmed ? 'Confirmed releases are protected from automatic retries.' : busy ? 'Your search is waiting or in progress. Refresh to see the result.' : recent ? 'Wait five minutes after an attempt before requesting another.' : 'A fresh search requires editing to be unlocked. Old attempts and photographs are retained.'}</p>
  </section>`;
}

function runHtml(run: Run): string {
  const audit = parse<{ reason?: string; attempts?: { type: string; params: Record<string, string>; status: string; results?: number }[] }>(run.queries_json, {});
  const reason = audit.reason ?? '';
  return `<div class="run">
    <div class="rhead"><span class="state s-${esc(run.state)}">${esc(SEARCH_LABELS[run.state] ?? 'Search result')}</span>
      <span class="prov">${esc(run.ran_at)}</span></div>
    ${reason ? `<p class="why">${esc(reason)}</p>` : ''}
    ${audit.attempts?.length ? `<details><summary>Searches attempted (${audit.attempts.length})</summary><ol>${audit.attempts.map(a => `<li>${esc(Object.values(a.params).join(' · '))} — ${a.status === 'error' ? 'request failed' : `${a.results ?? 0} results`}</li>`).join('')}</ol></details>` : ''}
    ${run.candidates.map((cand) => {
    const sig = parse<{ families?: string[] }>(cand.signals_json, {});
    return `<div class="cand-row"><span class="rank">${cand.rank}</span>
        <span class="did">Discogs ${cand.discogs_id}</span>
        <span class="fams">${(sig.families ?? []).map((f) => `<span class="chip accent">${esc(f)}</span>`).join('')}</span>
        <span class="score">${cand.score}</span></div>`;
  }).join('')}
    ${run.decision
    ? `<p class="verdict"><strong>${esc(DECISION_LABELS[run.decision.choice] ?? 'Recorded')}</strong>${
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
openId = recordInUrl();
collectionPosition = history.state?.collectionPosition ?? collectionPosition;
history.scrollRestoration = 'manual';
bootChrome(SCREEN_KEYS);

// Native dialogs and inline editors own Escape before record navigation.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || openId === null) return;
  if ((e.target as Element | null)?.closest('input, select, textarea, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  leaveDetail();
});
addEventListener('popstate', () => {
  collectionPosition = history.state?.collectionPosition ?? collectionPosition;
  const before = JSON.stringify(view);
  readUrl();
  const id = recordInUrl();
  if (JSON.stringify(view) !== before) {
    openId = id;
    render();
    if (id !== null) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } else if (id !== null) void openDetail(id);
  if (id === null) showCollection();
});
startAdditions(() => { void refreshAdditionStatus().catch(() => {}); });
load().then(() => refreshAdditionStatus()).catch((err: unknown) => {
  app.innerHTML = `<p class="note-bad">Could not load the collection: ${
    esc(err instanceof Error ? err.message : String(err))}</p><p>Saved photo additions remain on this device. Reconnect to load the collection.</p><p class="photo-needs" data-collection-upload-status role="status" hidden></p><p><a class="btn btn-ghost" href="${esc(location.href)}">Try collection again</a> <a href="/recovery.html">Save queued work</a></p>`;
  void refreshAdditionStatus();
});
// The selector in the header changed: same rows, different list.
addEventListener('vs:list', () => { if (rows.length) render(); });
