/**
 * Settings (APP-SETTINGS).
 *
 * THREE TIERS, AND THE LINE BETWEEN THEM IS THE WHOLE DESIGN. This
 * page sits on a URL with no sign-in, so what it is allowed to do is
 * decided by what happens if a stranger opens it.
 *
 *  - DEVICE — this file. Name, theme, density. Stored in
 *    `localStorage`, never sent anywhere, and a claim about a phone
 *    rather than about the collection. No gate, because there is
 *    nothing to gate.
 *  - COLLECTION — behind the shared passphrase, stored in KV.
 *  - EXPORT — behind the passphrase. Read-only, so it cannot break
 *    anything.
 *
 * What is deliberately NOT here, and will not be: entering a Discogs
 * token (it would have to be stored where one shared word can read it,
 * when `wrangler secret` already works), resetting the database (a
 * destructive operation, and a stop-and-ask boundary in AGENTS.md), and
 * editing the roster (`src/who.ts` is shared by the client and the
 * Worker precisely so the gate and the sign-in cannot disagree). All
 * three are wanted; all three want a sign-in first, which is
 * OPEN-V1-AUTH.
 */

import {
  bootChrome, esc, headerHtml, openKeyCard, ROUTES,
  setDensity, setTheme, storedDensity, storedTheme, toast, type Theme,
} from './chrome.ts';
import { forgetCapturer, rememberCapturer, resolveCapturer, storedCapturer } from './who.ts';

const API = '/api';

interface Collection {
  reverify: boolean;
  reverifyMinDays: number;
  reverifyMaxPerDay: number;
}

let collection: Collection | null = null;

/**
 * The shared passphrase, held beside `dg.who` on this device — the SAME
 * key the browse screen uses, so unlocking editing once unlocks it
 * everywhere. Not sign-in and it does not pretend to be.
 */
const editToken = {
  get(): string { try { return localStorage.getItem('dg.edit') ?? ''; } catch { return ''; } },
  set(v: string): void { try { localStorage.setItem('dg.edit', v); } catch { /* asked again */ } },
  clear(): void { try { localStorage.removeItem('dg.edit'); } catch { /* nothing held */ } },
};

const app = document.getElementById('settings')!;

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'system', label: 'Match the device', hint: 'Follows light and dark as the phone does' },
  { value: 'light', label: 'Light', hint: 'Warm paper, for a desk' },
  { value: 'dark', label: 'Dark', hint: 'The default' },
];

