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

import { storedCapturer } from './who.ts';

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

function flash(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const el = document.getElementById('bflash');
  if (!el) return;
  el.innerHTML = `<p class="flash${kind === 'err' ? ' err' : ''}">${esc(message)}</p>`;
  setTimeout(() => { el.innerHTML = ''; }, kind === 'ok' ? 2400 : 5000);
}

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

    <div class="detail" id="detail" hidden></div>
    <div id="bflash"></div>`;

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
        <button type="button" id="lockBtn" class="ghost">${
  editToken.get() ? 'Editing unlocked' : 'Unlock editing'}</button>
        <button type="button" id="closeDetail" class="ghost">Close</button>
      </div>
    </div>
    <form class="unlock" id="unlock" hidden>
      <label><span>Passphrase</span><input id="tokenBox" type="password"
        autocomplete="current-password"></label>
      <button type="submit" class="ghost">Keep on this device</button>
    </form>

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
        <dl>${d.readings.map((r) => `<dt>${esc(r.field)}</dt><dd>${esc(r.value)}${
    (CAPTURE_FIELDS as readonly string[]).includes(r.field)
      ? `<span class="ftools"><button type="button" class="tiny promote" data-field="${esc(r.field)}"
           title="Yes, that is what the label says">promote</button></span>`
      : ''}<br>${mark(provOf('raw_value', r.id, r.field))}</dd>`).join('')}</dl>` : ''}
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
