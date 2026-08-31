/**
 * Who is holding the phone.
 *
 * There is no sign-in — OPEN-V1-AUTH settled that for v1 — so a row can
 * only say who read its label if the person names themselves. A name
 * typed once per device does two jobs at once: it stamps every capture
 * made on that phone afterwards, and it is a crude gate, because typing
 * asks you to know an answer that is not printed on the screen.
 *
 * A picker was considered and rejected. Six buttons print the six valid
 * answers, so it cannot gate anything at all, and it costs a tap on
 * every device for ever. Typing costs one screen, once.
 *
 * SAY WHAT THIS IS NOT. Six household first names are guessable and the
 * roster ships in the bundle, so this is a speed bump and an honest
 * label on a row — not access control. Access control is the separate
 * question OPEN-V1-AUTH answered "no sign-in for v1", and shipping this
 * does not answer it. The two are halves of one word: this one says who
 * is holding the phone, that one says who may write at all.
 */

/**
 * The people who capture, in their canonical spelling.
 *
 * Spelling is the roster's problem rather than the typist's: `jojo`,
 * `JOJO` and `JoJo` all land as `Jojo`, so the free-text spelling
 * problem NAMES-CANONICAL exists to clean up on the composer side never
 * reaches this column at all.
 */
export const ROSTER = ['Joe', 'Jen', 'Ro', 'Ivy', 'Jojo', 'Sue'] as const;

export type Capturer = typeof ROSTER[number];

/**
 * The canonical name for what somebody typed, or null when it is not
 * one of ours — and that refusal IS the gate.
 *
 * Case and surrounding space are forgiven because they say nothing.
 * Nothing else is: a fuzzy match would put one person's name on another
 * person's row, which is the same class of fault as an invented rating
 * and just as invisible afterwards.
 */
export function resolveCapturer(typed: string): Capturer | null {
  const key = typed.trim().toLowerCase();
  if (!key) return null;
  return ROSTER.find((name) => name.toLowerCase() === key) ?? null;
}

/** Where the name lives. Read by capture and by the review queue. */
const KEY = 'dg.who';

/**
 * The same name, as a cookie, because `<img>` cannot send a header.
 *
 * THE BUG THIS EXISTS FOR: BROWSE-PHOTOS gated the photo route on an
 * `x-capturer` header, which every `fetch` can set and no `<img src>`
 * can. Browse and review both render photographs as `<img>`, so every
 * one of them went out unauthenticated and came back 401 — broken
 * images on both screens, while curl with a header passed happily. The
 * test that mattered was a page load, and it was not run.
 *
 * A cookie rides on an image request automatically, and on lazy-loaded
 * and cached ones too. That it is a cookie changes nothing about what
 * this is worth: the roster ships in the client bundle, so this is the
 * same speed bump it always was, now applied where images actually
 * live. `SameSite=Strict` because no other site has business asking.
 */
const COOKIE = 'dg_who';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The capturer this device remembers, re-checked against the roster on
 * every read.
 *
 * Re-checking matters because earlier builds wrote free text here — the
 * review queue asked for a name and stored whatever came back. A value
 * that is not on the roster is treated as no value, so the device is
 * asked once more instead of going on stamping rows with it.
 *
 * Storage that throws (private browsing, site data blocked) is treated
 * the same way: the name is asked for at every launch, which is a
 * nuisance rather than a lock-out.
 */
export function storedCapturer(): Capturer | null {
  try {
    return resolveCapturer(localStorage.getItem(KEY) ?? '');
  } catch {
    return null;
  }
}

export function rememberCapturer(name: Capturer): void {
  try { localStorage.setItem(KEY, name); } catch { /* asked again next launch */ }
  try {
    document.cookie = `${COOKIE}=${encodeURIComponent(name)}; path=/; `
      + `max-age=${COOKIE_MAX_AGE}; SameSite=Strict`;
  } catch { /* images will 401 and show as broken, which is visible */ }
}

/** Hand the phone over. The queue is not touched — see the callers. */
export function forgetCapturer(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget, then */ }
  try { document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Strict`; } catch { /* gone anyway */ }
}

/**
 * Put the cookie back for a device that named itself before cookies
 * were used. Otherwise every photograph stays broken until the person
 * signs out and in again for reasons they cannot see.
 */
export function ensureCapturerCookie(): void {
  const who = storedCapturer();
  if (who && !document.cookie.includes(`${COOKIE}=`)) rememberCapturer(who);
}