function render(): void {
  const who = storedCapturer();
  const theme = storedTheme();
  const density = storedDensity();

  app.innerHTML = `
    ${headerHtml({ here: 'settings', title: 'Settings' })}

    <section class="card">
      <h2 class="subhead">This device</h2>
      <p class="note">Stored on this phone or computer only. Nothing here is sent anywhere,
        and nothing here is a claim about a record.</p>

      <div class="toggle">
        <span class="txt">
          <strong>Your name</strong>
          <span>Goes on every record you photograph and every match you confirm.</span>
        </span>
        ${who
    ? `<button type="button" class="btn btn-ghost" id="clearWho">${esc(who)} — change</button>`
    : `<button type="button" class="btn btn-primary" id="setWho">Set a name</button>`}
      </div>

      <div class="toggle">
        <span class="txt">
          <strong>Density</strong>
          <span>Tighter rows on the collection and review screens. Capture is never dense.</span>
        </span>
        <button type="button" class="btn btn-ghost" id="density">
          ${density === 'dense' ? 'Dense' : 'Comfortable'}</button>
      </div>

      <div class="toggle">
        <span class="txt">
          <strong>Keyboard</strong>
          <span>Press <kbd>?</kbd> anywhere to see every shortcut.</span>
        </span>
        <button type="button" class="btn btn-ghost" id="keys">Show them</button>
      </div>
    </section>

    <section class="card">
      <h2 class="subhead">Appearance</h2>
      <div class="themes">
        ${THEMES.map((t) => `
          <button type="button" class="themeopt${t.value === theme ? ' on' : ''}" data-theme="${t.value}">
            <span class="swatch sw-${t.value}"></span>
            <span class="tl">${esc(t.label)}</span>
            <span class="th">${esc(t.hint)}</span>
          </button>`).join('')}
      </div>
      <p class="note">The capture screen stays dark whatever this says — dim light and gloves
        are what it is built around, not a preference.</p>
    </section>

    <section class="card">
      <h2 class="subhead">Matching</h2>
      ${collection ? `
        <div class="toggle">
          <span class="txt">
            <strong>Re-verify the oldest rows</strong>
            <span>When nothing is waiting to be matched for the first time, look again at
              rows nothing has checked for a while. Off by default — every row it cannot
              settle lands in the review queue, which is your evening.</span>
          </span>
          <button type="button" class="btn ${collection.reverify ? 'btn-primary' : 'btn-ghost'}"
            id="reverify">${collection.reverify ? 'On' : 'Off'}</button>
        </div>
        <div class="toggle">
          <span class="txt">
            <strong>Leave a row alone for</strong>
            <span>A row is only re-verifiable once its last match is this old.</span>
          </span>
          <label class="field" style="margin:0;max-width:7rem">
            <input id="minDays" type="number" min="1" max="3650" inputmode="numeric"
              value="${collection.reverifyMinDays}"></label>
        </div>
        <div class="toggle">
          <span class="txt">
            <strong>At most, per day</strong>
            <span>The ceiling on how many the sweep may re-queue, so it cannot refill the
              review queue faster than it can be cleared.</span>
          </span>
          <label class="field" style="margin:0;max-width:7rem">
            <input id="maxPerDay" type="number" min="0" max="500" inputmode="numeric"
              value="${collection.reverifyMaxPerDay}"></label>
        </div>
        <p class="note">Changing these needs the shared passphrase — they change what
          everyone sees, not just this device.</p>
      ` : '<p class="note">Could not reach the server. These settings live with the collection, not on this device.</p>'}
    </section>

    <section class="card">
      <h2 class="subhead">A copy of everything</h2>
      <p class="note">Read-only, so it cannot break anything. The JSON is the structured
        dump that could be restored; the CSV is one row per record, for a spreadsheet.</p>
      <div class="exports">
        <button type="button" class="btn btn-ghost" data-export="json">Download JSON</button>
        <button type="button" class="btn btn-ghost" data-export="csv">Download CSV</button>
      </div>
    </section>

    <section class="card">
      <h2 class="subhead">Not on this page</h2>
      <p class="note">Three things were asked for and live at the command line instead, because
        this URL has no sign-in and one shared passphrase is the only thing between it and
        anyone who finds it.</p>
      <dl class="facts">
        <dt>API tokens</dt>
        <dd>A Discogs token typed here would have to be stored where the Worker can read it.
          <code class="mono">wrangler secret put</code> is strictly better and already works.</dd>
        <dt>Resetting</dt>
        <dd>Destructive, and a stop-and-ask boundary. It will exist as a tool that takes a
          snapshot first, not as a button anyone can reach by mistyping a URL.</dd>
        <dt>Who may capture</dt>
        <dd>The roster is shared by the app and the Worker so the two cannot disagree about
          who exists. Adding a person is a code change.</dd>
      </dl>
    </section>

    <div class="homefoot">
      <a class="link" href="${ROUTES.home}">← Home</a>
    </div>
    <div id="toast"></div>`;

  document.getElementById('keys')?.addEventListener('click', () => openKeyCard());

  document.getElementById('density')?.addEventListener('click', () => {
    setDensity(storedDensity() === 'dense' ? 'comfortable' : 'dense');
    render();
  });

  for (const btn of app.querySelectorAll<HTMLButtonElement>('.themeopt')) {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.theme as Theme);
      render();
    });
  }

  document.getElementById('clearWho')?.addEventListener('click', () => {
    // The offline queue is deliberately untouched: whatever this phone
    // is holding still belongs to whoever photographed it.
    forgetCapturer();
    render();
    toast('Name cleared. The next screen will ask.');
  });

  document.getElementById('setWho')?.addEventListener('click', askName);

  document.getElementById('reverify')?.addEventListener('click', () => {
    void saveCollection({ reverify: !collection?.reverify });
  });
  for (const id of ['minDays', 'maxPerDay'] as const) {
    const box = document.getElementById(id) as HTMLInputElement | null;
    // `change`, not `input`: a passphrase-guarded write per keystroke
    // would fire four times typing "180" and three of them would be
    // storing a number nobody meant.
    box?.addEventListener('change', () => {
      void saveCollection(id === 'minDays'
        ? { reverifyMinDays: Number(box.value) }
        : { reverifyMaxPerDay: Number(box.value) });
    });
  }
  for (const btn of app.querySelectorAll<HTMLButtonElement>('button[data-export]')) {
    btn.addEventListener('click', () => { void download(btn.dataset.export === 'csv' ? 'csv' : 'json'); });
  }
}

