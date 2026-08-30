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
  CAPTURED_KIND, PHOTO_LONG_EDGE, bulkFields, scaleTo, summarise, torchSupported,
  videoConstraints, type QueuedCapture, type QueuedPhoto,
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
 * The photos taken for the disc in hand, in the order they were taken.
 *
 * No kind, no categories, nothing to choose. Another photograph is more
 * often wanted than not, so the interface's job is to make the next one
 * one tap away and then get out of the way. Order is kept because it is
 * a fact; nothing else about a photograph is asserted, because nothing
 * else is known.
 */
type Shot = { blob: Blob; url: string };
let photos: Shot[] = [];
let startedAt = Date.now();

const GRADES = ['', 'M', 'NM', 'VG+', 'VG', 'G', 'P'];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function render(): void {
  app.innerHTML = `
    <div class="top">
      <h1>Vinyl sorter</h1>
      <div class="status" id="status">queue…</div>
    </div>

    <div class="cam" id="cam" hidden>
      <video id="video" playsinline muted autoplay></video>
      <div class="camBar">
        <button class="torch" id="torch" type="button" hidden aria-pressed="false">🔦</button>
        <button class="shutter" id="shutter" type="button" aria-label="Take a photograph"></button>
        <button class="camOff" id="camOff" type="button">Done</button>
      </div>
    </div>

    <button class="shot" id="shot" type="button" aria-label="Photograph this record">
      <span class="hint">📷 Photograph</span>
    </button>
    <input id="file" type="file" accept="image/*" capture="environment" multiple hidden>
    <div class="strip" id="strip"></div>
    <p class="note" id="camNote">Keep going — label, sleeve, runout, whatever the record needs.
      Nothing to label or choose. Queue it when you are done with this disc.</p>

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
  $('shot').addEventListener('click', () => { void startCamera(); });
  $('shutter').addEventListener('click', () => { void grabFrame(); });
  $('camOff').addEventListener('click', () => stopCamera());
  file.addEventListener('change', () => {
    // `multiple` as well, so a phone that offers the camera roll can
    // hand over a run of shots in one go.
    const picked = [...(file.files ?? [])];
    file.value = '';                 // so the same frame can be picked twice
    for (const f of picked) photos.push({ blob: f, url: URL.createObjectURL(f) });
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
 * The live camera.
 *
 * `<input capture>` opens the phone's own camera, which is a better
 * camera — but it demands "Use Photo" after every frame and then closes,
 * so ten photographs is thirty taps and twenty context switches. A
 * stream in the page is one tap per photograph and the viewfinder never
 * goes away.
 *
 * The cost is real and worth stating: a video frame has no HDR and no
 * multi-frame stacking, so it is a weaker image than the same phone's
 * still. That is why the constraints ask for 4K and why the file input
 * stays on the page — for a label whose catalogue number will not come
 * out, the native camera is still there.
 */
let stream: MediaStream | null = null;

function camEls() {
  return {
    cam: document.getElementById('cam'),
    video: document.getElementById('video') as HTMLVideoElement | null,
    torch: document.getElementById('torch') as HTMLButtonElement | null,
    shot: document.getElementById('shot'),
    note: document.getElementById('camNote'),
  };
}

async function startCamera(): Promise<void> {
  const { cam, video, torch, shot, note } = camEls();
  if (!cam || !video || !shot) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    // No stream available — the file input is still wired up and does
    // the whole job, one photograph at a time.
    flash('This browser has no in-page camera; using the phone camera instead.', 'err');
    (document.getElementById('file') as HTMLInputElement).click();
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia(videoConstraints());
  } catch {
    // Denied, or no camera. Never leave the user with nothing.
    flash('No camera access — using the phone camera instead.', 'err');
    (document.getElementById('file') as HTMLInputElement).click();
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  cam.hidden = false;
  shot.hidden = true;
  if (note) note.textContent = 'Tap the shutter for each photograph — no confirming, '
    + 'no closing. Done when this disc is finished, then Queue it.';

  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.();
  if (track && torch && torchSupported(caps)) {
    torch.hidden = false;
    torch.onclick = async () => {
      const on = torch.getAttribute('aria-pressed') === 'true';
      try {
        // `torch` is not in the DOM typings — it is a real constraint
        // that Chrome implements and the spec lists, so the cast is the
        // typings being behind rather than a guess about the platform.
        await track.applyConstraints(
          { advanced: [{ torch: !on }] } as unknown as MediaTrackConstraints);
        torch.setAttribute('aria-pressed', String(!on));
        torch.classList.toggle('on', !on);
      } catch { torch.hidden = true; }
    };
  } else if (torch) {
    // iOS Safari exposes no torch at all. A dead button is worse than
    // no button, so it stays hidden rather than pretending.
    torch.hidden = true;
  }
}

function stopCamera(): void {
  const { cam, video, shot, note } = camEls();
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
  if (video) video.srcObject = null;
  if (cam) cam.hidden = true;
  if (shot) shot.hidden = false;
  if (note) note.textContent = 'Keep going — label, sleeve, runout, whatever the record needs. '
    + 'Nothing to label or choose. Queue it when you are done with this disc.';
}

/**
 * Grab the current frame. One tap, no confirmation, no closing — which
 * is the entire reason this exists.
 *
 * Drawn straight to the stored size rather than at full resolution and
 * downscaled later. Encoding a 4K JPEG and then re-encoding it at 1568
 * was measured at ~1.8 s a shot, which is slower than the taps: hold
 * the shutter down and the frames fall behind the thumb. Scaling in
 * `drawImage` is one encode instead of two, at a sixth of the pixels,
 * and nothing is lost — the full-resolution frame was being thrown away
 * at save time anyway.
 */
async function grabFrame(): Promise<void> {
  const { video } = camEls();
  if (!video || !video.videoWidth) return;

  // Feedback FIRST. The encode takes long enough to notice, and a
  // shutter that responds after it is a shutter that feels broken.
  const el = document.getElementById('shutter');
  el?.classList.add('fired');
  setTimeout(() => el?.classList.remove('fired'), 140);
  if (navigator.vibrate) navigator.vibrate(12);

  const target = scaleTo(video.videoWidth, video.videoHeight, PHOTO_LONG_EDGE)
    ?? { width: video.videoWidth, height: video.videoHeight };
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, target.width, target.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) return;
  photos.push({ blob, url: URL.createObjectURL(blob) });
  renderPhotos();
}

/**
 * Paint the shot button and the strip from `photos`.
 *
 * The button never changes into a "done" state: another photograph is
 * more often wanted than not, so it stays one tap away and `Queue it`
 * is what says you have finished with this disc.
 */
function renderPhotos(): void {
  const shot = document.getElementById('shot');
  const strip = document.getElementById('strip');
  if (!shot || !strip) return;

  const n = photos.length;
  shot.classList.toggle('has-photo', n > 0);
  shot.innerHTML = n === 0
    ? '<span class="hint">📷 Photograph</span>'
    : `<img src="${photos[n - 1]!.url}" alt="The photograph just taken">
       <span class="retake">📷 Another — ${n} so far</span>`;

  strip.innerHTML = photos.map((p, i) =>
    `<figure class="thumb"><img src="${p.url}" alt="Photograph ${i + 1}">
      <figcaption>${i + 1}</figcaption>
      <button type="button" class="drop" data-i="${i}" aria-label="Remove photograph ${i + 1}">×</button></figure>`).join('');
  for (const btn of strip.querySelectorAll<HTMLButtonElement>('button.drop')) {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const gone = photos[i];
      if (gone) URL.revokeObjectURL(gone.url);
      photos = photos.filter((_, j) => j !== i);
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
    photos: await Promise.all(photos.map(async (p, i) => ({
      kind: CAPTURED_KIND as QueuedPhoto['kind'],
      blob: await downscale(p.blob),
      // The index is the only thing asserted about a photograph, and it
      // is a fact about the order rather than a claim about the content.
      // It also keeps the key stable, so a retried upload lands twice on
      // the same object instead of making a second one.
      key: `${clientId}-${i + 1}.jpg`,
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
      photos: [{ kind: CAPTURED_KIND as QueuedPhoto['kind'], blob: await downscale(file), key: `${clientId}-1.jpg` }],
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
