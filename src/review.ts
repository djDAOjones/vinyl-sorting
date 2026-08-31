/**
 * The review queue — the screen that decides the project.
 *
 * Keyboard only: 1–5 selects a candidate, N none of these, S skip,
 * B back, M manual entry. Hundreds of items pass through here, and
 * mouse travel is the difference between clearing the queue and
 * abandoning it.
 *
 * Every candidate shows WHY it scored — which families of evidence
 * agreed — not just a number. A reviewer who can only see "84" has no
 * basis to disagree with it, and disagreeing is the whole job.
 */

import { ensureCapturerCookie, rememberCapturer, resolveCapturer, storedCapturer } from './who.ts';
import { bootChrome, esc, headerHtml, isTyping, parseJson as parse, toast } from './chrome.ts';

const app = document.getElementById('review')!;
const API = '/api';

interface Candidate {
  rank: number; discogs_id: number; score: number;
  signals_json: string;
}
interface QueueItem {
  run_id: number; item_id: number; state: string; queries_json: string;
  catno_raw: string | null; label_raw: string | null; title_raw: string | null; name_raw: string | null;
  crate: string | null; position: string | null; last_verified_at: string | null;
  photo_keys: string | null;
  candidates: Candidate[];
}

let queue: QueueItem[] = [];
let cursor = 0;
let resolvedCount = 0;

/**
 * The same name capture uses, checked against the same roster.
 *
 * This screen used to take whatever was typed, which is how free text
 * got into `dg.who` in the first place — a decision signed "jo " reads
 * as a different person from one signed "Joe" for ever afterwards.
 * CAPTURE-WHO put the roster behind it, and `storedCapturer` re-checks
 * on every read, so an old free-text value asks once more rather than
 * going on signing decisions.
 */
const who = {
  get value() { return storedCapturer() ?? ''; },
};

/** What `?` lists for this screen. Bound at the bottom of the file. */
const SCREEN_KEYS = [
  { keys: '1 2 3 4 5', what: 'Accept that candidate' },
  { keys: 'N', what: 'None of these are it' },
  { keys: 'S', what: 'Skip — decide later' },
  { keys: 'B', what: 'Back to the previous item' },
  { keys: 'M', what: 'Type a Discogs ID by hand' },
];

async function load(): Promise<void> {
  // Named, so the queue carries the photo keys. Judging a match
  // against a disc you cannot see is what produced two confirmations
  // made blind on 2026-08-31.
  const who = storedCapturer();
  const res = await fetch(`${API}/review-queue?limit=200`,
    who ? { headers: { 'x-capturer': who } } : {});
  queue = (await res.json() as { queue: QueueItem[] }).queue;
  cursor = 0;
  render();
}

function render(): void {
  if (!who.value) return renderWhoAmI();
  const item = queue[cursor];
  if (!item) return renderDone();

  const refusal = parse<{ reason?: string }>(item.queries_json, {}).reason ?? '';

  app.innerHTML = `
    ${headerHtml({ here: 'review', title: 'Resolve entries',
    aside: `<div class="tally"><b>${cursor + 1}</b> of ${queue.length} ·
      ${resolvedCount} resolved<br>item ${item.item_id}</div>` })}

    ${refusal ? `<p class="note-info"><strong>Not auto-accepted:</strong> ${esc(refusal)}</p>` : ''}

    <div class="split">
      <section class="readoff">
        <h2 class="subhead">What was read off the disc</h2>
        <dl class="facts">
          ${field('Catalogue', item.catno_raw)}
          ${field('Label', item.label_raw)}
          ${field('Title', item.title_raw)}
          ${field('Name', item.name_raw)}
          ${field('Crate', [item.crate, item.position].filter(Boolean).join(' · '))}
        </dl>
        ${photosHtml(item)}
      </section>

      <section>
        <div class="cands">
          ${item.candidates.length
            ? item.candidates.map(renderCandidate).join('')
            : '<p class="note-info">No candidate scored above zero. Enter a Discogs ID, or record “none of these”.</p>'}
        </div>
        <div class="manual">
          <input id="manual" placeholder="Paste a Discogs release URL or ID, then Enter"
            inputmode="numeric" autocomplete="off">
        </div>
      </section>
    </div>

    <div class="keybar"><div class="inner">
      <span><kbd>1</kbd>–<kbd>5</kbd> choose</span>
      <span><kbd>N</kbd> none of these</span>
      <span><kbd>S</kbd> skip</span>
      <span><kbd>B</kbd> back</span>
      <span><kbd>M</kbd> manual ID</span>
      <span><kbd>?</kbd> all shortcuts</span>
      <span style="margin-left:auto">reviewing as <strong>${esc(who.value)}</strong></span>
    </div></div>
    <div id="toast"></div>`;

  // Only the left half accepts. The right half is a plain link and
  // needs no handler — which is the point: nothing that opens Discogs
  // can accidentally record a decision.
  for (const button of app.querySelectorAll<HTMLButtonElement>('.cand .pick')) {
    button.addEventListener('click', () => { void choose(Number(button.dataset.discogsId)); });
  }
  const manual = document.getElementById('manual') as HTMLInputElement;
  manual.addEventListener('keydown', (e) => {
    e.stopPropagation();                    // typing an ID is not a shortcut
    if (e.key === 'Enter') void submitManual(manual.value);
    if (e.key === 'Escape') manual.blur();
  });
}

