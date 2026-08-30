/**
 * Photo-first capture.
 *
 * Build photo-first before type-at-shelf: walk a crate photographing
 * labels, type nothing, transcribe later at a desk. It is faster per
 * disc and it is delegable.
 *
 * TWO MODES. One disc at a time, with the label and catalogue number
 * typed; or a whole crate in one pass, where the shots ARE the capture
 * and nothing is typed at all. The second is what "walk a crate
 * photographing labels" actually means — twenty form interactions is
 * the thing that stops the cataloguing.
 *
 * The one rule the interface exists to enforce: LABEL AND CATALOGUE
 * NUMBER ARE SEPARATE INPUTS. Merging them is what left label captured
 * on 0% of the backlog and caused the 9% match error rate M0 measured.
 */

import { putEntry, allEntries } from './queue.ts';
import {
  PHOTO_KINDS, PHOTO_LONG_EDGE, PRIMARY_KIND, bulkFields, scaleTo, summarise, unusedKinds,
  type QueuedCapture, type QueuedPhoto,
} from './queue-logic.ts';
import { startSync, drain } from './sync.ts';

const app = document.getElementById('app')!;

/**
 * Sticky between discs. Only `who`, deliberately.
 *
 * Crate used to stick too, which was right while it was a required
 * field you could see. Now that it is optional and folded into "More",
 * a remembered value would attach itself to every future capture
 * unseen — so one placeholder typed once ("1", on item 448) would go on
 * asserting a location nobody has confirmed. An invisible field that
 * fills itself in is the same fault as a required field answered with
 * filler, and this project's rule is the same either way: refuse rather
 * than guess. Type a crate when you mean one.
 */
const sticky = {
  get who() { return localStorage.getItem('dg.who') ?? ''; },
  set who(v: string) { localStorage.setItem('dg.who', v); },
};

/**
 * The photos taken for the disc in hand, at most one per kind.
 *
 * One frame often cannot hold what a record needs to say — the
 * catalogue number is on the centre label and the title is on the
 * sleeve. The schema and the Worker always allowed several; only this
 * form insisted on one.
 */
type Shot = { kind: string; blob: Blob; url: string };
let photos: Shot[] = [];
let pendingKind = PRIMARY_KIND;
let startedAt = Date.now();

