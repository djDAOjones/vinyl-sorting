// @ts-check

/**
 * load-files.mjs — M0-MERGE-LOAD-FILES.
 *
 * `1st load to add.xlsx` and `2nd load to add.xlsx` hold 374 and 337
 * rows, of which 37 and 46 are real — 83 in total, under the same
 * mechanical placeholder rule the Remedial sheet uses.
 *
 * These files combine label and catalogue number in one column, so
 * every row goes through the splitter before it can be compared.
 *
 * DE-DUPLICATION is by repaired catalogue number plus label, WITH
 * MULTIPLICITY. Four rows read `RTL2075 MCPS`, and they are four
 * physical copies, not one row counted four times — so a key that
 * already appears four times in the dataset absorbs four incoming
 * rows and no more. Matching keys but disagreeing titles is treated as
 * ambiguous and kept, per the record: merging on a guess is worse than
 * carrying a duplicate a person can resolve while holding the disc.
 */

import { readWorkbook, withHeaders } from '../xlsx.mjs';
import { repairText } from '../text-repair.mjs';
import { splitLabelCatno } from '../split-label-catno.mjs';
import { makeRow } from '../dataset.mjs';
import { isPlaceholder } from './remedial.mjs';

export const SOURCES = [
  { file: '2nd load to add.xlsx', sheet: 'Sheet1' },
  { file: '1st load to add.xlsx', sheet: 'Sheet1 (2)' },
];

const COMBINED_COLUMN = 'Label (and Catalog #)';

/**
 * A comparison key, not a stored value. Folds case, collapses spaces
 * and maps the Unicode dashes to ASCII so `TWO-269` and `TWO‑269`
 * compare equal. Storage stays faithful — normalising the data itself
 * is M2's job.
 * @param {string} catno @param {string} label
 */
export const dedupeKey = (catno, label) => [label, catno]
  .map((s) => (s ?? '').toUpperCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim())
  .join('|');

/**
 * @param {string} archive
 * @param {string[]} gazetteer
 * @param {Record<string,string>[]} existing rows already in the dataset
 */
export function importLoadFiles(archive, gazetteer, existing) {
  // Multiset of what is already present, so repeated pressings are
  // absorbed one for one rather than collapsed.
  /** @type {Map<string, Record<string,string>[]>} */ const available = new Map();
  for (const r of existing) {
    const k = dedupeKey(r.catno_raw, r.label_raw);
    if (!available.has(k)) available.set(k, []);
    available.get(k)?.push(r);
  }

  /** @type {Record<string,string>[]} */ const rows = [];
  /** @type {{sourceFile: string, sourceRowId: string, key: string, decision: string, matchedItemId: string}[]} */
  const decisions = [];
  /** @type {Record<string, number>} */ const stats = { sheetRows: 0, usable: 0, merged: 0, duplicates: 0, ambiguous: 0 };

  for (const { file, sheet } of SOURCES) {
    const wb = readWorkbook(`${archive}/${file}`);
    const { records } = withHeaders(wb.sheets[sheet]);
    stats.sheetRows += records.length;

    for (const r of records) {
      if (isPlaceholder(r)) continue;
      stats.usable++;

      const R = (/** @type {string} */ k) => repairText(r[k] ?? '');
      const s = splitLabelCatno(R(COMBINED_COLUMN), gazetteer);
      const key = dedupeKey(s.catnoRaw, s.labelRaw);
      const title = R('Title');

      const candidates = available.get(key) ?? [];
      const match = candidates.shift();

      if (match) {
        // Corroborate with the title where both sides have one. A key
        // match with disagreeing titles is not a duplicate.
        const bothTitled = title && match.title;
        if (bothTitled && title.toLowerCase() !== match.title.toLowerCase()) {
          candidates.unshift(match);            // put it back; it matched nothing
          stats.ambiguous++;
          decisions.push({ sourceFile: file, sourceRowId: R('ID'), key, decision: 'ambiguous-kept', matchedItemId: match.item_id ?? '' });
        } else {
          stats.duplicates++;
          decisions.push({ sourceFile: file, sourceRowId: R('ID'), key, decision: 'duplicate-dropped', matchedItemId: match.item_id ?? '' });
          continue;
        }
      } else {
        stats.merged++;
        decisions.push({ sourceFile: file, sourceRowId: R('ID'), key, decision: 'merged-new', matchedItemId: '' });
      }

      rows.push(makeRow({
        capture_state: 'needs-capture',
        import_batch: 'M0-MERGE-LOAD-FILES',
        source_file: file,
        source_sheet: sheet,
        source_row_id: R('ID'),

        composer: R('Composer'), composer_source: 'legacy',
        conductor: R('Conductor'), conductor_source: 'legacy',
        title, title_source: 'legacy',
        year_recorded: R('Year of Recording'), year_recorded_source: 'legacy',
        year_released: R('Year of Release'), year_released_source: 'legacy',

        label_raw: s.labelRaw, label_raw_source: s.labelRaw ? 'legacy' : '',
        catno_raw: s.catnoRaw, catno_raw_source: s.catnoRaw ? 'legacy' : '',
        qualifier_raw: s.qualifierRaw,
        combined_raw: s.combinedRaw,
        split_outcome: s.outcome,
        split_reason: s.reason,

        discogs_found: 'no',
        confirmed: 'no',
      }));
    }
  }

  return { rows, decisions, stats };
}
