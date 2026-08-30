// @ts-check

/**
 * csv.mjs — RFC 4180 reader. Zero dependencies.
 *
 * Track listings contain real newlines inside quoted fields, so a
 * line-splitting parser would tear rows in half. This one tracks quote
 * state across the whole text.
 */

/**
 * @param {string} text
 * @returns {string[][]} rows of raw cells, including the header row
 */
export function parseCsv(text) {
  /** @type {string[][]} */ const rows = [];
  /** @type {string[]} */ let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * @param {string} text
 * @returns {Record<string, string>[]} header-keyed records
 */
export function readCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}