/** Ask for the passphrase once, and keep it the way browse does. */
function askToken(): string {
  const held = editToken.get();
  if (held) return held;
  const typed = prompt('The shared passphrase');
  if (!typed) return '';
  editToken.set(typed);
  return typed;
}

async function saveCollection(patch: Partial<Collection>): Promise<void> {
  const token = askToken();
  if (!token) { toast('That needs the shared passphrase.', 'err'); return; }
  const res = await fetch(`${API}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-edit-token': token },
    body: JSON.stringify(patch),
  });
  if (res.status === 401) {
    // A refused passphrase is FORGOTTEN rather than retried: a secret
    // changed on the Worker must stop being sent, or every write for
    // the rest of the session fails the same way and silently.
    editToken.clear();
    toast('That passphrase was refused.', 'err');
    return;
  }
  if (!res.ok) { toast(`Refused: HTTP ${res.status}`, 'err'); return; }
  collection = await res.json() as Collection;
  render();
  toast('Saved for everyone.');
}

/**
 * Fetch the export and hand it to the browser as a file.
 *
 * A PLAIN LINK CANNOT DO THIS. The route is behind `x-edit-token` and
 * an `<a download>` sends no headers — the same shape of bug that made
 * every label photograph 401 when its gate was header-only. So the
 * bytes are fetched, turned into a blob, and clicked programmatically.
 */
async function download(format: 'json' | 'csv'): Promise<void> {
  const token = askToken();
  if (!token) { toast('That needs the shared passphrase.', 'err'); return; }
  toast(`Preparing the ${format.toUpperCase()}…`);
  const res = await fetch(`${API}/export?format=${format}`, { headers: { 'x-edit-token': token } });
  if (res.status === 401) { editToken.clear(); toast('That passphrase was refused.', 'err'); return; }
  if (!res.ok) { toast(`Export refused: HTTP ${res.status}`, 'err'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vinyl-sorter-${new Date().toISOString().slice(0, 10)}.${format}`;
  a.click();
  // Revoked on the next turn of the loop rather than immediately:
  // Safari has not necessarily started reading the blob when `click`
  // returns, and a revoked URL downloads nothing at all.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast(`${format.toUpperCase()} downloaded.`);
}

/** The collection half, after the device half is already on screen. */
async function loadCollection(): Promise<void> {
  try {
    const res = await fetch(`${API}/settings`);
    if (res.ok) { collection = await res.json() as Collection; render(); }
  } catch { /* the device settings work without a server */ }
}

/**
 * The name, asked for the same way and checked against the same roster
 * as everywhere else.
 *
 * It refuses without listing the answers — printing the six would hand
 * over the only thing this asks a typist to know. That is a speed bump
 * rather than a lock, and `who.ts` says so at length.
 */
function askName(): void {
  const typed = prompt('Your first name');
  if (typed === null) return;
  const named = resolveCapturer(typed);
  if (!named) { toast('Not a name this app knows. Ask whoever set the phone up.', 'err'); return; }
  rememberCapturer(named);
  render();
  toast(`Hello, ${named}.`);
}

bootChrome();
render();
void loadCollection();
