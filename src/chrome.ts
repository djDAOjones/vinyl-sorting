/**
 * The chrome every screen wears: the header, the theme, the toast, and
 * the keyboard scheme (DESIGN-SYSTEM, APP-HOME-HUB, APP-KEYS).
 *
 * It exists because five screens now need the same four things, and
 * the three that already existed had each grown their own version —
 * two `esc` helpers, two toast implementations, and shortcuts on
 * exactly one screen.
 */

import { choiceLabel, isList, isListChoice, LISTS, type ListChoice } from './lists.ts';

/**
 * Where the screens are, named once.
 *
 * `.html` rather than the extensionless paths Cloudflare also serves:
 * Vite's dev server does not serve those, so a link written the short
 * way only works in production, which is where it gets found broken.
 */
export const ROUTES = {
  home: '/index.html',
  capture: '/capture.html',
  review: '/review.html',
  browse: '/browse.html',
  settings: '/settings.html',
} as const;

export type RouteKey = keyof typeof ROUTES;

export const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const parseJson = <T,>(json: string | null | undefined, fallback: T): T => {
  try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; }
};

/* ── Theme ────────────────────────────────────────────────────────
 *
 * Dark is the base and light is a class on <html>, so a device where
 * this never runs gets the palette the loft needs rather than a white
 * page held over a crate. See the head of `tokens.css`.
 *
 * `resolveTheme` is duplicated as an inline script in each page's
 * <head> — deliberately, and it is the ONE duplication in this file.
 * Waiting for a module to load before choosing a background paints the
 * wrong theme first and then corrects it, which is a flash on every
 * navigation. The copy is three lines and cannot drift far; this is
 * the authority for what those three lines mean.
 */
export type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'vs.theme';
const DENSITY_KEY = 'vs.density';

const read = (key: string): string => {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};
const write = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* the default applies next launch */ }
};

export const storedTheme = (): Theme => {
  const v = read(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
};

/**
 * Whether the light palette applies right now.
 *
 * Capture opts out entirely: `data-force-dark` on <html> pins it dark
 * whatever the preference says, because the constraint there is dim
 * light and gloves rather than taste (DESIGN-SYSTEM).
 */
export function lightApplies(theme: Theme = storedTheme()): boolean {
  if (document.documentElement.hasAttribute('data-force-dark')) return false;
  if (theme === 'light') return true;
  if (theme === 'dark') return false;
  return matchMedia('(prefers-color-scheme: light)').matches;
}

export function applyTheme(theme: Theme = storedTheme()): void {
  document.documentElement.classList.toggle('light', lightApplies(theme));
}

export function setTheme(theme: Theme): void {
  write(THEME_KEY, theme);
  applyTheme(theme);
}

export const storedDensity = (): 'comfortable' | 'dense' =>
  (read(DENSITY_KEY) === 'dense' ? 'dense' : 'comfortable');

export function setDensity(d: 'comfortable' | 'dense'): void {
  write(DENSITY_KEY, d);
  applyDensity();
}

export function applyDensity(): void {
  document.documentElement.classList.toggle('dense', storedDensity() === 'dense');
}

/** Follow the system while the preference is "system", not just at load. */
export function watchSystemTheme(): void {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (storedTheme() === 'system') applyTheme();
  });
}

/* ── The list in view (FOUR-LISTS) ────────────────────────────────
 *
 * Four lists — classical, selling, dance, general — and one selector
 * on every screen saying which of them is being looked at. It is a
 * DEVICE setting, like the theme and the name: two people can walk two
 * crates at once, and a phone in the dance crate must not change what
 * the desk is reviewing. Stored beside the theme. '' means all of
 * them; `unsorted` means the rows that are on none yet.
 *
 * Capture is the screen where it matters most — a crate filed on the
 * wrong list is twenty rows to move by hand — so it is in the header
 * there too, and `main.ts` refuses to file a disc while the choice is
 * not one of the four.
 */
const LIST_KEY = 'vs.list';

export const storedList = (): ListChoice => {
  const v = read(LIST_KEY);
  return isListChoice(v) ? v : '';
};

/**
 * Change the list in view and tell the screen.
 *
 * An event rather than a callback, because the screens rebuild
 * themselves from strings and the selector goes with them: whoever is
 * listening on `window` survives the rebuild.
 */
