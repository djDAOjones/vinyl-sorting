#!/usr/bin/env node
// @ts-check

/**
 * load-dataset.mjs — M1-SCHEMA.
 *
 * Loads M0's reconciled CSV into the D1 schema. D1 is SQLite, so this
 * runs against Node's built-in `node:sqlite` with no emulator, no
 * deploy and no Cloudflare account — the same SQL that `wrangler d1
 * execute` will apply.
 *
 * THE RULE THAT SHAPES THIS LOADER (AGENTS.md, project boundaries):
 * never write back over `capture`. Discogs data lands in `release`;
 * the two stay separate for ever, so duplicate detection runs on what
 * a human read rather than on what a bad match wrote.
 *
 * So a value's destination is decided by its provenance, not by its
 * name. `label_raw` sourced `legacy` is something a person typed and
 * goes to `capture.label_raw`; the same column sourced `discogs` is
 * something a matcher wrote and goes to `release.label`. The two never
 * mix, and nothing is dropped: values with no home in the four-entity
 * model yet land in `raw_value` with their provenance intact.
 *
 * Every item/release link is written UNCONFIRMED, so the decision
 * views return nothing until a person confirms. That is the
 * done-when, not an accident.
 *
 * Usage: node tools/load-dataset.mjs [--out data/deep-groove.sqlite]
 *        node tools/load-dataset.mjs --sql [--sql-out data/seed.sql]
 *
 * `--sql` emits the same load as a portable INSERT script, which is
 * how the rows reach a REMOTE D1: `wrangler d1 execute --file` is the
 * only route in, and it takes SQL, not a SQLite file.
 */

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readCsv } from './lib/csv.mjs';

const SCHEMA_DIR = 'schema';
const CSV = 'data/deep-groove-v1.csv';

/** Legacy columns with no home in the four-entity model yet. */
const RAW_LEGACY = ['musicians', 'track_listing', 'format', 'year_recorded'];
/** AI columns — permanently untrusted, kept displayable. */
const RAW_AI = [
  'ai_track_listing', 'ai_track_listing_confidence', 'ai_remarks',
  'ai_sources', 'ai_rating', 'ai_rating_confidence', 'ai_critical_notes',
];

/**
 * @param {string} dbPath
 * @param {string} [csvPath]
 */
export function loadDataset(dbPath, csvPath = CSV) {
  if (dbPath !== ':memory:') rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  // Every migration in order: the schema is no longer one file.
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`${SCHEMA_DIR}/${f}`, 'utf8'));
  }

  const rows = readCsv(readFileSync(csvPath, 'utf8'));

  const insItem = db.prepare(
    'INSERT INTO item (import_ref, decision, captured_by, captured_at) VALUES (?, ?, ?, ?)');
  const insCapture = db.prepare(
    'INSERT INTO capture (item_id, catno_raw, label_raw, name_raw, title_raw, year_raw) VALUES (?,?,?,?,?,?)');
  const insRelease = db.prepare(
    'INSERT INTO release (discogs_id, label, catno) VALUES (?,?,?)');
  const linkRelease = db.prepare('UPDATE item SET release_id = ? WHERE id = ?');
  const insRaw = db.prepare('INSERT INTO raw_value (item_id, field, value) VALUES (?,?,?)');
  const insSource = db.prepare(
    'INSERT INTO field_source (entity, entity_id, field, source) VALUES (?,?,?,?)');

  /** @type {Map<string, number>} */ const releaseByDiscogsId = new Map();
  // Raw values are tallied by their ACTUAL provenance, not by which
  // column they came from. The 28 track listings M0 caught are named
  // like legacy columns and are `guess` in truth; counting them by
  // name would reproduce, in the statistics, exactly the confusion the
  // provenance rule exists to end.
  const stats = {
    items: 0, captures: 0, releases: 0, releasesShared: 0,
    fieldSources: 0, linkedToRelease: 0,
    /** @type {Record<string, number>} */ rawBySource: {},
  };

  db.exec('BEGIN');
  for (const r of rows) {
    const itemId = Number(insItem.run(r.item_id, 'undecided', null, null).lastInsertRowid);
    stats.items++;

    const source = (/** @type {string} */ f) => r[`${f}_source`] ?? '';
    const src = (/** @type {string} */ entity, /** @type {number} */ id, /** @type {string} */ field, /** @type {string} */ s) => {
      insSource.run(entity, id, field, s);
      stats.fieldSources++;
    };

    // ── capture: human-read values only ──────────────────────────
    // A value sourced `discogs` is a matcher's output, not a person's
    // reading, so it is excluded here by provenance rather than by
    // column name.
    const human = (/** @type {string} */ f) => (source(f) === 'legacy' || source(f) === 'shelf' ? r[f] : '');
    const nameRaw = human('conductor') || human('composer');
    const captureCols = {
      catno_raw: human('catno_raw'),
      label_raw: human('label_raw'),
      name_raw: nameRaw,
      title_raw: human('title'),
      year_raw: human('year_released'),
    };
    if (Object.values(captureCols).some(Boolean)) {
      const capId = Number(insCapture.run(
        itemId, captureCols.catno_raw || null, captureCols.label_raw || null,
        captureCols.name_raw || null, captureCols.title_raw || null, captureCols.year_raw || null,
      ).lastInsertRowid);
      stats.captures++;
      for (const [col, val] of Object.entries(captureCols)) {
        if (!val) continue;
        // name_raw's provenance follows whichever field supplied it.
        const from = col === 'name_raw' ? (human('conductor') ? 'conductor' : 'composer')
          : col === 'title_raw' ? 'title'
            : col === 'year_raw' ? 'year_released' : col;
        src('capture', capId, col, source(from) || 'legacy');
      }
    }

    // ── release: Discogs-sourced identity only ───────────────────
    if (r.discogs_id) {
      let releaseId = releaseByDiscogsId.get(r.discogs_id);
      if (releaseId === undefined) {
        // Discogs-sourced label only; the CSV title is a legacy value
        // and must not be written here as if Discogs had supplied it.
        const label = source('label_raw') === 'discogs' ? r.label_raw : null;
        releaseId = Number(insRelease.run(Number(r.discogs_id), label, r.catno_raw || null).lastInsertRowid);
        releaseByDiscogsId.set(r.discogs_id, releaseId);
        stats.releases++;
        src('release', releaseId, 'discogs_id', 'discogs');
        if (label) src('release', releaseId, 'label', 'discogs');
      } else {
        // Two items, one pressing — correct, not a duplicate.
        stats.releasesShared++;
      }
      linkRelease.run(releaseId, itemId);
      stats.linkedToRelease++;
      // UNCONFIRMED on purpose: 26 of 277 of these point at the wrong
      // record, so none may reach a decision before M2 re-verifies.
      src('item', itemId, 'release_id', 'discogs');
    }

    // ── raw_value: nothing is dropped ────────────────────────────
    for (const f of [...RAW_LEGACY, ...RAW_AI]) {
      if (!r[f]) continue;
      const rawId = Number(insRaw.run(itemId, f, r[f]).lastInsertRowid);
      const provenance = source(f) || 'legacy';
      src('raw_value', rawId, 'value', provenance);
      stats.rawBySource[provenance] = (stats.rawBySource[provenance] ?? 0) + 1;
    }
  }
  db.exec('COMMIT');
  return { db, stats, rows: rows.length };
}

