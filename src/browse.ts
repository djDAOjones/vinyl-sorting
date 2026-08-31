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
 * Read-only. Correcting a value is DATASET-EDIT, which this exists to
 * make possible.
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

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const parse = <T,>(json: string | null, fallback: T): T => {
  try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; }
};

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
const STATES = ['auto-accepted', 'needs-review', 'rejected', 'error', 'unmatched'] as const;
const stateOf = (r: Row): string => r.match_state ?? 'unmatched';

const filters = { state: '', photos: '', text: '', sort: 'id' };

/**
 * Filtering is client-side, and that is a decision rather than a
 * shortcut: the whole collection arrives in one fetch, and a filter
 * that costs a round trip is a filter nobody uses. It stops being true
 * past the deferred 2,000–6,000 record batch, and `/api/items` is
 * already keyset-paged for that day.
 */
function visible(): Row[] {
  const needle = filters.text.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (filters.state && stateOf(r) !== filters.state) return false;
    if (filters.photos === 'with' && !r.photo_count) return false;
    if (filters.photos === 'without' && r.photo_count) return false;
    if (!needle) return true;
    return [r.catno_raw, r.label_raw, r.name_raw, r.title_raw, r.crate, r.captured_by, String(r.id)]
      .some((v) => (v ?? '').toLowerCase().includes(needle));
  });
  if (filters.sort === 'verified') {
    // Never verified sorts last rather than first: a null is not an old
    // date, and putting 287 of them at the top would bury the rows the
    // sort was asked for.
    out.sort((a, b) => (b.last_verified_at ?? '').localeCompare(a.last_verified_at ?? '')
      || a.id - b.id);
  }
  return out;
}

