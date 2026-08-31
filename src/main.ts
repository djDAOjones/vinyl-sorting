/**
 * Photo-first capture.
 *
 * Build photo-first before type-at-shelf: walk a crate photographing
 * labels, type nothing, transcribe later at a desk. It is faster per
 * disc and it is delegable.
 *
 * ONE DISC AT A TIME, photographed as many times as it needs. The
 * crate-in-one-pass mode is gone (maintainer, 2026-08-31): it wrote one
 * row per photograph, and more than one photograph is always wanted —
 * label, sleeve, runout — so a crate walked that way manufactured three
 * discs where one stood. The speed it bought is bought instead by
 * having almost nothing on the page: photograph, and type only what you
 * feel like typing.
 *
 * The one rule the interface exists to enforce: LABEL AND CATALOGUE
 * NUMBER ARE SEPARATE INPUTS. Merging them is what left label captured
 * on 0% of the backlog and caused the 9% match error rate M0 measured.
 */

import { putEntry, allEntries, deleteEntry } from './queue.ts';
import {
  CAPTURED_KIND, PHOTO_LONG_EDGE, UNDO_MS, heldForUndo, scaleTo, summarise,
  torchSupported, videoConstraints, type QueuedCapture, type QueuedPhoto,
} from './queue-logic.ts';
import { startSync, drain } from './sync.ts';
import {
  forgetCapturer, rememberCapturer, resolveCapturer, storedCapturer,
} from './who.ts';
import { bootChrome, headerHtml } from './chrome.ts';

const app = document.getElementById('app')!;

/**
 * Nothing is sticky between discs except the name of the person holding
 * the phone, which is not a claim about any disc.
 *
 * Crate used to stick too, which was right while it was a required
 * field you could see. Now that the whole "More" block is parked, a
 * remembered value would attach itself to every future capture unseen —
 * so one placeholder typed once ("1", on item 448) would go on
 * asserting a location nobody has confirmed. An invisible field that
 * fills itself in is the same fault as a required field answered with
 * filler, and this project's rule is the same either way: refuse rather
 * than guess.
 *
 * The capturer survives that test where crate does not: it is a fact
 * about the person, not about the disc. It lives in `who.ts`, is typed
 * once at the gate below, and is checked against the roster on every
 * read — so a free-text value left by an older build cannot go on
 * stamping rows.
 */

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

/**
 * The first-run gate: type your name.
 *
 * One screen, once per device. It refuses a name that is not on the
 * roster, and that refusal is the whole gate — see `who.ts` for what
 * this is and, more importantly, what it is not.
 *
 * It does not gate the QUEUE. `startSync` runs whatever this screen is
 * showing, so a phone that comes back from a loft with twenty captures
 * on it uploads them while somebody works out how to spell Jojo. The
 * offline guarantee is not the kind of promise that gets a caveat.
 */
function renderWhoGate(): void {
  app.innerHTML = `
    ${headerHtml({ here: 'capture', title: 'Add vinyl',
    aside: '<div class="tally" id="status">queue…</div>' })}

    <fieldset>
      <legend>Who is capturing?</legend>
      <label><span>Your first name</span>
        <input id="whoBox" autocomplete="off" autocapitalize="words" spellcheck="false"
          enterkeyhint="go"></label>
      <p class="note">It goes on every record you photograph. Typed once on this phone,
        then never again — and until it is, this is also the only thing between the page
        and whoever else finds the link.</p>
    </fieldset>

    <div id="flash"></div>

    <div class="bar"><div class="inner">
      <button class="primary" id="whoGo" type="button">Start</button>
    </div></div>`;

  const box = document.getElementById('whoBox') as HTMLInputElement;
  const go = (): void => {
    const named = resolveCapturer(box.value);
    if (!named) {
      // Refuse without listing the answers: printing the roster here
      // would hand over the only thing this asks you to know.
      flash('Not a name this app knows. Ask whoever set the phone up.', 'err');
      box.select();
      return;
    }
    rememberCapturer(named);
    render();
  };
  document.getElementById('whoGo')!.addEventListener('click', go);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  box.focus();
  void refreshStatus();
}