const field = (label: string, value: string | null): string =>
  `<dt>${label}</dt><dd class="${value ? '' : 'empty'}">${value ? esc(value) : '—'}</dd>`;

/**
 * The record itself, so a match can be checked against the disc.
 *
 * Without this the screen asked "is this right?" and offered nothing to
 * answer with — on 2026-08-31 two items were confirmed that way, and
 * the maintainer said plainly they had no idea how they were meant to
 * cross-check. The photographs were in R2 the whole time.
 *
 * Click one to open it full size; a label's catalogue number is often
 * smaller than the thumbnail can carry.
 *
 * NOT `loading="lazy"`. A dozen small thumbnails on a card a person
 * opened deliberately gain nothing from it, and it cost the feature
 * once: the images sat unrequested behind an intersection observer
 * that never fired, which looks exactly like a broken gate and sent me
 * hunting the wrong bug.
 */
function photosHtml(item: QueueItem): string {
  const keys = (item.photo_keys ?? '').split('\n').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) {
    return '<p class="note">No photograph — one of the 446 rows imported from the spreadsheet.</p>';
  }
  return `<div class="shots">${keys.map((k, i) => `
    <a class="shot-link" href="${API}/photos/${encodeURI(k)}" target="_blank" rel="noopener">
      <img src="${API}/photos/${encodeURI(k)}"
           alt="Photograph ${i + 1} of item ${item.item_id}">
    </a>`).join('')}</div>`;
}

interface CandRelease {
  title?: string | null; label?: string | null; catno?: string | null;
  year?: string | number | null; format?: string | null; thumb?: string | null;
}

/**
 * How one field of the reading stands against one candidate.
 *
 * FIVE STATES, and the two extra ones are the point. "Agrees" and
 * "does not agree" is a lie twice over:
 *
 *  - `unread` — the field was never read off the disc. 267 of the
 *    queued rows have no label at all, and showing that as a
 *    disagreement blames the candidate for the reading's silence.
 *  - `unknown` — the field was read, and DISCOGS did not return one to
 *    compare it against. That is not a mismatch either; it is a gap on
 *    the other side, and a reviewer who cannot tell the two apart
 *    learns to ignore the red mark entirely.
 */
type Verdict = 'agrees' | 'differs' | 'partly' | 'unknown' | 'unread';

const VERDICT_MARK: Record<Verdict, string> = {
  agrees: '✓', differs: '✗', partly: '~', unknown: '?', unread: '–',
};

interface Comparison { field: string; verdict: Verdict; detail: string }

/**
 * Build the comparison from what the scorer already recorded.
 *
 * No new data and no second guess at the matching: `families` is the
 * scorer's own statement of which kinds of evidence agreed, and
 * `signals` says how. Re-deriving agreement here would let the screen
 * and the gate disagree about the same candidate, which is worse than
 * showing less.
 *
 * The candidate's own value is shown only in the DETAIL, never used to
 * decide the verdict — so a disagreement always says both sides, which
 * is what makes it arguable. A `✗ label` beside a release plainly
 * labelled the same thing is then visibly a scorer bug rather than a
 * mystery.
 */