export function setList(choice: ListChoice): void {
  write(LIST_KEY, choice);
  dispatchEvent(new CustomEvent('vs:list', { detail: choice }));
}

export interface ListPickOptions {
  /** Only the four lists: capture cannot file a disc on "all". */
  concrete?: boolean;
  /** Per-choice counts, where the screen has them. */
  counts?: Partial<Record<ListChoice, number>>;
}

/**
 * The selector, as a string, for the same reason the header is one.
 *
 * A native <select>: it opens the platform's own picker, which is the
 * one control a gloved thumb in a loft can work, and it is what "a
 * drop-down" means to the person who asked for one.
 *
 * `unsorted` is offered only while it is true of something — a count
 * of zero hides it, and a screen with no counts shows it, since it
 * cannot know. It is never offered where a disc is being filed.
 */
export function listPickHtml(opts: ListPickOptions = {}): string {
  const current = storedList();
  const choices: ListChoice[] = opts.concrete ? [...LISTS] : ['', ...LISTS, 'unsorted'];
  const shown = choices.filter((c) => c !== 'unsorted' || current === 'unsorted'
    || opts.counts?.unsorted === undefined || opts.counts.unsorted > 0);
  // A concrete picker with nothing chosen yet shows a blank line, so
  // the first list is not silently selected by being first.
  const blank = opts.concrete && !isList(current)
    ? '<option value="" selected disabled>Choose a list…</option>' : '';
  return `<label class="listpick"><span class="lp-label">List</span>
    <select aria-label="Which list to look at">${blank}${shown.map((c) => {
    const n = opts.counts?.[c];
    const label = choiceLabel(c) + (n === undefined ? '' : ` · ${n.toLocaleString('en-GB')}`);
    return `<option value="${c}"${c === current ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}</select></label>`;
}

/**
 * One handler for every selector, bound once by delegation: the
 * screens rebuild their headers from strings, so a listener on the
 * element itself would be lost at the next render.
 */
function installListPick(): void {
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement) || !el.closest('.listpick')) return;
    if (isListChoice(el.value)) setList(el.value);
  });
}

/* ── The mark ─────────────────────────────────────────────────────
 * A record: one groove, one label, off-centre so it reads as a disc
 * rather than a target. Inline so it inherits `currentColor` and
 * costs no request.
 */
export const MARK = `<svg class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.2" opacity=".55"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
</svg>`;

export interface HeaderOptions {
  /** Which screen this is — so it does not link to itself. */
  here: RouteKey;
  title: string;
  /** Right-hand side: counts, controls. Trusted HTML from the caller. */
  aside?: string;
  /** The list selector (FOUR-LISTS): on by default; `false` hides it. */
  list?: ListPickOptions | false;
}

/**
 * The header, as a string, so a screen that rebuilds itself from
 * innerHTML can include it without a second render path.
 */
export function headerHtml(opts: HeaderOptions): string {
  const home = opts.here === 'home'
    ? `<span class="home">${MARK}<span>Vinyl sorter</span></span>`
    : `<a class="home" href="${ROUTES.home}" title="Home — press g then h">${MARK}<span>Home</span></a>`;
  const pick = opts.list === false ? '' : listPickHtml(opts.list ?? {});
  return `<div class="appbar">
    ${home}
    <h1>${esc(opts.title)}</h1>
    <div class="spacer"></div>
    ${pick}
    ${opts.aside ?? ''}
  </div>`;
}

/* ── Toast ───────────────────────────────────────────────────────── */

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A message, above everything, for a couple of seconds.
 *
 * Creates its own host if the page has none, so a screen cannot fail
 * to show a message because it forgot a div — which is how "queued —
 * 14s" ended up below the fold once.
 */
export function toast(message: string, kind: 'ok' | 'err' = 'ok', extraHtml = ''): void {
  let host = document.getElementById('toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast';
    document.body.appendChild(host);
  }
  host.innerHTML = `<p class="toast${kind === 'err' ? ' err' : ''}">${esc(message)}${extraHtml}</p>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, kind === 'ok' ? 2600 : 5200);
}

/* ── Keyboard ─────────────────────────────────────────────────────
 *
 * THE RULE THAT KEEPS THIS SAFE: a key pressed inside a text field is
 * text. The review queue already had to learn this — typing a Discogs
 * id fired four shortcuts — and it is exactly the kind of thing each
 * screen would otherwise re-learn by breaking.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** The go-to keys, `g` then a letter. Shown on the card, bound here. */
