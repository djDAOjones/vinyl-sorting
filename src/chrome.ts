/**
 * The chrome every screen wears: the header, the theme, the toast, and
 * the keyboard scheme (DESIGN-SYSTEM, APP-HOME-HUB, APP-KEYS).
 *
 * It exists because five screens now need the same four things, and
 * the three that already existed had each grown their own version —
 * two `esc` helpers, two toast implementations, and shortcuts on
 * exactly one screen.
 */

import { installPhotoViewer } from './photo-viewer.ts';
import {
  BUILT_IN, choiceLabelFor, isListKey, labelFor, type ListChoice, type ListDef,
} from './lists.ts';

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

/* ── The list in view (FOUR-LISTS, NEILS-LIST) ───────────────────
 *
 * Lists — classical, selling, dance, general, and whatever the
 * household adds — and one selector on every screen saying which of
 * them is being looked at. It is a DEVICE setting, like the theme and
 * the name: two people can walk two crates at once, and a phone in the
 * dance crate must not change what the desk is reviewing. Stored
 * beside the theme. '' means all of them; `unsorted` means the rows
 * that are on none yet.
 *
 * The lists themselves are data on the Worker (`/api/lists`). This
 * device keeps the set it last saw, and the built-in set until it has
 * seen any, because a phone in a loft with no signal still has to file
 * a disc on a list.
 *
 * Capture is the screen where it matters most — a crate filed on the
 * wrong list is twenty rows to move by hand — so it is in the header
 * there too, and `main.ts` refuses to file a disc while the choice is
 * not a list.
 */
const LIST_KEY = 'vs.list';
const LISTS_KEY = 'vs.lists';

const isDef = (v: unknown): v is ListDef => typeof v === 'object' && v !== null
  && isListKey((v as ListDef).key) && typeof (v as ListDef).label === 'string';

/** The lists this device knows: the set last fetched, else the built-in ones. */
export function knownLists(): ListDef[] {
  try {
    const parsed: unknown = JSON.parse(read(LISTS_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length && parsed.every(isDef)) return parsed;
  } catch { /* the built-in set applies */ }
  return [...BUILT_IN];
}

/** Keep a fetched set. True when it differs from what was known. */
export function rememberLists(lists: ListDef[]): boolean {
  const next = JSON.stringify(lists.map(({ key, label }) => ({ key, label })));
  if (next === JSON.stringify(knownLists())) return false;
  write(LISTS_KEY, next);
  return true;
}

/**
 * Ask the Worker for the lists in force, quietly.
 *
 * Every screen does this at boot. Failure is silent — offline is the
 * normal case this app was built for — and a changed set is announced
 * the same way a changed choice is, so a screen repaints its selector.
 */
export async function refreshLists(): Promise<void> {
  try {
    const res = await fetch('/api/lists');
    if (!res.ok) return;
    const body = await res.json() as { lists?: ListDef[] };
    if (Array.isArray(body.lists) && rememberLists(body.lists)) {
      dispatchEvent(new CustomEvent('vs:list', { detail: storedList() }));
    }
  } catch { /* offline, which is the normal case */ }
}

export const isKnownList = (v: unknown): v is string =>
  typeof v === 'string' && knownLists().some((l) => l.key === v);
export const isListChoice = (v: unknown): v is ListChoice =>
  v === '' || v === 'unsorted' || isKnownList(v);
export const labelOf = (key: string): string => labelFor(key, knownLists());
export const choiceLabel = (c: ListChoice): string => choiceLabelFor(c, knownLists());

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
  /** Only real lists: capture cannot file a disc on "all". */
  concrete?: boolean;
  /** Per-choice counts, where the screen has them. */
  counts?: Partial<Record<ListChoice, number>>;
}

/**
 * The selector, as a string, for the same reason the header is one.
 *
 * An instant listbox replaces the platform picker, whose opening and
 * closing animation cannot be disabled by page CSS. The hidden select
 * keeps the existing value/change contract shared by all screens.
 *
 * `unsorted` is offered only while it is true of something — a count
 * of zero hides it, and a screen with no counts shows it, since it
 * cannot know. It is never offered where a disc is being filed.
 */
let listPickSequence = 0;

export function listPickHtml(opts: ListPickOptions = {}): string {
  const current = storedList();
  const keys = knownLists().map((l) => l.key);
  const choices: ListChoice[] = opts.concrete ? keys : ['', ...keys, 'unsorted'];
  const shown = choices.filter((c) => c !== 'unsorted' || current === 'unsorted'
    || opts.counts?.unsorted === undefined || opts.counts.unsorted > 0);
  // A concrete picker with nothing chosen yet shows a blank line, so
  // the first list is not silently selected by being first.
  const blank = opts.concrete && !isKnownList(current)
    ? '<option value="" selected disabled>Choose a list…</option>' : '';
  const menuId = `list-menu-${++listPickSequence}`;
  const labelFor = (c: ListChoice): string => {
    const n = opts.counts?.[c];
    return choiceLabel(c) + (n === undefined ? '' : ` · ${n.toLocaleString('en-GB')}`);
  };
  return `<div class="listpick"><span class="lp-label">List</span>
    <select aria-label="Which list to look at" hidden tabindex="-1" aria-hidden="true">${blank}${shown.map((c) =>
    `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(labelFor(c))}</option>`
  ).join('')}</select>
    <button type="button" class="listpick-toggle" aria-label="Which list to look at: ${blank ? 'Choose a list' : esc(labelFor(current))}"
      aria-haspopup="listbox" aria-expanded="false" aria-controls="${menuId}">${blank ? 'Choose a list…' : esc(labelFor(current))}<span aria-hidden="true"> ▾</span></button>
    <div class="listpick-menu" id="${menuId}" role="listbox" aria-label="Lists" hidden>
      ${shown.map((c) => `<button type="button" role="option" tabindex="-1"
        aria-selected="${c === current}" data-list-choice="${esc(c)}">${esc(labelFor(c))}</button>`).join('')}
    </div></div>`;
}