/** SQLite string literal: double the quotes, and nothing else. */
const lit = (/** @type {unknown} */ v) =>
  v === null || v === undefined ? 'NULL'
    : typeof v === 'number' ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

/**
 * Dump the loaded database as INSERT statements, in dependency order.
 * `wrangler d1 execute --file` is the only way into a remote D1, and
 * it takes SQL rather than a SQLite file.
 * @param {any} db
 */
export function toSeedSql(db) {
  // release before item (item.release_id references it); capture,
  // raw_value and field_source last.
  // Order matters only for readability — foreign keys are off for the
  // dump — but match results come last because they reference the rest.
  const tables = [
    'release', 'item', 'capture', 'raw_value', 'field_source',
    'match_run', 'match_candidate', 'review_decision',
  ];
  // NO `BEGIN TRANSACTION`: remote D1 rejects explicit transactions
  // outright — it manages them itself and answers with a message about
  // state.storage.transaction(). Local miniflare accepts them, being
  // plain SQLite, so this only shows up against the real thing.
  //
  // Safe without one because the table order below is dependency
  // order — parents before children — so no insert can reference a row
  // that does not exist yet.
  const out = [
    '-- Vinyl sorter — M0 dataset as INSERTs. GENERATED by',
    '-- `node tools/load-dataset.mjs --sql`; never hand-edit.',
    '-- Apply the migrations in schema/ first.',
    '-- No explicit transaction: remote D1 refuses them.',
  ];
  // Batched multi-row INSERTs, not one statement per row: a
  // row-at-a-time dump is 12,445 statements, and `wrangler d1 execute`
  // has to ship every one of them. Batching takes it to ~130.
  const BATCH = 100;
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    out.push(`-- ${table}: ${rows.length} rows`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const values = rows.slice(i, i + BATCH)
        .map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n');
      out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${values};`);
    }
  }
  out.push('');
  return out.join('\n');
}

// argv[1] is undefined when this module is imported by `node -e`,
// and pathToFileURL(undefined) throws.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = i >= 0 && args[i + 1] ? args[i + 1] : 'data/deep-groove.sqlite';
  const emitSql = args.includes('--sql');
  const sqlOut = (() => { const j = args.indexOf('--sql-out'); return j >= 0 && args[j + 1] ? args[j + 1] : 'data/seed.sql'; })();
  const { db, stats, rows } = loadDataset(emitSql ? ':memory:' : out);
  if (emitSql) {
    writeFileSync(sqlOut, toSeedSql(db));
    console.log(`load-dataset: ${rows} CSV rows -> ${sqlOut}`);
  } else {
    console.log(`load-dataset: ${rows} CSV rows -> ${out}`);
  }
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  const q = (/** @type {string} */ sql) => db.prepare(sql).get();
  console.log(`  decision-eligible items: ${JSON.stringify(q('SELECT COUNT(*) n FROM v_decision_eligible_item'))}`);
  console.log(`  decision-eligible releases: ${JSON.stringify(q('SELECT COUNT(*) n FROM v_decision_eligible_release'))}`);
  console.log(`  confirmed fields: ${JSON.stringify(q('SELECT COUNT(*) n FROM v_confirmed_field'))}`);
}
