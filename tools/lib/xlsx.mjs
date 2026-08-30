// @ts-check

/**
 * xlsx.mjs — a minimal, read-only .xlsx reader. Zero dependencies
 * (AGENTS.md hard rule), so the ZIP container is unpacked here with
 * node:zlib and the sheet XML is parsed directly.
 *
 * Scope is deliberately narrow: what the M0 imports need to read the
 * frozen spreadsheets — shared strings, inline strings, and raw cell
 * values by column letter. Number formats are NOT interpreted; a cell
 * comes back as the string the file stores. Every year and catalogue
 * number in these sheets is text, and inventing a date parse here
 * would be a silent source of wrong data.
 *
 * ZIP64 is rejected rather than misread; the frozen inputs top out at
 * 157 KB, so encountering it means something changed upstream.
 */

import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

/**
 * Unpack a ZIP into a name → Buffer map by walking the central
 * directory (the authoritative index; local headers may carry
 * deferred sizes).
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff) throw new Error('ZIP64 archive: unsupported, and unexpected for these inputs');

  /** @type {Map<string, Buffer>} */ const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== CEN_SIG) throw new Error(`corrupt central directory at ${offset}`);
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOff = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    // Re-read the name/extra lengths from the LOCAL header: they are
    // permitted to differ from the central copy, and using the wrong
    // ones lands the data pointer inside the filename.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`${name}: unsupported compression method ${method}`);

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** @param {string} s */
const decodeEntities = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

/** Concatenate every <t> in a fragment — rich-text runs split one string across many. */
const textOf = (/** @type {string} */ xml) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g)]
    .map((m) => decodeEntities(m[1] ?? '')).join('');

/** @param {string} xml @returns {string[]} */
function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/**
 * @param {string} xml
 * @param {string[]} shared
 * @returns {Record<string, string>[]} one object per row, keyed by column letter
 */
function parseSheet(xml, shared) {
  /** @type {Record<string, string>[]} */ const rows = [];
  for (const rowM of xml.matchAll(/<row(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    /** @type {Record<string, string>} */ const row = {};
    for (const cM of (rowM[1] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cM[1];
      const body = cM[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];

      let value = '';
      if (type === 's') {
        const idx = /<v>(\d+)<\/v>/.exec(body);
        if (idx) value = shared[Number(idx[1])] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body);
        if (v) value = decodeEntities(v[1]);
      }
      if (value !== '') row[ref[1]] = value;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Read a workbook into `{ sheetName: rows }`, preserving sheet order.
 * @param {string} path
 * @returns {{ order: string[], sheets: Record<string, Record<string, string>[]> }}
 */
export function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  const get = (/** @type {string} */ n) => files.get(n)?.toString('utf8') ?? '';

  const shared = parseSharedStrings(get('xl/sharedStrings.xml'));
  const rels = new Map(
    [...get('xl/_rels/workbook.xml.rels')
      .matchAll(/<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
      .map((m) => [m[1], m[2]]));

  /** @type {string[]} */ const order = [];
  /** @type {Record<string, Record<string, string>[]>} */ const sheets = {};
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\s([^>]*)\/?>/g)) {
    const name = decodeEntities(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1] ?? '';
    let target = rels.get(rid) ?? '';
    if (!target) continue;
    if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\/+/, '')}`;
    order.push(name);
    sheets[name] = parseSheet(get(target), shared);
  }
  return { order, sheets };
}

/**
 * Re-key rows by their header labels, dropping the header row itself.
 * Rows are returned even when empty — callers decide what a
 * placeholder is, and the M0 placeholder rule needs to see them.
 * @param {Record<string, string>[]} rows
 * @returns {{ headers: Record<string, string>, records: Record<string, string>[] }}
 */
export function withHeaders(rows) {
  const headers = rows[0] ?? {};
  const records = rows.slice(1).map((r) => {
    /** @type {Record<string, string>} */ const out = {};
    for (const [col, val] of Object.entries(r)) out[headers[col] ?? col] = val;
    return out;
  });
  return { headers, records };
}