/**
 * Keyboard focus across a repaint.
 *
 * THE FAULT THIS FIXES: the screens repaint themselves from strings
 * when the choice changes, and the selector goes with them — so a
 * keyboard user who arrowed to a new list landed on nothing, twice on
 * the hub, which repaints again when the counts arrive. Losing the
 * focus on every use is a failure of WCAG 2.4.3 in all but name. So
 * the change handler remembers, for a few seconds, that the selector
 * had the focus, and every repaint inside that window puts it back;
 * each screen calls this at the end of its render. A window rather
 * than a flag, so a repaint minutes later cannot steal the focus from
 * whatever the person moved on to.
 */
let listFocusUntil = 0;

export function restoreListFocus(): void {
  if (Date.now() > listFocusUntil) return;
  const pick = document.querySelector('.listpick-toggle') as HTMLButtonElement | null;
  const active: unknown = document.activeElement;
  if (pick && active !== pick) pick.focus({ preventScroll: true });
}

/**
 * One handler for every selector, bound once by delegation: the
 * screens rebuild their headers from strings, so a listener on the
 * element itself would be lost at the next render.
 */
function installListPick(): void {
  const close = (pick: HTMLElement, focus = false): void => {
    pick.querySelector<HTMLElement>('.listpick-menu')!.hidden = true;
    const toggle = pick.querySelector<HTMLButtonElement>('.listpick-toggle')!;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus({ preventScroll: true });
  };
  const show = (pick: HTMLElement, last = false): void => {
    for (const other of document.querySelectorAll<HTMLElement>('.listpick')) {
      if (other !== pick) close(other);
    }
    pick.querySelector<HTMLElement>('.listpick-menu')!.hidden = false;
    pick.querySelector('.listpick-toggle')!.setAttribute('aria-expanded', 'true');
    const options = [...pick.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
    (last ? options.at(-1) : selected ?? options[0])?.focus({ preventScroll: true });
  };
  const choose = (pick: HTMLElement, option: HTMLElement): void => {
    const select = pick.querySelector('select') as HTMLSelectElement;
    select.value = option.dataset.listChoice ?? '';
    // Settings keeps its header in place; other screens may rebuild it.
    // Update the visible value in either case before announcing the change.
    const toggle = pick.querySelector<HTMLButtonElement>('.listpick-toggle')!;
    const label = option.textContent?.trim() ?? '';
    toggle.innerHTML = `${esc(label)}<span aria-hidden="true"> ▾</span>`;
    toggle.setAttribute('aria-label', `Which list to look at: ${label}`);
    for (const choice of pick.querySelectorAll<HTMLElement>('[data-list-choice]')) {
      choice.setAttribute('aria-selected', String(choice === option));
    }
    close(pick);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const pick = target.closest<HTMLElement>('.listpick');
    if (!pick) {
      for (const other of document.querySelectorAll<HTMLElement>('.listpick')) close(other);
      return;
    }
    if (target.closest('.listpick-toggle')) {
      if (pick.querySelector<HTMLElement>('.listpick-menu')!.hidden) show(pick);
      else close(pick, true);
    }
    const option = target.closest<HTMLElement>('[data-list-choice]');
    if (option) choose(pick, option);
  });
  document.addEventListener('focusin', (e) => {
    for (const pick of document.querySelectorAll<HTMLElement>('.listpick')) {
      if (!pick.contains(e.target as Node)) close(pick);
    }
  });
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const pick = target.closest<HTMLElement>('.listpick');
    if (!pick || target.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation();
    const menu = pick.querySelector<HTMLElement>('.listpick-menu')!;
    if (e.key === 'Escape') { e.preventDefault(); close(pick, true); return; }
    if (menu.hidden) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault(); show(pick, e.key === 'ArrowUp');
      }
      return;
    }
    const options = [...menu.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    const index = options.indexOf(target as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (e.key === 'ArrowDown') next = options[(index + 1) % options.length];
    else if (e.key === 'ArrowUp') next = options[(index - 1 + options.length) % options.length];
    else if (e.key === 'Home') next = options[0];
    else if (e.key === 'End') next = options.at(-1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); if (target.matches('[data-list-choice]')) choose(pick, target); return;
    } else if (e.key.length === 1) {
      next = [...options.slice(index + 1), ...options.slice(0, index + 1)]
        .find((option) => option.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
    }
    if (next) { e.preventDefault(); next.focus({ preventScroll: true }); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement) || !el.closest('.listpick')) return;
    if (!isListChoice(el.value)) return;
    const active: unknown = document.activeElement;
    listFocusUntil = active === el || el.closest('.listpick')?.contains(document.activeElement) ? Date.now() + 4000 : 0;
    setList(el.value);
    restoreListFocus();
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
      const pick = document.querySelector('.listpick-toggle') as HTMLButtonElement | null;
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
  installPhotoViewer();
  void refreshLists();
}