async function load(): Promise<void> {
  rows = [];
  let after = 0;
  // Paged rather than assumed. 465 rows arrive in one fetch at 500, and
  // the loop is what keeps that an optimisation rather than a limit.
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${API}/items?limit=500&after=${after}`);
    if (!res.ok) throw new Error(`items: HTTP ${res.status}`);
    const body = await res.json() as { items: Row[]; nextAfter: number | null };
    rows.push(...body.items);
    if (body.nextAfter === null) break;
    after = body.nextAfter;
  }
  render();
}

function render(): void {
  const shown = visible();
  const withPhotos = rows.filter((r) => r.photo_count).length;
  app.innerHTML = `
    <div class="bhead">
      <h1>The collection</h1>
      <div class="counts"><b>${shown.length}</b> of ${rows.length} shown ·
        ${withPhotos} photographed ·
        <a class="nav" href="/review.html">Review queue →</a></div>
    </div>

    <div class="filters">
      <label><span>Search</span>
        <input id="fText" type="search" placeholder="catalogue number, label, name, crate"
          value="${esc(filters.text)}"></label>
      <label><span>Match state</span>
        <select id="fState">
          <option value="">any</option>
          ${STATES.map((s) => `<option value="${s}"${filters.state === s ? ' selected' : ''}>${s}
            (${rows.filter((r) => stateOf(r) === s).length})</option>`).join('')}
        </select></label>
      <label><span>Photographs</span>
        <select id="fPhotos">
          <option value="">any</option>
          <option value="with"${filters.photos === 'with' ? ' selected' : ''}>has one</option>
          <option value="without"${filters.photos === 'without' ? ' selected' : ''}>none</option>
        </select></label>
      <label><span>Sort</span>
        <select id="fSort">
          <option value="id"${filters.sort === 'id' ? ' selected' : ''}>by id</option>
          <option value="verified"${filters.sort === 'verified' ? ' selected' : ''}>last verified</option>
        </select></label>
    </div>

    <table class="rows">
      <thead><tr>
        <th>id</th><th>catalogue</th><th>label</th><th>name</th><th>title</th>
        <th>crate</th><th>photos</th><th>match</th>
      </tr></thead>
      <tbody>${shown.map(rowHtml).join('')}</tbody>
    </table>
    ${shown.length ? '' : '<p class="empty-note">Nothing matches those filters.</p>'}

    <div class="detail" id="detail" hidden></div>`;

  const on = (id: string, ev: string, fn: (el: HTMLInputElement) => void): void => {
    const el = document.getElementById(id) as HTMLInputElement;
    el.addEventListener(ev, () => fn(el));
  };
  on('fText', 'input', (el) => { filters.text = el.value; repaintList(); });
  on('fState', 'change', (el) => { filters.state = el.value; render(); });
  on('fPhotos', 'change', (el) => { filters.photos = el.value; render(); });
  on('fSort', 'change', (el) => { filters.sort = el.value; render(); });

  for (const tr of app.querySelectorAll<HTMLElement>('tr[data-id]')) {
    tr.addEventListener('click', () => { void openDetail(Number(tr.dataset.id)); });
  }
  if (openId !== null) void openDetail(openId);
}

/**
 * Repaint the rows without rebuilding the filter bar.
 *
 * Typing in the search box must not take the focus out of it, which is
 * what a full `render()` on every keystroke did.
 */
function repaintList(): void {
  const shown = visible();
  const body = app.querySelector('tbody');
  if (body) body.innerHTML = shown.map(rowHtml).join('');
  const counts = app.querySelector('.counts');
  if (counts) {
    counts.innerHTML = `<b>${shown.length}</b> of ${rows.length} shown · `
      + `${rows.filter((r) => r.photo_count).length} photographed`;
  }
  for (const tr of app.querySelectorAll<HTMLElement>('tr[data-id]')) {
    tr.addEventListener('click', () => { void openDetail(Number(tr.dataset.id)); });
  }
}

const cell = (v: unknown): string => (v === null || v === undefined || v === ''
  ? '<td class="empty">—</td>' : `<td>${esc(v)}</td>`);

function rowHtml(r: Row): string {
  const state = stateOf(r);
  return `<tr data-id="${r.id}" tabindex="0" class="${openId === r.id ? 'open' : ''}">
    <td class="num">${r.id}</td>
    ${cell(r.catno_raw)}${cell(r.label_raw)}${cell(r.name_raw)}${cell(r.title_raw)}
    ${cell([r.crate, r.position].filter(Boolean).join(' · '))}
    <td class="num">${r.photo_count || '<span class="empty">—</span>'}</td>
    <td><span class="state s-${state}">${state}</span>${
    r.release_confirmed ? '<span class="tick" title="release confirmed by a person">✓</span>' : ''}</td>
  </tr>`;
}

async function openDetail(id: number): Promise<void> {
  openId = id;
  const panel = document.getElementById('detail')!;
  panel.hidden = false;
  panel.innerHTML = '<p class="empty-note">Loading…</p>';
  const res = await fetch(`${API}/items/${id}`);
  if (!res.ok) { panel.innerHTML = `<p class="empty-note">Could not load item ${id}.</p>`; return; }
  panel.innerHTML = detailHtml(await res.json() as Detail);
  panel.querySelector('#closeDetail')?.addEventListener('click', () => {
    openId = null;
    panel.hidden = true;
    for (const tr of app.querySelectorAll('tr.open')) tr.classList.remove('open');
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  const line = (label: string, value: unknown, entity: string, entityId: number, field: string):
  string => `<dt>${esc(label)}</dt><dd>${
    value === null || value === undefined || value === '' ? '<span class="empty">—</span>' : esc(value)
  }<br>${mark(provOf(entity, entityId, field))}</dd>`;

  return `
    <div class="dhead">
      <h2>Item ${esc(item.id)}</h2>
      <button type="button" id="closeDetail" class="ghost">Close</button>
    </div>

    <div class="dsplit">
      <section>
        <h3>Read off the disc</h3>
        <dl>
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
        <dl>
          ${line('Crate', item.crate, 'item', Number(item.id), 'crate')}
          ${line('Position', item.position, 'item', Number(item.id), 'position')}
          ${line('Media', item.media_grade, 'item', Number(item.id), 'media_grade')}
          ${line('Sleeve', item.sleeve_grade, 'item', Number(item.id), 'sleeve_grade')}
          ${line('Release', item.release_id, 'item', Number(item.id), 'release_id')}
          <dt>Captured by</dt><dd>${item.captured_by ? esc(item.captured_by) : '<span class="empty">—</span>'}
            ${item.captured_at ? `<br><span class="prov">${esc(item.captured_at)}</span>` : ''}</dd>
          <dt>Imported from</dt><dd>${item.import_ref ? esc(item.import_ref) : '<span class="empty">—</span>'}</dd>
        </dl>

        ${d.readings.length ? `
        <h3>Readings not yet in the model</h3>
        <p class="empty-note">Held in <code>raw_value</code> — displayed, and unreachable from
          any cluster, coverage check or sell list until a person confirms one.</p>
        <dl>${d.readings.map((r) => `<dt>${esc(r.field)}</dt><dd>${esc(r.value)}<br>${
    mark(provOf('raw_value', r.id, r.field))}</dd>`).join('')}</dl>` : ''}
      </section>

      <section>
        <h3>Photographs ${d.photos.length ? `<span class="n">${d.photos.length}</span>` : ''}</h3>
        ${d.photos.length
    ? `<p class="empty-note">Held in R2 and not shown here: serving one needs a Worker route
         that a sign-in-free v1 deliberately does not have. <code>tools/photos-pull.mjs</code>
         fetches them to a desk from these keys.</p>
       <ul class="keys">${d.photos.map((p, i) => `<li><span class="n">${i + 1}</span>
         <code>${esc(p.r2_key)}</code>
         <span class="prov">${esc(p.added_at)}${p.kind === 'other' ? '' : ` · ${esc(p.kind)}`}</span>
       </li>`).join('')}</ul>`
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
        <span class="fams">${(sig.families ?? []).map((f) => `<span class="fam">${esc(f)}</span>`).join('')}</span>
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
load().catch((err: unknown) => {
  app.innerHTML = `<p class="why-refused">Could not load the collection: ${
    esc(err instanceof Error ? err.message : String(err))}</p>`;
});
