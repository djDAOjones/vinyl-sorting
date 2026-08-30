// @ts-check

/**
 * enriched.mjs — M0-IMPORT-ENRICHED.
 *
 * The 305 rows of `Classical Master`, imported with every
 * Discogs-derived field marked `discogs` and unconfirmed. The existing
 * confidence labels ("Exact", "Label+Cat", "Fallback") are carried
 * across as `*_legacy` columns for M2 to audit, and are deliberately
 * NOT treated as confidence: 26 of 277 matches point at a different
 * record and 16 of those are labelled "Exact", so the labels carry no
 * information about correctness.
 *
 * Which columns are Discogs-derived was established from the data, not
 * assumed. `Label`, `Discogs ID`, `Discogs URL` and `Discogs ID Score`
 * are populated on exactly the 277 rows where `Discogs record found?`
 * is Yes and on none of the other 28. `Musicians` and `Track listing`
 * were overwritten by the same enrichment pass — 166 of the 277 carry
 * Discogs credit-role markers such as "(Orchestra)" and artist
 * disambiguation such as "(6)", and none of the 28 do. Everything else
 * is filled on all 305 regardless, so it predates the enrichment.
 */

import { readWorkbook, withHeaders } from '../xlsx.mjs';
import { repairText } from '../text-repair.mjs';
import { buildGazetteer, splitLabelCatno } from '../split-label-catno.mjs';
import { makeRow } from '../dataset.mjs';

export const SOURCE_FILE = 'Vinyl Records Record 2 Jen.xlsx';
export const SOURCE_SHEET = 'Classical Master';

/**
 * @param {string} archive
 * @returns {{ rows: Record<string,string>[], gazetteer: string[], stats: Record<string, number> }}
 */
export function importEnriched(archive) {
  const wb = readWorkbook(`${archive}/${SOURCE_FILE}`);
  const { records } = withHeaders(wb.sheets[SOURCE_SHEET]);
  const R = (/** @type {Record<string,string>} */ r, /** @type {string} */ k) => repairText(r[k] ?? '');

  // The label vocabulary the whole import splits against comes from
  // these rows, so it is built before anything else consumes it.
  const gazetteer = buildGazetteer(records.map((r) => R(r, 'Label')).filter(Boolean));

  /** @type {Record<string, number>} */ const stats = { rows: 0, discogsFound: 0, discogsNotFound: 0 };
  const rows = records.map((r, i) => {
    const found = R(r, 'Discogs record found?') === 'Yes';
    stats.rows++;
    if (found) stats.discogsFound++; else stats.discogsNotFound++;

    // Label and catalogue number already arrive separate here; the
    // splitter is not needed, but the split columns stay populated so
    // the dataset is uniform across all four imports.
    const label = R(r, 'Label');
    const catno = R(r, 'Catalogue #');

    return makeRow({
      item_id: `DG-${String(i + 1).padStart(4, '0')}`,
      capture_state: 'enriched',
      import_batch: 'M0-IMPORT-ENRICHED',
      source_file: SOURCE_FILE,
      source_sheet: SOURCE_SHEET,
      source_row_id: R(r, 'ID'),

      composer: R(r, 'Composer'), composer_source: 'legacy',
      conductor: R(r, 'Conductor'), conductor_source: 'legacy',
      title: R(r, 'Title'), title_source: 'legacy',
      catno_raw: catno, catno_raw_source: 'legacy',
      year_recorded: R(r, 'Year of Recording (if known)'), year_recorded_source: 'legacy',
      year_released: R(r, 'Year of Release'), year_released_source: 'legacy',
      format: R(r, 'Stereo /Mono'), format_source: 'legacy',

      // Overwritten by the enrichment where a match was found.
      musicians: R(r, 'Musicians'), musicians_source: found ? 'discogs' : 'legacy',
      track_listing: R(r, 'Track listing'), track_listing_source: found ? 'discogs' : 'legacy',

      // Present only where a match was found.
      label_raw: label, label_raw_source: label ? 'discogs' : '',
      discogs_id: R(r, 'Discogs ID'), discogs_id_source: R(r, 'Discogs ID') ? 'discogs' : '',

      combined_raw: [label, catno].filter(Boolean).join(' '),
      split_outcome: label ? 'split' : (catno ? 'bare-catno' : 'refused'),
      split_reason: label ? 'already-separate-in-source' : (catno ? 'no-label-present' : 'empty'),

      discogs_url: R(r, 'Discogs URL'),
      discogs_found: found ? 'yes' : 'no',
      discogs_confidence_legacy: R(r, 'Discogs ID confidence'),
      discogs_score_legacy: R(r, 'Discogs ID Score'),
      confirmed: 'no',
    });
  });

  return { rows, gazetteer, stats };
}
