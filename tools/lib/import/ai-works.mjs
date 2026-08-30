// @ts-check

/**
 * ai-works.mjs — M0-IMPORT-AI-WORKS.
 *
 * Attaches the AI-generated columns to the 305 enriched rows, joined on
 * the source row ID, with every value tagged `source: guess`. Guessed
 * values may be displayed anywhere and may never feed a cluster, a
 * coverage check, a sell list or a shortlist — enforced by
 * `decision_eligible`, which is computed rather than asserted.
 *
 * TWO FINDINGS FROM THE DATA, both recorded because they change what
 * this import can honestly claim:
 *
 *  1. `Critical Rating` is EMPTY in every AI Works file — all six that
 *     carry the column, including the one named "Rating Qualifiers
 *     etc". The AI-invented ratings the brief warns about were never
 *     written. The columns are kept in the schema and arrive blank,
 *     which is the honest result; what does exist is AI track
 *     listings, their confidence, remarks and sources.
 *
 *  2. The AI track listings DID leak into the enriched sheet. On all
 *     28 rows where Discogs found nothing, `Track listing` in
 *     `Classical Master` is byte-identical to the AI file's value, and
 *     on none of the 277 matched rows is it. That is the
 *     indistinguishable-AI-beside-sourced-data problem stated in the
 *     brief, caught precisely. Those 28 values are reclassified from
 *     `legacy` to `guess` here — identity with the AI output is the
 *     evidence, not a guess about it.
 *
 * v2 `classical Track listings 01.xlsx` is one day newer and was chosen
 * to override v1 Stage 8 for track listings. It agrees with Stage 8 on
 * all 305 rows, so the override is a no-op — recorded rather than
 * quietly dropped, because "we checked and they agree" is a different
 * fact from "we did not check".
 */

import { readWorkbook, withHeaders } from '../xlsx.mjs';
import { repairText } from '../text-repair.mjs';

export const STAGE8 = 'AI Works/v1/AI_Vinyl_Works_Stage_8 AI Data update.xlsx';
export const V2 = 'AI Works/v2/classical Track listings 01.xlsx';

/** Header text for the rating confidence carries an embedded legend. */
const findHeader = (/** @type {Record<string,string>} */ headers, /** @type {string} */ prefix) =>
  Object.values(headers).find((h) => h.startsWith(prefix)) ?? '';

/**
 * @param {string} archive
 * @param {Record<string,string>[]} rows the composed dataset, mutated in place
 */
export function importAiWorks(archive, rows) {
  const s8 = withHeaders(readWorkbook(`${archive}/${STAGE8}`).sheets['Classical Master']);
  const v2 = withHeaders(readWorkbook(`${archive}/${V2}`).sheets['Sheet1']);
  const R = (/** @type {Record<string,string>} */ r, /** @type {string} */ k) => repairText(r[k] ?? '');

  const ratingConfidence = findHeader(s8.headers, 'Confidence in critical rating');
  const by8 = new Map(s8.records.map((r) => [R(r, 'ID'), r]));
  const by2 = new Map(v2.records.map((r) => [R(r, 'ID'), r]));

  /** @type {Record<string, number>} */
  const stats = {
    aiRows: s8.records.length, v2Rows: v2.records.length,
    attached: 0, unmatched: 0,
    ratingsFound: 0, trackListingsFound: 0,
    v2Overrides: 0, v2Agreements: 0,
    reclassifiedToGuess: 0,
  };

  for (const row of rows) {
    // The AI pass only ever covered the enriched sheet.
    if (row.import_batch !== 'M0-IMPORT-ENRICHED') continue;
    const ai = by8.get(row.source_row_id);
    if (!ai) { stats.unmatched++; continue; }
    stats.attached++;

    const s8Listing = R(ai, 'Track listing');
    const v2Listing = by2.has(row.source_row_id) ? R(/** @type {any} */ (by2.get(row.source_row_id)), 'Track listing') : '';

    // v2 was chosen to win where it has a value.
    let listing = s8Listing;
    let origin = s8Listing ? 'v1-stage-8' : '';
    if (v2Listing) {
      if (v2Listing === s8Listing) stats.v2Agreements++;
      else stats.v2Overrides++;
      listing = v2Listing;
      origin = v2Listing === s8Listing ? 'v1-stage-8=v2' : 'v2-track-listings';
    }

    const rating = R(ai, 'Critical Rating');
    if (rating) stats.ratingsFound++;
    if (listing) stats.trackListingsFound++;

    row.ai_track_listing = listing;
    row.ai_track_listing_source = listing ? 'guess' : '';
    row.ai_track_listing_confidence = R(ai, 'Confidence in Track listing');
    row.ai_track_listing_confidence_source = row.ai_track_listing_confidence ? 'guess' : '';
    row.ai_remarks = R(ai, 'Remarks');
    row.ai_remarks_source = row.ai_remarks ? 'guess' : '';
    row.ai_sources = R(ai, 'Sources');
    row.ai_sources_source = row.ai_sources ? 'guess' : '';
    row.ai_rating = rating;
    row.ai_rating_source = rating ? 'guess' : '';
    row.ai_rating_confidence = ratingConfidence ? R(ai, ratingConfidence) : '';
    row.ai_rating_confidence_source = row.ai_rating_confidence ? 'guess' : '';
    row.ai_critical_notes = R(ai, 'Critical Notes');
    row.ai_critical_notes_source = row.ai_critical_notes ? 'guess' : '';
    row.ai_source_file = STAGE8;
    row.ai_track_listing_origin = origin;

    // Finding 2: a sheet value identical to the AI output IS the AI
    // output. Reclassify it rather than leaving AI prose labelled as a
    // legacy human entry.
    if (row.track_listing && row.track_listing === s8Listing && row.track_listing_source !== 'guess') {
      row.track_listing_source = 'guess';
      stats.reclassifiedToGuess++;
    }
  }

  return { stats };
}