function compare(
  item: QueueItem,
  families: string[],
  signals: Record<string, string>,
  release: CandRelease | undefined,
): Comparison[] {
  const has = (v: unknown): boolean => Boolean(v && String(v).trim());

  const row = (
    field: string, read: string | null, family: string,
    theirs: unknown, partial = false,
  ): Comparison => {
    if (!has(read)) return { field, verdict: 'unread', detail: 'not read off the disc' };
    const mine = String(read).trim();
    if (families.includes(family)) return { field, verdict: 'agrees', detail: signals[family] ?? `both say ${mine}` };
    if (partial) return { field, verdict: 'partly', detail: signals[family] ?? '' };
    if (!has(theirs)) {
      return { field, verdict: 'unknown', detail: `you read “${mine}” — Discogs returned none to compare` };
    }
    return { field, verdict: 'differs', detail: `you read “${mine}” — this one says “${String(theirs).trim()}”` };
  };

  return [
    // A partial catalogue hit is its own state: `MFP 2014` matching
    // `MFP 20140` is how a containment hit looks, and it may support a
    // match while never carrying one.
    row('catalogue', item.catno_raw, 'identifier', release?.catno,
      Boolean(signals.identifier?.startsWith('partial'))),
    row('label', item.label_raw, 'label', release?.label),
    // Discogs puts performers in the release TITLE — "Artist - Work" —
    // so that is what a captured name is checked against, and the
    // detail says so rather than implying a field that does not exist.
    row('name', item.name_raw, 'people', release?.title),
    row('title', item.title_raw, 'title', release?.title),
  ];
}

function renderCandidate(c: Candidate, i: number): string {
  const { families = [], signals = {}, release } = parse<{
    families?: string[]; signals?: Record<string, string>; release?: CandRelease;
  }>(c.signals_json, {});

  const named = [release?.catno, release?.label].filter(Boolean).join(' · ');
  const heading = release?.title
    ? esc(String(release.title))
    : `Discogs release ${c.discogs_id}`;
  const sub = [named, release?.year, release?.format].filter(Boolean).map(String).map(esc).join(' · ');

  const cmp = compare(queue[cursor]!, families, signals, release);

  /**
   * The sleeve.
   *
   * `referrerpolicy="no-referrer"` because Discogs' CDN is entitled to
   * refuse a hotlink it can attribute, and a missing referrer is the
   * cheapest way to not find out the hard way. A candidate stored
   * before REVIEW-CARD existed has no thumbnail at all — there are 296
   * of those — so the absence is drawn deliberately rather than left as
   * a broken image.
   */
  const art = release?.thumb
    ? `<img class="sleeve" src="${esc(release.thumb)}" alt="" loading="eager"
         referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(
           document.createElement('span'), { className: 'sleeve none', title: 'no sleeve image' }))">`
    : '<span class="sleeve none" title="no sleeve image — this match ran before they were stored"></span>';

  // A format signal that is NEGATIVE is evidence against and gets said
  // out loud: a CD or a 7" for a record captured off a vinyl shelf is
  // the single most useful reason to refuse a high-scoring candidate.
  const notVinyl = signals.formatKind?.startsWith('not vinyl');

  return `
    <div class="cand${i === 0 ? ' best' : ''}">
      <button class="pick" data-discogs-id="${c.discogs_id}"
              title="Accept this match (or press ${i + 1})">
        <span class="key">${i + 1}</span>
        ${art}
        <span class="body">
          <span class="title">${heading}</span>
          ${sub ? `<span class="rel">${sub}</span>` : ''}
          <span class="cmp">
            ${cmp.map((x) => `<span class="c c-${x.verdict}" title="${esc(x.detail)}"
              ><b>${VERDICT_MARK[x.verdict]}</b>${esc(x.field)}</span>`).join('')}
            ${notVinyl ? `<span class="c c-differs" title="${esc(signals.formatKind ?? '')}"><b>✗</b>not vinyl</span>` : ''}
          </span>
        </span>
        <span class="score">${c.score}<small>score</small></span>
      </button>
      <a class="peek" href="https://www.discogs.com/release/${c.discogs_id}"
         target="_blank" rel="noopener noreferrer"
         title="Open release ${c.discogs_id} on Discogs — does not accept it">
        <span class="peekicon" aria-hidden="true">↗</span>
        <span class="peeklabel">Discogs</span>
      </a>
    </div>`;
}

