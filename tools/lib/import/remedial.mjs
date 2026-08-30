// @ts-check

/**
 * remedial.mjs — M0-IMPORT-REMEDIAL.
 *
 * `Classical Remedial` holds 351 rows: 141 real records that were never
 * fully captured, and 210 empty placeholders.
 *
 * THE PLACEHOLDER RULE, stated once so the report can quote it: a row
 * is a placeholder when it carries no value in any column other than
 * ID. It is mechanical, it needs no judgement, and it partitions the
 * sheet exactly 210/141. Dropping is fine; dropping silently is not, so
 * every dropped row's ID is returned for the reconciliation report.
 *
 * These rows have no label at all — column `Label` is empty on all 141,
 * which is the "label captured on 0% of the backlog" finding. The
 * combined label-and-catalogue string sits in `Catalogue #` and is put
 * through the splitter; where it refuses, the row simply keeps its
 * combined string and waits for capture.
 */

import { readWorkbook, withHeaders } from '../xlsx.mjs';
import { repairText } from '../text-repair.mjs';
import { splitLabelCatno } from '../split-label-catno.mjs';
import { makeRow } from '../dataset.mjs';

export const SOURCE_FILE = 'Vinyl Records Record 2 Jen.xlsx';
export const SOURCE_SHEET = 'Classical Remedial';

/** A row is real if anything other than its ID is populated. */
export const isPlaceholder = (/** @type {Record<string,string>} */ r) =>
  !Object.entries(r).some(([k, v]) => k !== 'ID' && String(v ?? '').trim() !== '');

/**
 * @param {string} archive
 * @param {string[]} gazetteer the label vocabulary attested by the enriched rows
 */
export function importRemedial(archive, gazetteer) {
  const wb = readWorkbook(`${archive}/${SOURCE_FILE}`);
  const { records } = withHeaders(wb.sheets[SOURCE_SHEET]);
  const R = (/** @type {Record<string,string>} */ r, /** @type {string} */ k) => repairText(r[k] ?? '');

  /** @type {string[]} */ const droppedIds = [];
  /** @type {Record<string, number>} */ const splitOutcomes = {};
  /** @type {Record<string, number>} */ const splitReasons = {};

  const rows = [];
  for (const r of records) {
    if (isPlaceholder(r)) { droppedIds.push(R(r, 'ID')); continue; }

    const combined = R(r, 'Catalogue #');
    const s = splitLabelCatno(combined, gazetteer);
    splitOutcomes[s.outcome] = (splitOutcomes[s.outcome] ?? 0) + 1;
    splitReasons[s.reason] = (splitReasons[s.reason] ?? 0) + 1;

    rows.push(makeRow({
      capture_state: 'needs-capture',
      import_batch: 'M0-IMPORT-REMEDIAL',
      source_file: SOURCE_FILE,
      source_sheet: SOURCE_SHEET,
      source_row_id: R(r, 'ID'),

      composer: R(r, 'Composer'), composer_source: 'legacy',
      conductor: R(r, 'Conductor'), conductor_source: 'legacy',
      musicians: R(r, 'Musicians'), musicians_source: 'legacy',
      title: R(r, 'Title'), title_source: 'legacy',
      year_recorded: R(r, 'Year of Recording (if known)'), year_recorded_source: 'legacy',
      year_released: R(r, 'Year of Release'), year_released_source: 'legacy',
      format: R(r, 'Stereo /Mono'), format_source: 'legacy',
      track_listing: R(r, 'Track listing'), track_listing_source: 'legacy',

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

  return {
    rows,
    droppedIds,
    stats: {
      sheetRows: records.length,
      imported: rows.length,
      droppedPlaceholders: droppedIds.length,
      splitOutcomes,
      splitReasons,
    },
  };
}