const GO: Record<string, RouteKey> = {
  h: 'home', a: 'capture', r: 'review', c: 'browse', s: 'settings',
};

export interface KeyHelp { keys: string; what: string }

/**
 * Bind the global scheme, and register this screen's own keys for the
 * card.
 *
 * `g` is a PREFIX rather than a modifier because every single-letter
 * global steals that letter from a screen that might want it — and the
 * review queue, the screen with the most keys, wants nearly all of
 * them.
 */
export function installKeys(screenKeys: KeyHelp[] = []): void {
  let goArmed = false;
  let goTimer: ReturnType<typeof setTimeout> | undefined;

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) {
      // Escape gets a person out of a field they did not mean to be
      // in. Nothing else fires while typing.
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const key = e.key.toLowerCase();

    if (goArmed) {
      goArmed = false;
      clearTimeout(goTimer);
      const dest = GO[key];
      if (dest) { e.preventDefault(); location.href = ROUTES[dest]; }
      return;
    }
    if (key === 'g') {
      goArmed = true;
      // Times out, so a `g` typed by accident does not silently swallow
      // the next keystroke a minute later.
      goTimer = setTimeout(() => { goArmed = false; }, 1400);
      return;
    }
    if (key === '?' || (key === '/' && e.shiftKey)) { e.preventDefault(); openKeyCard(screenKeys); return; }
    if (key === '/') {
      const box = document.querySelector<HTMLInputElement>('input[type="search"], input[data-search]');
      if (box) { e.preventDefault(); box.focus(); box.select(); }
      return;
    }
    if (key === 'l') {
      // The list selector, wherever the screen put it. Focusing is
      // enough: the arrow keys and Space take it from there.
      // A cast rather than the generic: with @cloudflare/workers-types
      // in scope, HTMLRewriter's Element merges into the DOM one and
      // HTMLSelectElement no longer satisfies it (its `remove` differs).
      const pick = document.querySelector('.listpick select') as HTMLSelectElement | null;
      if (pick) { e.preventDefault(); pick.focus(); }
      return;
    }
    if (key === 'escape') {
      const open = document.querySelector<HTMLDialogElement>('dialog[open]');
      if (open) { e.preventDefault(); open.close(); }
    }
  });
}

const GLOBAL_KEYS: KeyHelp[] = [
  { keys: 'g h', what: 'Home' },
  { keys: 'g a', what: 'Add vinyl' },
  { keys: 'g r', what: 'Resolve entries' },
  { keys: 'g c', what: 'The collection' },
  { keys: 'g s', what: 'Settings' },
  { keys: '/', what: 'Jump to the search box' },
  { keys: 'l', what: 'Change the list in view' },
  { keys: '?', what: 'This card' },
  { keys: 'Esc', what: 'Close what is open, or leave the field' },
];

const keyRows = (rows: KeyHelp[]): string => rows.map((r) => `
  <div class="keyrow">
    <span class="k">${r.keys.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span>
    <span class="d">${esc(r.what)}</span>
  </div>`).join('');

/**
 * The card, built from the same table that binds the keys — so a
 * shortcut cannot exist without being documented, which is how the
 * review queue's five stayed a secret for a month.
 */
export function openKeyCard(screenKeys: KeyHelp[] = []): void {
  let dlg = document.getElementById('keycard') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'keycard';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <div class="dlg-head"><h2>Keyboard</h2></div>
    <div class="dlg-body keycard">
      ${screenKeys.length ? `<div class="keygroup"><h3>This screen</h3>${keyRows(screenKeys)}</div>` : ''}
      <div class="keygroup"><h3>Anywhere</h3>${keyRows(GLOBAL_KEYS)}</div>
    </div>
    <div class="dlg-foot"><button class="btn btn-ghost" value="close">Close</button></div>`;
  dlg.querySelector('button')?.addEventListener('click', () => dlg?.close());
  dlg.showModal();
}

/**
 * One call at the top of every screen.
 *
 * Theme and density are applied again here even though the inline
 * script already did it: the inline copy handles the paint, this one
 * handles a preference changed on the settings screen in another tab.
 */
export function bootChrome(screenKeys: KeyHelp[] = []): void {
  applyTheme();
  applyDensity();
  watchSystemTheme();
  installKeys(screenKeys);
  installListPick();
}