function render(): void {
  // No name, no capture screen. The queue drains regardless — see
  // `renderWhoGate`.
  const capturer = storedCapturer();
  if (!capturer) return renderWhoGate();

  app.innerHTML = `
    ${headerHtml({ here: 'capture', title: 'Add vinyl',
    aside: `<button class="whoTag" id="whoTag" type="button"
        title="Hand the phone over">${capturer}</button>
      <div class="tally" id="status">queue…</div>` })}

    <div class="cam" id="cam" hidden>
      <video id="video" playsinline muted autoplay></video>
      <!-- Out of the bar and into the corner. The torch is set once on the
           way into the loft; everything left in the bar is used per disc or
           per photograph, and the column it vacated is the one Next disc
           needed. -->
      <button class="torch" id="torch" type="button" hidden aria-pressed="false">🔦</button>
      <div class="camBar">
        <button class="next" id="nextDisc" type="button" disabled>Next disc</button>
        <button class="shutter" id="shutter" type="button" aria-label="Take a photograph"></button>
        <button class="camOff" id="camOff" type="button">Done</button>
      </div>
    </div>

    <button class="shot" id="shot" type="button" aria-label="Photograph this record">
      <span class="hint">📷 Photograph</span>
    </button>
    <input id="file" type="file" accept="image/*" capture="environment" multiple hidden>
    <div class="strip" id="strip"></div>
    <p class="note" id="camNote">Label, sleeve, runout — as many as the disc needs.</p>

    <fieldset>
      <legend>Off the label</legend>
      <label><span>Catalogue number</span>
        <input id="catnoRaw" autocomplete="off" autocapitalize="characters" spellcheck="false"
          enterkeyhint="next" placeholder="SXL 6113"></label>
      <label><span>Label</span>
        <input id="labelRaw" autocomplete="off" spellcheck="false"
          enterkeyhint="next" placeholder="Decca"></label>
      <label><span>Composer, conductor or soloist</span>
        <input id="nameRaw" autocomplete="off" enterkeyhint="done" placeholder="Solti"></label>
      <p class="note">Label and catalogue number stay in separate boxes: mashing the two together is
        what pointed 9% of the old matches at the wrong record.</p>
    </fieldset>

    <!-- PARKED, not deleted (maintainer, 2026-08-31). Condition grading and the
         "More" block are commented out of the page rather than taken out of the
         system: the Worker still accepts every one of these fields, readFields
         still looks for each id, and removing these two comment markers puts the
         markup back exactly as it was. They are off the page because every field
         between the shutter and "Queue it" is a reason to stop cataloguing, which
         is the brief's stated risk — and because all of it is still legible on the
         photograph afterwards, where condition and matrix are read more reliably
         than they are typed one-handed in a loft.

    <fieldset>
      <legend>Condition</legend>
      <div class="pair">
        <label><span>Media</span><select id="mediaGrade">${GRADES.map((g) => `<option value="${g}">${g || '—'}</option>`).join('')}</select></label>
        <label><span>Sleeve</span><select id="sleeveGrade">${GRADES.map((g) => `<option value="${g}">${g || '—'}</option>`).join('')}</select></label>
      </div>
    </fieldset>
    -->

    <!-- PARKED with the block above, and for the same reason.
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
    -->

    <div id="flash"></div>

    <div class="bar"><div class="inner">
      <button class="primary" id="save" type="button">Queue it</button>
      <button class="ghost" id="clear" type="button">Clear</button>
    </div></div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  // The box is inside the parked block on this build, so there may be
  // nothing to fill in. Blind `$('capturedBy').value =` threw here and
  // took the whole render with it.
  const whoBox = document.getElementById('capturedBy') as HTMLInputElement | null;
  if (whoBox) whoBox.value = capturer;
  // Clear anything a previous build remembered, so a placeholder typed
  // once cannot keep attaching itself to new captures.
  localStorage.removeItem('dg.crate');

  // The phone gets handed over mid-crate, so the name has to be
  // changeable — but never silently: captures already queued keep the
  // name they were made under, which is the entire point of writing it
  // down. The photographs in hand survive too; only typing is lost.
  $('whoTag').addEventListener('click', () => {
    if (!confirm(`Capturing as ${capturer}. Hand the phone to someone else?`
      + '\nThe queue and the photographs in hand are kept; typing is cleared.')) return;
    forgetCapturer();
    render();
  });

  const file = $<HTMLInputElement>('file');
  $('shot').addEventListener('click', () => { void startCamera(); });
  $('shutter').addEventListener('click', () => { void grabFrame(); });
  $('camOff').addEventListener('click', () => stopCamera());
  // One tap files the disc in hand and leaves the viewfinder open, so a
  // crate costs N shutter taps plus one instead of N plus three, and the
  // camera never restarts between discs.
  $('nextDisc').addEventListener('click', () => { void save('camera'); });
  file.addEventListener('change', () => {
    // `multiple` as well, so a phone that offers the camera roll can
    // hand over a run of shots in one go.
    const picked = [...(file.files ?? [])];
    file.value = '';                 // so the same frame can be picked twice
    for (const f of picked) photos.push({ blob: f, url: URL.createObjectURL(f) });
    renderPhotos();
  });

  /**
   * Enter walks down the three boxes, and the last one puts the
   * keyboard away.
   *
   * On a phone the keyboard covers the bottom bar, so "Queue it" is
   * unreachable until something dismisses it — which used to mean
   * hunting for the keyboard's own close key. Enter is where the thumb
   * already is. It deliberately does not submit: the photographs are
   * the capture, and a stray Enter must never queue a disc the person
   * had not finished with.
   */
  const boxes = ['catnoRaw', 'labelRaw', 'nameRaw'].map((id) => $<HTMLInputElement>(id));
  boxes.forEach((box, i) => {
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = boxes[i + 1];
      if (next) next.focus();
      else box.blur();
    });
  });

  renderPhotos();
  $('save').addEventListener('click', () => { void save('form'); });
  $('clear').addEventListener('click', () => {
    // Clear sits a thumb's width from "Queue it" and there is no undo
    // anywhere: a mis-tap threw away every photograph of the disc in
    // hand, silently. Ask, but only when there is something to lose.
    const typed = boxes.some((b) => b.value.trim());
    if ((photos.length || typed) && !confirm('Clear this disc? The photographs go too.')) return;
    resetForm();
  });
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
/** Kept across a restart, so turning the phone does not put the lamp out. */
let torchOn = false;

/**
 * The live video track, resolved at every use rather than captured.
 *
 * THE BUG THIS FIXES: the torch handler used to close over the track
 * that existed when the camera opened. Turning the phone restarts the
 * stream and stops that track, so the next tap applied a constraint to
 * a dead one, threw, and the catch hid the button — a torch that
 * worked until you rotated and then vanished, blaming the platform for
 * a stale reference.
 */
const videoTrack = (): MediaStreamTrack | null => stream?.getVideoTracks()[0] ?? null;

/** Apply the torch to whichever track is live now. Reports success. */
async function setTorch(on: boolean): Promise<boolean> {
  const track = videoTrack();
  if (!track) return false;
  try {
    // `torch` is not in the DOM typings — it is a real constraint that
    // Chrome implements and the spec lists, so the cast is the typings
    // being behind rather than a guess about the platform.
    await track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}

/** Paint the torch button from `torchOn`. */
function renderTorch(): void {
  const torch = document.getElementById('torch');
  if (!torch) return;
  torch.setAttribute('aria-pressed', String(torchOn));
  torch.classList.toggle('on', torchOn);
}

function camEls() {
  return {
    cam: document.getElementById('cam'),
    video: document.getElementById('video') as HTMLVideoElement | null,
    torch: document.getElementById('torch') as HTMLButtonElement | null,
    shot: document.getElementById('shot'),
    note: document.getElementById('camNote'),
  };
}

/**
 * Re-acquire the stream when the phone turns.
 *
 * THE BUG THIS FIXES, found in 60 real photographs: on iOS the track's
 * dimensions are fixed when `getUserMedia` is called and do not follow
 * the device. Open the camera in portrait, turn the phone to landscape
 * to frame a sleeve, and the frame stays portrait while you hold it
 * sideways — so the label arrives rotated 90°, as `451-1.jpg` did,
 * while photographs taken without turning the phone came out upright.
 * That is why it looked intermittent.
 *
 * Restarting renegotiates the stream for the orientation now in use, so
 * the preview and the capture agree again. It costs a brief black frame
 * when you turn the phone, which is a fair price for not silently
 * storing a sideways label.
 */
function watchOrientation(): void {
  const onTurn = () => {
    if (!stream) return;
    // A restart mid-turn can land on the old dimensions, so let the
    // rotation settle before asking again.
    setTimeout(() => { if (stream) void restartStream(); }, 350);
  };
  screen.orientation?.addEventListener?.('change', onTurn);
  addEventListener('orientationchange', onTurn);
}

/** Swap the stream without closing the viewfinder or losing the shots. */
async function restartStream(): Promise<void> {
  const { video } = camEls();
  if (!video) return;
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia(videoConstraints());
  } catch {
    flash('Lost the camera when the phone turned. Tap Done and start it again.', 'err');
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  // The new track starts dark. Relighting it is what keeps the lamp on
  // across a turn, which is exactly when a crate in a loft needs it.
  if (torchOn && !(await setTorch(true))) {
    torchOn = false;
    renderTorch();
  }
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
  document.body.classList.add('shooting');
  watchOrientation();
  if (note) note.textContent = 'One tap per photograph. Done when the disc is finished.';
  renderPhotos();

  if (!torch) return;

  /**
   * The torch is OFFERED, then tried, rather than decided in advance.
   *
   * `getCapabilities` under-reports on some browsers and does not exist
   * on others, so gating purely on it hides the control from devices
   * that would in fact have worked. Offering it and failing honestly on
   * the first tap costs one tap and tells the truth; hiding it costs
   * the feature everywhere the report is wrong.
   */
  const known = torchSupported(videoTrack()?.getCapabilities?.());
  torch.hidden = false;
  torchOn = false;
  renderTorch();
  torch.onclick = async () => {
    if (await setTorch(!torchOn)) {
      torchOn = !torchOn;
      renderTorch();
      return;
    }
    // Safari on iOS refuses this outright. Say why, and say what does
    // work — the system torch stays lit while the camera is running, so
    // the lamp is available even though the page cannot reach it.
    torch.hidden = true;
    flash(known
      ? 'The camera refused the torch. Use Control Centre instead — it stays on while you shoot.'
      : 'This browser will not let a page control the torch. Swipe into Control Centre and '
        + 'turn it on there — it stays on while you shoot.', 'err');
  };
}

function stopCamera(): void {
  const { cam, video, shot, note } = camEls();
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
  if (video) video.srcObject = null;
  if (cam) cam.hidden = true;
  if (shot) shot.hidden = false;
  document.body.classList.remove('shooting');
  torchOn = false;
  renderTorch();
  if (note) note.textContent = 'Label, sleeve, runout — as many as the disc needs.';
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

  const done = document.getElementById('camOff');
  if (done) done.textContent = photos.length ? `Done · ${photos.length}` : 'Done';

  // The count belongs on the button that acts on it. The strip is above
  // the fold once the form is filled, so "Queue it" alone gave no way to
  // tell four photographs from none without scrolling back up.
  const queueBtn = document.getElementById('save');
  if (queueBtn) queueBtn.textContent = n ? `Queue it · ${n} photo${n === 1 ? '' : 's'}` : 'Queue it';

  // Next disc carries its count for the same reason, and is inert until
  // there is one: inside the viewfinder the shutter is the ONLY way to
  // put something in hand, so a tap with nothing behind it could not be
  // anything but a mis-tap. This is also the last word on the button's
  // enabled state — `save` disables it while a write is in flight and
  // then calls back here rather than re-enabling it blindly.
  const next = document.getElementById('nextDisc') as HTMLButtonElement | null;
  if (next) {
    next.textContent = n ? `Next disc · ${n}` : 'Next disc';
    next.disabled = n === 0;
  }

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

/**
 * A toast over everything, including the fullscreen viewfinder.
 *
 * With an `undo` handler it carries a button and does NOT fade on its
 * own timer: the offer has to outlive the window it belongs to, and a
 * toast that clears itself two seconds into a five-second undo is worse
 * than offering no undo at all. `closeUndo` takes it down instead.
 */
function flash(message: string, kind: 'ok' | 'err' = 'ok', undo?: () => void): void {
  const el = document.getElementById('flash')!;
  const button = undo ? '<button type="button" class="undo" id="undoBtn">Undo</button>' : '';
  el.innerHTML = `<p class="flash${kind === 'err' ? ' err' : ''}">${message}${button}</p>`;
  if (undo) {
    document.getElementById('undoBtn')?.addEventListener('click', () => { void undo(); });
    return;
  }
  if (kind === 'ok') setTimeout(() => { el.innerHTML = ''; }, 2600);
}

/**
 * The disc just filed, still recallable.
 *
 * Next disc is one tap that says "this is one record", and there is no
 * un-queue afterwards — so a mis-tap between two photographs of the
 * same disc would file half of it and turn the other half into a SECOND
 * record. That is precisely the fault the crate mode was deleted for,
 * arriving one tap at a time instead of one crate at a time.
 *
 * The window is bounded by `heldForUndo`, which delays the send and
 * nothing else. The entry is on disk immediately, as it always was.
 */
let undoable: { clientId: string; shots: Shot[]; fields: Record<string, string> } | null = null;
let undoTimer = 0;

/** Stop offering Undo: the disc belongs to the queue now, so let it go. */
function closeUndo(): void {
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = 0; }
  const settled = undoable;
  undoable = null;
  if (!settled) return;
  for (const s of settled.shots) URL.revokeObjectURL(s.url);
  const el = document.getElementById('flash');
  if (el?.querySelector('.undo')) el.innerHTML = '';
  // The hold expired with it, so send now rather than waiting out the
  // fifteen-second tick with a finished disc sitting in the queue.
  void drain().then(refreshStatus);
}

/**
 * Put the filed disc back in hand.
 *
 * Its photographs go in FRONT of anything shot since, so a tap that
 * landed between two frames of one disc loses neither. Typed values are
 * restored only into boxes that are still empty: undoing a mis-tap must
 * never delete something typed in the seconds after it.
 */
async function undoQueued(): Promise<void> {
  const back = undoable;
  if (!back) return;
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = 0; }
  undoable = null;
  await deleteEntry(back.clientId);
  photos = [...back.shots, ...photos];
  for (const [id, value] of Object.entries(back.fields)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el && !el.value) el.value = value;
  }
  renderPhotos();
  flash('Put back — still the same disc.');
  void refreshStatus();
}

function readFields(): Record<string, string> {
  const ids = ['crate', 'position', 'catnoRaw', 'labelRaw', 'nameRaw',
    'titleRaw', 'matrixRunout', 'yearRaw', 'mediaGrade', 'sleeveGrade', 'capturedBy'];
  const out: Record<string, string> = {};
  for (const id of ids) {
    // Every parked id is looked for and simply comes back empty, so the
    // list stays complete: un-parking a block needs no change here.
    out[id] = (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  }
  // `capturedBy` has no box on this build, so it comes from the gate:
  // a name a person typed on this phone and the roster accepted. A
  // field that is not on the page cannot un-type it.
  if (!out.capturedBy) out.capturedBy = storedCapturer() ?? '';
  return out;
}

/** True while a queue write is in flight. See `save`. */
let saving = false;

async function save(from: 'form' | 'camera' = 'form'): Promise<void> {
  const fields = readFields();
  if (!photos.length && !fields.catnoRaw?.trim()) {
    return flash('Photograph the label, or type a catalogue number.', 'err');
  }
  // A double tap on a phone is one gesture, and each pass mints its own
  // clientId — so the Worker's idempotency cannot help, and the second
  // tap would write a second disc with the same photographs.
  if (saving) return;
  saving = true;
  const saveBtn = document.getElementById('save') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('nextDisc') as HTMLButtonElement | null;
  if (saveBtn) saveBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;
  // Whatever was filed before this one is settled now. One window at a
  // time, so the Undo on screen always names the disc it would recall.
  closeUndo();

  try {
    const clientId = uid();
    // Held back from the drain for the undo window — a delayed SEND, not
    // a delayed write. See `heldForUndo`.
    const entry: QueuedCapture = heldForUndo({
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
    }, Date.now());

    // On disk before anything else. The UI never awaits the network:
    // this is the whole offline guarantee, and it is why a hard refresh
    // in a loft loses nothing.
    await putEntry(entry);
    // Only a roster name may be remembered. Un-parking the `capturedBy`
    // box would otherwise let free text back into `dg.who`, which is
    // exactly what the gate exists to keep out.
    const typed = fields.capturedBy ? resolveCapturer(fields.capturedBy) : null;
    if (typed) rememberCapturer(typed);

    // The previews are handed to Undo rather than revoked, and `photos`
    // is emptied HERE so `resetForm` has nothing left to free — the
    // images have to outlive the reset for the recall to have anything
    // to put back.
    const shots = photos;
    photos = [];
    undoable = { clientId, shots, fields };
    undoTimer = setTimeout(closeUndo, UNDO_MS) as unknown as number;

    flash(from === 'camera'
      ? `Filed — ${shots.length} photo${shots.length === 1 ? '' : 's'}. Next disc.`
      : `Queued — ${Math.round(entry.msToCapture / 1000)}s. Next disc.`, 'ok', undoQueued);
    resetForm();
    void refreshStatus();
    // No drain here any more: the entry is deliberately not due yet, so
    // a pass now would skip it and the one `closeUndo` fires sends it.
  } finally {
    saving = false;
    if (saveBtn) saveBtn.disabled = false;
    // `nextDisc` is enabled by the photograph count rather than by this,
    // so let renderPhotos have the last word — including on the throw
    // path, where the disc is still in hand.
    renderPhotos();
  }
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
  // No autofocus. Focusing the catalogue number here threw the keyboard
  // over the bottom half of the screen, and the next thing anyone does
  // is photograph the next disc — so the keyboard had to be dismissed
  // before the shutter could be reached. Go to the top instead, where
  // the Photograph button lands under the thumb.
  scrollTo({ top: 0, behavior: 'smooth' });
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

// The go-to keys and the shortcut card, and nothing else: there is no
// keyboard in a loft, and a phone that shows one has taken the screen
// away from the viewfinder (APP-KEYS).
bootChrome();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}