function renderWhoAmI(): void {
  // No sign-in, so there is no identity to read. A confirmation must
  // still say who made it, so the reviewer names themselves once — and
  // the roster refuses a name that is not one of ours, which is the
  // same crude gate the capture screen puts on the phone.
  app.innerHTML = `
    ${headerHtml({ here: 'review', title: 'Resolve entries' })}
    <section class="readoff">
      <h2 class="subhead">Who is reviewing?</h2>
      <p class="note">A confirmation records who made it. There is no sign-in, so type
        your first name once.</p>
      <label class="field"><span>Name</span><input id="who" autocomplete="off" autofocus></label>
      <p class="note-bad" id="whoErr" hidden>Not a name this app knows.</p>
      <button class="btn btn-primary" id="start" type="button">Start</button>
    </section>`;
  const input = document.getElementById('who') as HTMLInputElement;
  const err = document.getElementById('whoErr')!;
  const go = (): void => {
    const named = resolveCapturer(input.value);
    // Refuse without listing the answers: printing the roster would
    // hand over the only thing this asks the typist to know.
    if (!named) { err.hidden = false; input.select(); return; }
    rememberCapturer(named);
    render();
  };
  document.getElementById('start')!.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
}

function renderDone(): void {
  app.innerHTML = `
    ${headerHtml({ here: 'review', title: 'Resolve entries' })}
    <div class="done">
      <strong>Queue clear</strong>
      ${resolvedCount} resolved this session. Re-verification is a normal operation —
      skipped items come back with <code>?include=skipped</code>.
    </div>`;
}

/**
 * Record a decision and move on.
 *
 * The run id is captured BEFORE the await and the cursor advances
 * immediately. Reading `queue[cursor]` after awaiting was a real bug:
 * a second keypress during the in-flight request resolved the SAME
 * item twice — and because the write upserts on run id, the second
 * answer silently overwrote the first while the next item was skipped
 * entirely. Someone clearing hundreds of items types ahead, so this is
 * the normal case, not an edge one.
 *
 * Advancing optimistically keeps type-ahead responsive; a failure puts
 * the item back rather than losing it.
 */
async function resolve(body: Record<string, unknown>): Promise<void> {
  const item = queue[cursor];
  if (!item) return;
  const at = cursor;

  cursor++;
  resolvedCount++;
  render();

  let res: Response;
  try {
    res = await fetch(`${API}/review/${item.run_id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, decidedBy: who.value }),
    });
  } catch {
    return rollback(at, 'no connection');
  }
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error: string };
    return rollback(at, error);
  }
}

/** Put an item back where it was, so a failed write never loses one. */
function rollback(at: number, why: string): void {
  resolvedCount--;
  cursor = Math.min(cursor, at);
  render();
  toast(`Could not record that decision (${why}). The item is still in the queue.`, 'err');
}

const choose = (discogsId: number): Promise<void> => resolve({ choice: 'candidate', discogsId });

function submitManual(raw: string): void {
  // Accepts a full Discogs URL or a bare id. Recording an id a person
  // looked up is a human judgement, not an upstream call: nothing here
  // touches Discogs, so the no-caller-controlled-query rule holds.
  const id = Number((/(\d{3,})/.exec(raw) ?? [])[1]);
  if (!Number.isInteger(id) || id <= 0) { toast('That does not contain a Discogs release id.', 'err'); return; }
  void resolve({ choice: 'manual', discogsId: id });
}

addEventListener('keydown', (e) => {
  if (!queue[cursor] || !who.value) return;
  // Shared with every other screen: a key pressed inside a text field
  // is text. Typing a Discogs id used to fire four shortcuts.
  if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();

  if (key >= '1' && key <= '5') {
    const candidate = queue[cursor]?.candidates[Number(key) - 1];
    if (candidate) { e.preventDefault(); void choose(candidate.discogs_id); }
    return;
  }
  if (key === 'n') { e.preventDefault(); void resolve({ choice: 'none' }); }
  if (key === 's') { e.preventDefault(); void resolve({ choice: 'skip' }); }
  if (key === 'b') { e.preventDefault(); cursor = Math.max(0, cursor - 1); render(); }
  if (key === 'm') { e.preventDefault(); (document.getElementById('manual') as HTMLInputElement | null)?.focus(); }
});

ensureCapturerCookie();
bootChrome(SCREEN_KEYS);
void load();
