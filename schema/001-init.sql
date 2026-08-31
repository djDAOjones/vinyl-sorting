-- Deep Groove — D1 schema, brief section 03. D1 is SQLite.
--
-- Four linked entities, because a flat row conflates a physical disc,
-- a pressing, a piece of music and a performance — the conflation that
-- made the old spreadsheets unable to answer "how many copies of this
-- symphony do I own, and which is best?".
--
--   item        a disc you own      — the thing kept or sold
--   release     a Discogs pressing  — identity
--   work        the music           — what you group by
--   performance a reading           — what you compare, and what a verdict attaches to
--
-- GENRE-NEUTRALITY (brief section 03): composer_id, work_id,
-- performance_id, conductor and catalogue_ref are ALL nullable, from
-- day one. A house 12" is a valid item with a release and no work at
-- all. The v1 interface never shows an empty classical field; the
-- schema permits one for ever.

PRAGMA foreign_keys = ON;

CREATE TABLE schema_migration (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════ physical ═══════════════════════════

CREATE TABLE item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER REFERENCES release(id) ON DELETE SET NULL,
  crate           TEXT,
  position        TEXT,
  -- Goldmine grading. Nullable: condition is captured at the shelf and
  -- the 446 imported rows have never been graded.
  media_grade     TEXT CHECK (media_grade  IN ('M','NM','VG+','VG','G','P')),
  sleeve_grade    TEXT CHECK (sleeve_grade IN ('M','NM','VG+','VG','G','P')),
  decision        TEXT NOT NULL DEFAULT 'undecided'
                    CHECK (decision IN ('undecided','keep','sell','sold','binned')),
  decision_reason TEXT,
  decided_at      TEXT,
  decided_by      TEXT,
  captured_by     TEXT,
  captured_at     TEXT,
  notes           TEXT,
  -- Traceability back to the M0 reconciled CSV (DG-0001…). Null for
  -- anything captured in the app.
  import_ref      TEXT UNIQUE
);

