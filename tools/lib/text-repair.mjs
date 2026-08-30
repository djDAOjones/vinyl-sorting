// @ts-check

/**
 * text-repair.mjs — M0-REPAIR-ENCODING.
 *
 * Two distinct corruptions live in the frozen inputs, and they need
 * different repairs:
 *
 *  1. BYTE-LEVEL. `classical vinyl list in progress.csv` is not UTF-8;
 *     its bytes are MacRoman. Reading it as UTF-8 yields U+FFFD.
 *     Diagnosed from the byte histogram: 0xCA x68, 0xD0 x57, 0x8E x19
 *     — MacRoman U+00A0, en dash, e-acute. Under cp1252 the same bytes
 *     read as Ê, Ð, Ž, which is nonsense in a classical record list.
 *     cp1252 is the obvious guess and it is wrong.
 *
 *  2. STRING-LEVEL. Text inside the .xlsx files is already Unicode but
 *     carries the *visual* residue of the same mistake: UTF-8 bytes
 *     that were once decoded as MacRoman. `Norsk Kulturr√•ds` is
 *     `Kulturrads` with an a-ring; `CFP‚Äë160` is `CFP` + U+2011.
 *     Repair means running the mistake backwards: encode to MacRoman
 *     bytes, decode as UTF-8.
 *
 * Zero dependencies: Node's TextDecoder ships the `macintosh` table,
 * and the reverse map is derived from it rather than hand-typed.
 */

const macDecoder = new TextDecoder('macintosh');

/** Unicode char → MacRoman byte, derived from the built-in table. */
const TO_MAC = /** @type {Map<string, number>} */ (new Map());
for (let b = 0; b < 256; b++) {
  TO_MAC.set(macDecoder.decode(new Uint8Array([b])), b);
}

/**
 * MacRoman characters occupying UTF-8 *lead* byte positions (0xC2-0xF4).
 * A string with none of these cannot be UTF-8-read-as-MacRoman, so this
 * is a precondition rather than a heuristic — it removes the cost and
 * the risk of attempting a repair on clean text.
 */
const MOJIBAKE_LEADS = new Set(
  Array.from({ length: 0xf4 - 0xc2 + 1 }, (_, i) => macDecoder.decode(new Uint8Array([0xc2 + i]))));

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode a MacRoman-encoded file. Use for raw bytes, not for strings.
 * @param {Buffer | Uint8Array} bytes
 */
export function decodeMacRoman(bytes) {
  return macDecoder.decode(bytes);
}

/**
 * Undo one round of "UTF-8 bytes decoded as MacRoman".
 * Returns the input unchanged unless the reversal succeeds cleanly.
 * @param {string} s
 * @returns {string}
 */
function unmojibakeOnce(s) {
  let sawLead = false;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const b = TO_MAC.get(ch);
    // A character MacRoman cannot represent means this string was
    // never MacRoman output. Bail rather than guess.
    if (b === undefined) return s;
    if (MOJIBAKE_LEADS.has(ch)) sawLead = true;
    bytes[i] = b;
  }
  if (!sawLead) return s;
  try {
    // Strict: any invalid sequence anywhere rejects the whole string.
    // This is what stops a legitimate bullet or radical from being
    // "repaired" into something that was never there.
    const out = utf8Strict.decode(bytes);
    return out === s ? s : out;
  } catch {
    return s;
  }
}

/**
 * Repair string-level mojibake, including text that was mangled more
 * than once. Bounded: three passes is far past anything real, and an
 * unbounded loop on adversarial input is not worth the elegance.
 * @param {string} s
 */
export function repairMojibake(s) {
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = unmojibakeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Deleted outright: they carry no meaning and defeat exact match. */
const ZERO_WIDTH = /[​‌‍⁠﻿­]/g;
/** Folded to a plain space: they are word separators wearing a disguise. */
const ODD_SPACE = /[   -   　]/g;

/**
 * Normalise invisible characters. U+00A0 becomes a space rather than
 * disappearing — in `CBS Harmony 30001` it separates the label
 * from the catalogue number, so deleting it would weld two tokens
 * together and defeat the very match this repair exists to enable.
 *
 * Newlines survive: track listings are multi-line, and flattening them
 * would destroy per-track structure that M3 depends on.
 * @param {string} s
 */
export function stripInvisible(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(ODD_SPACE, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The full ladder, in the order the corruptions were applied.
 * @param {string} s
 */
export function repairText(s) {
  return typeof s === 'string' ? stripInvisible(repairMojibake(s)) : s;
}
