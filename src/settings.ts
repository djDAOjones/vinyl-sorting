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