-- What a HUMAN read off the disc. Never MACHINE-written: Discogs data
-- lands in `release`, and the two stay separate for ever so duplicate
-- detection runs on what a person read rather than on what a bad match
-- wrote (AGENTS.md, project boundaries).
--
-- A person may correct their own reading here, through the browse
-- screen and nowhere else (DATASET-EDIT, maintainer sign-off
-- 2026-08-31). Such an edit writes a `field_source` row with source
-- `shelf`, confirmed, and a name — so a corrected value is
-- distinguishable from an original one afterwards. The matcher and the
-- review queue still may not touch this table at all.
CREATE TABLE capture (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  catno_raw      TEXT,
  label_raw      TEXT,
  name_raw       TEXT,
  title_raw      TEXT,
  matrix_runout  TEXT,
  year_raw       TEXT,
  captured_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX capture_item ON capture(item_id);

CREATE TABLE item_photo (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('label_a','label_b','front','back','runout')),
  r2_key   TEXT NOT NULL UNIQUE,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX item_photo_item ON item_photo(item_id);

-- ═══════════════════════════ identity ═══════════════════════════

CREATE TABLE release (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  discogs_id       INTEGER NOT NULL UNIQUE,
  mb_release_id    TEXT,
  title            TEXT,
  label            TEXT,
  catno            TEXT,
  -- Normalised for matching. M2 owns the ladder; M0 stores faithfully.
  catno_norm       TEXT,
  country          TEXT,
  year             INTEGER,
  format           TEXT,
  is_lp            INTEGER CHECK (is_lp IN (0,1)),
  disc_count       INTEGER,
  lowest_price     REAL,
  num_for_sale     INTEGER,
  have             INTEGER,
  want             INTEGER,
  price_checked_at TEXT
);
CREATE INDEX release_catno_norm ON release(catno_norm);

-- The field that solves the compilation problem: per-track, is this
-- work owned complete on a record being kept?
CREATE TABLE release_track (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id     INTEGER NOT NULL REFERENCES release(id) ON DELETE CASCADE,
  position       TEXT,
  title          TEXT,
  duration_s     INTEGER,
  work_id        INTEGER REFERENCES work(id) ON DELETE SET NULL,
  performance_id INTEGER REFERENCES performance(id) ON DELETE SET NULL,
  completeness   TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (completeness IN ('complete','movement','excerpt','unknown'))
);
CREATE INDEX release_track_release ON release_track(release_id);
CREATE INDEX release_track_work ON release_track(work_id);

-- ═══════════════════════════   music   ═══════════════════════════

CREATE TABLE composer (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mb_artist_id TEXT,
  name         TEXT NOT NULL,
  sort_name    TEXT
);

CREATE TABLE work (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mb_work_id    TEXT,
  composer_id   INTEGER REFERENCES composer(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  catalogue_ref TEXT,   -- Op. 55 / BWV 1046 / K. 550
  form          TEXT,
  number        TEXT
);
CREATE INDEX work_composer ON work(composer_id);

CREATE TABLE performance (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id          INTEGER REFERENCES work(id) ON DELETE CASCADE,
  mb_recording_id  TEXT,
  conductor        TEXT,
  ensemble         TEXT,
  soloists         TEXT,
  recorded_year    INTEGER,
  recorded_place   TEXT,
  is_mono          INTEGER CHECK (is_mono IN (0,1))
);
CREATE INDEX performance_work ON performance(work_id);

-- ═════════════════════ verification, auditable ═════════════════════

CREATE TABLE match_run (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  ran_at            TEXT NOT NULL DEFAULT (datetime('now')),
  state             TEXT NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','auto-accepted','needs-review','rejected','error')),
  -- The exact queries used, so a bad match can be explained later.
  queries_json      TEXT,
  chosen_release_id INTEGER REFERENCES release(id) ON DELETE SET NULL
);
CREATE INDEX match_run_item ON match_run(item_id);

CREATE TABLE match_candidate (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_run_id INTEGER NOT NULL REFERENCES match_run(id) ON DELETE CASCADE,
  rank         INTEGER NOT NULL,
  discogs_id   INTEGER NOT NULL,
  score        REAL NOT NULL,
  -- {catno, label, name, title, format, year} — the independent signal
  -- families the corroboration gate counts.
  signals_json TEXT,
  UNIQUE (match_run_id, rank)
);

-- ═══════════════════════════ decisions ═══════════════════════════

CREATE TABLE cluster (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id        INTEGER NOT NULL REFERENCES work(id) ON DELETE CASCADE,
  state          TEXT NOT NULL DEFAULT 'open'
                   CHECK (state IN ('open','resolved','deferred')),
  priority       INTEGER,
  contrast_max   REAL,
  shortlist_json TEXT
);
CREATE INDEX cluster_work ON cluster(work_id);

CREATE TABLE session (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL REFERENCES cluster(id) ON DELETE CASCADE,
  passage    TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  listener   TEXT
);

CREATE TABLE score (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  perf_score INTEGER CHECK (perf_score BETWEEN 1 AND 10),
  sound_score INTEGER CHECK (sound_score BETWEEN 1 AND 10),
  note       TEXT,
  UNIQUE (session_id, item_id)
);

-- ═══════════════ provenance, on every sourced value ═══════════════
--
-- One row per sourced value. THE PROVENANCE RULE (AGENTS.md, and the
-- decision of 2026-08-28): a value sourced `guess` or `legacy`, or an
-- unconfirmed `discogs` value, may be displayed anywhere but may never
-- feed a cluster, a coverage check, a sell list or a shortlist until a
-- person has confirmed it.
--
-- Enforced in the query layer below, not by convention.

CREATE TABLE field_source (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity       TEXT NOT NULL CHECK (entity IN
                 ('item','capture','release','release_track','work','performance','composer','raw_value')),
  entity_id    INTEGER NOT NULL,
  field        TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('shelf','discogs','musicbrainz','legacy','guess')),
  confidence   REAL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  -- A confirmation must say who did it: an unattributed confirmation
  -- is indistinguishable from a script marking its own homework.
  CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
  UNIQUE (entity, entity_id, field)
);
CREATE INDEX field_source_lookup ON field_source(entity, entity_id);
CREATE INDEX field_source_source ON field_source(source);

-- Raw values that have no home in the four-entity model YET: AI
-- guesses, and legacy spreadsheet columns like `musicians` or a
-- free-text track listing that M3 will resolve into work and
-- performance rows.
--
-- A separate table so they can never be mistaken for a capture or a
-- release field. That confusion is exactly what M0 measured — AI prose
-- sitting in the same column as sourced data, indistinguishable. Here
-- the provenance is carried in field_source (`guess` or `legacy`), and
-- neither is reachable through the decision views.
CREATE TABLE raw_value (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field   TEXT NOT NULL,
  value   TEXT NOT NULL,
  UNIQUE (item_id, field)
);
CREATE INDEX raw_value_item ON raw_value(item_id);

-- ═══════════════════════ the query layer ═══════════════════════
--
-- Anything feeding a cluster, coverage check, sell list or shortlist
-- reads through these views. They are the enforcement point: a guessed,
-- legacy or unconfirmed value is not reachable through them at all.

-- Every value a person has confirmed, from a source worth trusting.
CREATE VIEW v_confirmed_field AS
  SELECT entity, entity_id, field, source, confidence, confirmed_by, confirmed_at
    FROM field_source
   WHERE source IN ('shelf','discogs','musicbrainz')
     AND confirmed_at IS NOT NULL;

-- Items whose release identity is confirmed. Only these may enter a
-- cluster, a coverage check, a sell list or a shortlist.
CREATE VIEW v_decision_eligible_item AS
  SELECT i.*
    FROM item i
   WHERE i.release_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM v_confirmed_field c
                  WHERE c.entity = 'item' AND c.entity_id = i.id AND c.field = 'release_id');

-- Releases reachable for valuation and ranking.
CREATE VIEW v_decision_eligible_release AS
  SELECT r.*
    FROM release r
   WHERE EXISTS (SELECT 1 FROM v_confirmed_field c
                  WHERE c.entity = 'release' AND c.entity_id = r.id);

-- Per-track coverage: which works are owned complete on an eligible
-- item. M4's compilation coverage check reads exactly this.
CREATE VIEW v_eligible_work_coverage AS
  SELECT rt.work_id, i.id AS item_id, rt.completeness
    FROM release_track rt
    JOIN v_decision_eligible_item i ON i.release_id = rt.release_id
   WHERE rt.work_id IS NOT NULL;

INSERT INTO schema_migration (version) VALUES (1);
