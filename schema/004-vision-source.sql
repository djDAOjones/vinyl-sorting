-- SPIKE-PHOTO-TO-FIELDS: a value read off a photograph.
--
-- The spike named this as a decision it would feed, and the maintainer
-- took it on 2026-08-31: a photo reading gets its own provenance rather
-- than being filed as `guess`.
--
-- Why not reuse `guess`: the legacy AI values M0 imported were found to
-- be fabricated outright — invented ratings sitting indistinguishably
-- beside sourced data, which is most of why this project exists. A
-- reading taken off a photograph of the actual disc is evidence of a
-- completely different kind. Filing both as `guess` would make them
-- indistinguishable exactly where the difference matters: deciding
-- whether a value is worth showing a person to confirm.
--
-- THE PROVENANCE RULE IS UNAFFECTED, and by construction rather than by
-- care: `v_confirmed_field` allow-lists ('shelf','discogs',
-- 'musicbrainz'), so a new source is unreachable through every decision
-- view the moment it exists. Adding a value cannot open a hole here;
-- only editing that view could, and this migration does not touch it.
--
-- A table rebuild, because SQLite cannot ALTER a CHECK.

-- The views read field_source, and SQLite revalidates every view when
-- the schema changes — so dropping the table underneath them fails with
-- "no such table" pointing at the view rather than at the DROP. They go
-- first and are recreated verbatim below.
DROP VIEW IF EXISTS v_eligible_work_coverage;
DROP VIEW IF EXISTS v_decision_eligible_release;
DROP VIEW IF EXISTS v_decision_eligible_item;
DROP VIEW IF EXISTS v_confirmed_field;

CREATE TABLE field_source_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity       TEXT NOT NULL CHECK (entity IN
                 ('item','capture','release','release_track','work','performance','composer','raw_value')),
  entity_id    INTEGER NOT NULL,
  field        TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN
                 ('shelf','discogs','musicbrainz','legacy','guess','vision')),
  confidence   REAL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  -- A confirmation must say who did it: an unattributed confirmation
  -- is indistinguishable from a script marking its own homework.
  CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
  UNIQUE (entity, entity_id, field)
);

INSERT INTO field_source_new (id, entity, entity_id, field, source, confidence, confirmed_by, confirmed_at)
  SELECT id, entity, entity_id, field, source, confidence, confirmed_by, confirmed_at FROM field_source;

DROP TABLE field_source;
ALTER TABLE field_source_new RENAME TO field_source;

-- Recreated verbatim from 001, allow-list intact.
CREATE VIEW v_confirmed_field AS
  SELECT entity, entity_id, field, source, confidence, confirmed_by, confirmed_at
    FROM field_source
   WHERE source IN ('shelf','discogs','musicbrainz')
     AND confirmed_at IS NOT NULL;

CREATE VIEW v_decision_eligible_item AS
  SELECT i.*
    FROM item i
   WHERE i.release_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM v_confirmed_field c
                  WHERE c.entity = 'item' AND c.entity_id = i.id AND c.field = 'release_id');

CREATE VIEW v_decision_eligible_release AS
  SELECT r.*
    FROM release r
   WHERE EXISTS (SELECT 1 FROM v_confirmed_field c
                  WHERE c.entity = 'release' AND c.entity_id = r.id);

CREATE VIEW v_eligible_work_coverage AS
  SELECT rt.work_id, i.id AS item_id, rt.completeness
    FROM release_track rt
    JOIN v_decision_eligible_item i ON i.release_id = rt.release_id
   WHERE rt.work_id IS NOT NULL;

INSERT INTO schema_migration (version) VALUES (4);
