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
  candidates: Candidate[];
}

let queue: QueueItem[] = [];
let cursor = 0;
let resolvedCount = 0;

const who = {
  get value() { return localStorage.getItem('dg.who') ?? ''; },
  set value(v: string) { localStorage.setItem('dg.who', v); },
};

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const parse = <T,>(json: string | null, fallback: T): T => {
  try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; }
};

async function load(): Promise<void> {
  const res = await fetch(`${API}/review-queue?limit=200`);
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
    <div class="qhead">
      <h1>Review queue</h1>
      <div class="progress"><b>${cursor + 1}</b> of ${queue.length} · ${resolvedCount} resolved · item ${item.item_id}</div>
    </div>

    ${refusal ? `<p class="why-refused"><strong>Not auto-accepted:</strong> ${esc(refusal)}</p>` : ''}

    <div class="split">
      <section class="capture">
        <h2>What was read off the disc</h2>
        <dl>
          ${field('Catalogue', item.catno_raw)}
          ${field('Label', item.label_raw)}
          ${field('Title', item.title_raw)}
          ${field('Name', item.name_raw)}
          ${field('Crate', [item.crate, item.position].filter(Boolean).join(' · '))}
        </dl>
      </section>

      <section>
        <div class="cands">
          ${item.candidates.length
            ? item.candidates.map(renderCandidate).join('')
            : '<p class="why-refused">No candidate scored above zero. Enter a Discogs ID, or record “none of these”.</p>'}
        </div>
        <div class="manual">
          <input id="manual" placeholder="Paste a Discogs release URL or ID, then Enter"
            inputmode="numeric" autocomplete="off">
        </div>
      </section>
    </div>

    <div class="keys"><div class="inner">
      <span><kbd>1</kbd>–<kbd>5</kbd> choose</span>
      <span><kbd>N</kbd> none of these</span>
      <span><kbd>S</kbd> skip</span>
      <span><kbd>B</kbd> back</span>
      <span><kbd>M</kbd> manual ID</span>
      <span style="margin-left:auto">reviewing as <strong>${esc(who.value)}</strong></span>
    </div></div>`;

  for (const button of app.querySelectorAll<HTMLButtonElement>('.cand')) {
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

function renderCandidate(c: Candidate, i: number): string {
  const { families = [], signals = {} } = parse<{ families?: string[]; signals?: Record<string, string> }>(
    c.signals_json, {});
  return `
    <button class="cand${i === 0 ? ' top' : ''}" data-discogs-id="${c.discogs_id}">
      <span class="key">${i + 1}</span>
      <span>
        <span class="title">Discogs release ${c.discogs_id}</span>
        <span class="why">
          ${families.map((f) => `<span class="fam">${esc(f)}</span>`).join('')}
          ${Object.entries(signals).map(([k, v]) => `<span class="sig">${esc(k)}: ${esc(v)}</span>`).join(' ')}
        </span>
      </span>
      <span class="score">${c.score}<small>score</small></span>
    </button>`;
}

function renderWhoAmI(): void {
  // No sign-in, so there is no identity to read. A confirmation must
  // still say who made it, so the reviewer names themselves once.
  app.innerHTML = `
    <div class="qhead"><h1>Review queue</h1></div>
    <section class="capture">
      <h2>Who is reviewing?</h2>
      <p class="note">A confirmation records who made it. There is no sign-in, so type a name once.</p>
      <label><span>Name</span><input id="who" autocomplete="off" autofocus></label>
      <button class="primary" id="start" type="button">Start</button>
    </section>`;
  const input = document.getElementById('who') as HTMLInputElement;
  const go = (): void => { if (input.value.trim()) { who.value = input.value.trim(); render(); } };
  document.getElementById('start')!.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
}

function renderDone(): void {
  app.innerHTML = `
    <div class="qhead"><h1>Review queue</h1></div>
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
  alert(`Could not record that decision (${why}). The item is still in the queue.`);
}

const choose = (discogsId: number): Promise<void> => resolve({ choice: 'candidate', discogsId });

function submitManual(raw: string): void {
  // Accepts a full Discogs URL or a bare id. Recording an id a person
  // looked up is a human judgement, not an upstream call: nothing here
  // touches Discogs, so the no-caller-controlled-query rule holds.
  const id = Number((/(\d{3,})/.exec(raw) ?? [])[1]);
  if (!Number.isInteger(id) || id <= 0) { alert('That does not contain a Discogs release id.'); return; }
  void resolve({ choice: 'manual', discogsId: id });
}

addEventListener('keydown', (e) => {
  if (!queue[cursor] || !who.value) return;
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

void load();
