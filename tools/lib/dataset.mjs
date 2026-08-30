// @ts-check

/**
 * dataset.mjs — the shape of the reconciled M0 dataset.
 *
 * One row per physical item. Every value that came from somewhere
 * carries a `<field>_source` column naming its origin, per the
 * PROVENANCE decision of 2026-08-28.
 *
 * The provenance rule, restated from AGENTS.md: a value sourced
 * `guess` or `legacy`, or an unconfirmed `discogs` value, may be
 * displayed anywhere but may never feed a cluster, a coverage check, a
 * sell list or a shortlist until a person has confirmed it.
 *
 * `decision_eligible` materialises that rule as a column so it can be
 * tested rather than trusted. At M0 it is `no` on every row, because
 * nothing has been confirmed by a person and nothing was captured off
 * the shelf — which is the correct and intended state at the end of a
 * pure import pass.
 *
 * Per-field confirmation state is deliberately NOT emitted as 30 more
 * columns all reading `no`. M0 confirms nothing, so one row-level
 * `confirmed` column states the invariant honestly; M1's D1 schema
 * materialises real per-value `field_source` rows.
 */

/** Origins a value can have. `shelf` means a person read it off the record. */
export const SOURCES = /** @type {const} */ (['shelf', 'discogs', 'musicbrainz', 'legacy', 'guess']);

/** Origins that may feed a decision, once confirmed. */
const TRUSTED_WHEN_CONFIRMED = new Set(['shelf', 'discogs', 'musicbrainz']);

/** Fields that carry their own provenance. */
export const SOURCED_FIELDS = [
  'composer', 'conductor', 'musicians', 'title',
  'label_raw', 'catno_raw', 'year_recorded', 'year_released',
  'format', 'track_listing', 'discogs_id',
  'ai_rating', 'ai_rating_confidence', 'ai_track_listing',
  'ai_track_listing_confidence', 'ai_remarks', 'ai_critical_notes', 'ai_sources',
];

/** Column order of the emitted CSV. */
export const COLUMNS = [
  'item_id', 'capture_state', 'import_batch',
  'source_file', 'source_sheet', 'source_row_id',
  ...SOURCED_FIELDS.flatMap((f) => [f, `${f}_source`]),
  'qualifier_raw', 'combined_raw', 'split_outcome', 'split_reason',
  'ai_source_file', 'ai_track_listing_origin',
  'discogs_url', 'discogs_found', 'discogs_confidence_legacy', 'discogs_score_legacy',
  'confirmed', 'decision_eligible',
];

/**
 * The query-layer rule, as a function. A value is decision-eligible
 * only when its origin is trustworthy AND a person has confirmed it.
 * @param {string} source
 * @param {boolean} confirmed
 */
export const valueIsDecisionEligible = (source, confirmed) =>
  TRUSTED_WHEN_CONFIRMED.has(source) && confirmed;

/**
 * A row is decision-eligible only if at least one of its sourced
 * values is. At M0 this is false everywhere by construction.
 * @param {Record<string, string>} row
 */
export function rowIsDecisionEligible(row) {
  const confirmed = row.confirmed === 'yes';
  return SOURCED_FIELDS.some((f) => row[f] && valueIsDecisionEligible(row[`${f}_source`] ?? '', confirmed));
}

/**
 * Build a row with every column present, so the CSV is rectangular
 * whatever the importer chose to populate.
 * @param {Partial<Record<string, string>>} partial
 * @returns {Record<string, string>}
 */
export function makeRow(partial) {
  /** @type {Record<string, string>} */ const row = {};
  for (const col of COLUMNS) row[col] = partial[col] ?? '';
  if (!row.confirmed) row.confirmed = 'no';

  for (const f of SOURCED_FIELDS) {
    const src = row[`${f}_source`];
    if (row[f] && !src) throw new Error(`${row.item_id}: ${f} has a value with no source`);
    if (src && !SOURCES.includes(/** @type {any} */ (src))) throw new Error(`${row.item_id}: unknown source "${src}" on ${f}`);
    // A source with no value is noise; drop it rather than emit a
    // provenance record for nothing.
    if (!row[f] && src) row[`${f}_source`] = '';
  }
  row.decision_eligible = rowIsDecisionEligible(row) ? 'yes' : 'no';
  return row;
}

const cell = (/** @type {string} */ v) =>
  /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/**
 * RFC 4180. Track listings contain real newlines, so quoting is not
 * optional here.
 * @param {Record<string, string>[]} rows
 */
export function toCsv(rows) {
  return [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c] ?? '')).join(','))].join('\n') + '\n';
}
