/**
 * Photo-first capture.
 *
 * Build photo-first before type-at-shelf: walk a crate photographing
 * labels, type nothing, transcribe later at a desk. It is faster per
 * disc and it is delegable.
 *
 * The one rule the interface exists to enforce: LABEL AND CATALOGUE
 * NUMBER ARE SEPARATE INPUTS. Merging them is what left label captured
 * on 0% of the backlog and caused the 9% match error rate M0 measured.
 */

import { putEntry, allEntries } from './queue.ts';
import { summarise, type QueuedCapture } from './queue-logic.ts';
import { startSync, drain } from './sync.ts';

const app = document.getElementById('app')!;

/** Sticky between discs: you work through one crate at a time. */
const sticky = {
  get crate() { return localStorage.getItem('dg.crate') ?? ''; },
  set crate(v: string) { localStorage.setItem('dg.crate', v); },
  get who() { return localStorage.getItem('dg.who') ?? ''; },
  set who(v: string) { localStorage.setItem('dg.who', v); },
};

let photoBlob: Blob | null = null;
let photoUrl: string | null = null;
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
    <p class="note">The photo settles every later question without handling the disc again.</p>

    <fieldset>
      <legend>Where it lives</legend>
      <div class="pair">
        <label><span>Crate *</span><input id="crate" inputmode="text" autocomplete="off" placeholder="B4"></label>
        <label><span>Position</span><input id="position" inputmode="numeric" autocomplete="off" placeholder="12"></label>
      </div>
    </fieldset>

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
      <summary>More — title, matrix/runout, year, who is capturing</summary>
      <label><span>Title</span><input id="titleRaw" autocomplete="off"></label>
      <label><span>Matrix / runout</span><input id="matrixRunout" autocomplete="off" spellcheck="false"
        placeholder="ZAL-6113-1W"></label>
      <p class="note">The only truly unique pressing identifier — it tells an original from a repress.</p>
      <label><span>Year</span><input id="yearRaw" inputmode="numeric" autocomplete="off"></label>
      <label><span>Captured by</span><input id="capturedBy" autocomplete="off"></label>
    </details>

    <div id="flash"></div>

    <div class="bar"><div class="inner">
      <button class="primary" id="save" type="button">Queue it</button>
      <button class="ghost" id="clear" type="button">Clear</button>
    </div></div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  $<HTMLInputElement>('crate').value = sticky.crate;
  $<HTMLInputElement>('capturedBy').value = sticky.who;

  const file = $<HTMLInputElement>('file');
  $('shot').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    photoBlob = f;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(f);
    const shot = $('shot');
    shot.classList.add('has-photo');
    shot.innerHTML = `<img src="${photoUrl}" alt="The label just photographed"><span class="retake">Retake</span>`;
  });

  $('save').addEventListener('click', () => { void save(); });
  $('clear').addEventListener('click', () => { resetForm(); });
  void refreshStatus();
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
  if (!fields.crate?.trim()) return flash('Crate is needed, so a session card can say where to find it.', 'err');
  if (!photoBlob && !fields.catnoRaw?.trim()) {
    return flash('Photograph the label, or type a catalogue number.', 'err');
  }

  const clientId = uid();
  const entry: QueuedCapture = {
    clientId,
    createdAt: Date.now(),
    msToCapture: Date.now() - startedAt,
    fields,
    photos: photoBlob ? [{ kind: 'label_a', blob: photoBlob, key: `${clientId}.jpg` }] : [],
    state: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
  };

  // On disk before anything else. The UI never awaits the network:
  // this is the whole offline guarantee, and it is why a hard refresh
  // in a loft loses nothing.
  await putEntry(entry);
  sticky.crate = fields.crate ?? '';
  sticky.who = fields.capturedBy ?? '';

  flash(`Queued — ${Math.round(entry.msToCapture / 1000)}s. Next disc.`);
  resetForm();
  void refreshStatus();
  void drain().then(refreshStatus);   // opportunistic, never awaited by the form
}

function resetForm(): void {
  for (const id of ['catnoRaw', 'labelRaw', 'nameRaw', 'titleRaw', 'matrixRunout', 'yearRaw', 'position']) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = '';
  }
  for (const id of ['mediaGrade', 'sleeveGrade']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = '';
  }
  photoBlob = null;
  if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
  const shot = document.getElementById('shot')!;
  shot.classList.remove('has-photo');
  shot.innerHTML = '<span class="hint">📷 Photograph the label</span>';
  startedAt = Date.now();
  (document.getElementById('catnoRaw') as HTMLInputElement | null)?.focus();
}

async function refreshStatus(): Promise<void> {
  const s = summarise(await allEntries());
  const median = s.medianMs === null ? '—' : `${(s.medianMs / 1000).toFixed(1)}s`;
  const failed = s.failed ? ` · <span class="bad">${s.failed} retrying</span>` : '';
  const el = document.getElementById('status');
  if (el) {
    el.innerHTML = `<b>${s.pending}</b> queued · ${s.synced} sent${failed}<br>median ${median}`;
  }
}

render();
startSync(() => { void refreshStatus(); });

if ('serviceWorker' in navigator) {
  addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