const GRADES = ['', 'M', 'NM', 'VG+', 'VG', 'G', 'P'];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function render(): void {
  app.innerHTML = `
    <div class="top">
      <h1>Deep Groove</h1>
      <div class="status" id="status">queue…</div>
    </div>

    <button class="shot" id="shot" type="button" aria-label="Photograph the label">
      <span class="hint">📷 Photograph the label</span>
    </button>
    <input id="file" type="file" accept="image/*" capture="environment" hidden>
    <div class="adds" id="adds"></div>
    <div class="strip" id="strip"></div>
    <p class="note">Add as many as the record needs — the catalogue number and the
      title are often not in the same frame.</p>

    <button class="bulk" id="bulkBtn" type="button">📚 Photograph a whole crate</button>
    <input id="bulkFile" type="file" accept="image/*" multiple hidden>
    <p class="note">One row per photo, nothing typed. Nothing you have typed above
      carries over — a catalogue number belongs to one disc, so copying one across
      twenty rows would invent nineteen wrong ones.</p>

    <fieldset>
      <legend>Off the label</legend>
      <label><span>Catalogue number</span>
        <input id="catnoRaw" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="SXL 6113"></label>
      <label><span>Label</span>
        <input id="labelRaw" autocomplete="off" spellcheck="false" placeholder="Decca"></label>
      <p class="note">Two separate boxes on purpose — a label mashed into the catalogue number is the
        thing that made 9% of the old matches point at the wrong record.</p>
      <label><span>One name — composer, conductor or soloist</span>
        <input id="nameRaw" autocomplete="off" placeholder="Solti"></label>
    </fieldset>

    <fieldset>
      <legend>Condition</legend>
      <div class="pair">
        <label><span>Media</span><select id="mediaGrade">${GRADES.map((g) => `<option value="${g}">${g || '—'}</option>`).join('')}</select></label>
        <label><span>Sleeve</span><select id="sleeveGrade">${GRADES.map((g) => `<option value="${g}">${g || '—'}</option>`).join('')}</select></label>
      </div>
    </fieldset>

    <details>
      <summary>More — title, matrix/runout, year, where it lives</summary>
      <label><span>Title</span><input id="titleRaw" autocomplete="off"></label>
      <label><span>Matrix / runout</span><input id="matrixRunout" autocomplete="off" spellcheck="false"
        placeholder="ZAL-6113-1W"></label>
      <p class="note">The only truly unique pressing identifier — it tells an original from a repress.</p>
      <label><span>Year</span><input id="yearRaw" inputmode="numeric" autocomplete="off"></label>
      <label><span>Captured by</span><input id="capturedBy" autocomplete="off"></label>
      <div class="pair">
        <label><span>Crate</span><input id="crate" inputmode="text" autocomplete="off" placeholder="B4"></label>
        <label><span>Position</span><input id="position" inputmode="numeric" autocomplete="off" placeholder="12"></label>
      </div>
      <p class="note">Optional, and down here on purpose. A location is only worth
        recording if the storage is stable — otherwise the record asserts something
        untrue, which costs more than saying nothing.</p>
    </details>

    <div id="flash"></div>

    <div class="bar"><div class="inner">
      <button class="primary" id="save" type="button">Queue it</button>
      <button class="ghost" id="clear" type="button">Clear</button>
    </div></div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  $<HTMLInputElement>('capturedBy').value = sticky.who;
  // Clear anything a previous build remembered, so a placeholder typed
  // once cannot keep attaching itself to new captures.
  localStorage.removeItem('dg.crate');

  const file = $<HTMLInputElement>('file');
  // The big button is always the label shot; the add-buttons set
  // `pendingKind` before opening the same picker.
  $('shot').addEventListener('click', () => { pendingKind = PRIMARY_KIND; file.click(); });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';                 // so the same frame can be retaken
    if (!f) return;
    // A retake replaces that kind rather than adding a second of it,
    // which keeps one photo per kind and the R2 keys unique.
    const existing = photos.find((p) => p.kind === pendingKind);
    if (existing) URL.revokeObjectURL(existing.url);
    photos = photos.filter((p) => p.kind !== pendingKind);
    photos.push({ kind: pendingKind, blob: f, url: URL.createObjectURL(f) });
    renderPhotos();
  });

  const bulkFile = $<HTMLInputElement>('bulkFile');
  $('bulkBtn').addEventListener('click', () => bulkFile.click());
  bulkFile.addEventListener('change', () => {
    const files = [...(bulkFile.files ?? [])];
    bulkFile.value = '';       // so the same selection can be made twice
    void saveBulk(files);
  });

  renderPhotos();
  $('save').addEventListener('click', () => { void save(); });
  $('clear').addEventListener('click', () => { resetForm(); });
  void refreshStatus();
}

/**
 * Paint the shot button, the add-buttons and the thumbnail strip from
 * `photos`. One function so the three cannot disagree about what has
 * been taken.
 */
function renderPhotos(): void {
  const shot = document.getElementById('shot');
  const adds = document.getElementById('adds');
  const strip = document.getElementById('strip');
  if (!shot || !adds || !strip) return;

  const primary = photos.find((p) => p.kind === PRIMARY_KIND);
  shot.classList.toggle('has-photo', Boolean(primary));
  shot.innerHTML = primary
    ? `<img src="${primary.url}" alt="The label just photographed"><span class="retake">Retake the label</span>`
    : '<span class="hint">📷 Photograph the label</span>';

  // Offer only kinds not yet taken, so a photo can never be filed as
  // something the record already has.
  adds.innerHTML = photos.length
    ? unusedKinds(photos.map((p) => p.kind))
      .map((k) => `<button type="button" class="add" data-kind="${k.kind}">＋ ${k.label}</button>`).join('')
    : '';
  for (const btn of adds.querySelectorAll<HTMLButtonElement>('button.add')) {
    btn.addEventListener('click', () => {
      pendingKind = btn.dataset.kind ?? PRIMARY_KIND;
      (document.getElementById('file') as HTMLInputElement).click();
    });
  }

  // The label shot is shown by the big button above, so the strip
  // carries the extras — the ones you would otherwise lose track of.
  const extras = photos.filter((p) => p.kind !== PRIMARY_KIND);
  strip.innerHTML = extras.map((p) => {
    const name = PHOTO_KINDS.find((k) => k.kind === p.kind)?.label ?? p.kind;
    return `<figure class="thumb"><img src="${p.url}" alt="${name}">
      <figcaption>${name}</figcaption>
      <button type="button" class="drop" data-kind="${p.kind}" aria-label="Remove ${name}">×</button></figure>`;
  }).join('');
  for (const btn of strip.querySelectorAll<HTMLButtonElement>('button.drop')) {
    btn.addEventListener('click', () => {
      const gone = photos.find((p) => p.kind === btn.dataset.kind);
      if (gone) URL.revokeObjectURL(gone.url);
      photos = photos.filter((p) => p.kind !== btn.dataset.kind);
      renderPhotos();
    });
  }
}

function flash(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const el = document.getElementById('flash')!;
  el.innerHTML = `<p class="flash${kind === 'err' ? ' err' : ''}">${message}</p>`;
  if (kind === 'ok') setTimeout(() => { el.innerHTML = ''; }, 2600);
}

function readFields(): Record<string, string> {
  const ids = ['crate', 'position', 'catnoRaw', 'labelRaw', 'nameRaw',
    'titleRaw', 'matrixRunout', 'yearRaw', 'mediaGrade', 'sleeveGrade', 'capturedBy'];
  const out: Record<string, string> = {};
  for (const id of ids) {
    out[id] = (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  }
  return out;
}

async function save(): Promise<void> {
  const fields = readFields();
  if (!photos.length && !fields.catnoRaw?.trim()) {
    return flash('Photograph the label, or type a catalogue number.', 'err');
  }

  const clientId = uid();
  const entry: QueuedCapture = {
    clientId,
    createdAt: Date.now(),
    msToCapture: Date.now() - startedAt,
    fields,
    photos: await Promise.all(photos.map(async (p) => ({
      kind: p.kind as QueuedPhoto['kind'],
      blob: await downscale(p.blob),
      // Keyed by kind as well as clientId: several photos now share one
      // capture, and a retried upload must still land on the same key.
      key: `${clientId}-${p.kind}.jpg`,
    }))),
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
  };

  // On disk before anything else. The UI never awaits the network:
  // this is the whole offline guarantee, and it is why a hard refresh
  // in a loft loses nothing.
  await putEntry(entry);
  sticky.who = fields.capturedBy ?? '';

  flash(`Queued — ${Math.round(entry.msToCapture / 1000)}s. Next disc.`);
  resetForm();
  void refreshStatus();
  void drain().then(refreshStatus);   // opportunistic, never awaited by the form
}

/**
 * Downscale before queueing.
 *
 * The queue stores raw Blobs, so a crate of twenty phone frames is
 * ~80 MB in IndexedDB — on a phone, in a loft, where iOS evicts under
 * storage pressure. If the browser lacks the canvas APIs, the original
 * is queued unchanged: a large photo is worth having, and losing the
 * capture to a resize is not a trade this app should ever make.
 */
async function downscale(file: Blob): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return file;
    const bitmap = await createImageBitmap(file);
    const target = scaleTo(bitmap.width, bitmap.height, PHOTO_LONG_EDGE);
    if (!target) { bitmap.close(); return file; }
    const canvas = new OffscreenCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); return file; }
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch {
    return file;
  }
}

/**
 * A crate in one pass: one row per photo, nothing typed.
 *
 * Each photo keeps its own `clientId`, so the Worker's idempotency
 * still holds and a retry cannot double-write. Entries land on disk
 * before anything reaches the network, exactly as the single path does.
 */
async function saveBulk(files: File[]): Promise<void> {
  if (!files.length) return;
  const base = readFields();
  const started = Date.now();
  flash(`Queueing ${files.length} photo${files.length > 1 ? 's' : ''}…`);

  let queued = 0;
  for (const [index, file] of files.entries()) {
    const clientId = uid();
    await putEntry({
      clientId,
      createdAt: Date.now(),
      // One shared elapsed time divided across the batch: the median is
      // "seconds per disc", and charging one row the whole crate's
      // wall-clock would wreck the only measurement the app makes of
      // itself.
      msToCapture: Math.round((Date.now() - started) / files.length),
      fields: bulkFields(base, index),
      photos: [{ kind: 'label_a', blob: await downscale(file), key: `${clientId}.jpg` }],
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
    });
    queued++;
    if (queued % 5 === 0) void refreshStatus();
  }

  sticky.who = base.capturedBy ?? '';

  // Move the position box on, so the next crateful continues the count
  // instead of silently restarting it.
  const start = Number.parseInt((base.position ?? '').trim(), 10);
  const pos = document.getElementById('position') as HTMLInputElement | null;
  if (pos && Number.isFinite(start)) pos.value = String(start + files.length);

  flash(`${queued} queued from this crate. They upload on their own.`);
  void refreshStatus();
  void drain().then(refreshStatus);
}

function resetForm(): void {
  for (const id of ['catnoRaw', 'labelRaw', 'nameRaw', 'titleRaw', 'matrixRunout', 'yearRaw',
    'position', 'crate']) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = '';
  }
  for (const id of ['mediaGrade', 'sleeveGrade']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = '';
  }
  for (const p of photos) URL.revokeObjectURL(p.url);
  photos = [];
  pendingKind = PRIMARY_KIND;
  renderPhotos();
  startedAt = Date.now();
  (document.getElementById('catnoRaw') as HTMLInputElement | null)?.focus();
}

async function refreshStatus(): Promise<void> {
  const s = summarise(await allEntries());
  const median = s.medianMs === null ? '—' : `${(s.medianMs / 1000).toFixed(1)}s`;
  const failed = s.failed ? ` · <span class="bad">${s.failed} retrying</span>` : '';
  const el = document.getElementById('status');
  if (el) {
    // A crate that half-uploads must LOOK half-uploaded — the drain
    // now continues past a single bad row, so "3 retrying" beside a
    // falling queue is the honest picture rather than a stalled one.
    el.innerHTML = `<b>${s.pending}</b> queued · ${s.synced} sent${failed}<br>median ${median}`;
  }
}

render();
startSync(() => { void refreshStatus(); });

if ('serviceWorker' in navigator) {
  addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
