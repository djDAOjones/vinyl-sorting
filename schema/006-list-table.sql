-- NEILS-LIST: lists become data, so adding one is a row and not a
-- migration.
--
-- FOUR-LISTS fixed the four names in a CHECK constraint on item.list.
-- The first request after it shipped was for a fifth - a tester's own
-- list - and the archive's crate labels run to thirty, so a list is
-- something this household names as it goes. A CHECK is the wrong
-- shape for that: SQLite cannot change one without rebuilding the
-- table, and item is the table every other table hangs off.
--
-- WHY item IS NOT REBUILT, AND MUST NEVER BE REBUILT ON D1. The
-- children - capture, item_photo, raw_value, match_run, review_decision,
-- score - all say REFERENCES item(id) ON DELETE CASCADE. D1 keeps
-- foreign keys enforced and does not let a migration turn them off, and
-- with them on, ALTER TABLE item RENAME rewrites every child to point at
-- the renamed table (legacy_alter_table does not change that when keys
-- are enforced). The usual rename-copy-drop rebuild would therefore end
-- with DROP TABLE item_old cascading through every photograph and match
-- run in the database. Checked against the SQLite and D1 documentation
-- on 2026-09-11; a test below the schema holds the children through
-- this migration.
--
-- So the column moves instead of the table: add a new column carrying a
-- foreign key to the list table, copy the value across, drop the old
-- column (its CHECK is a column constraint, which DROP COLUMN permits
-- once the index on it is gone), and rename the new column into place.
-- Nothing leaves item, nothing references item_old, nothing cascades.
--
-- Null still means unsorted. The foreign key is ON DELETE SET NULL so
-- that removing a list, if that is ever offered, unfiles its discs
-- rather than refusing or deleting them.

CREATE TABLE list (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

INSERT INTO list (key, label, position) VALUES
  ('classical', 'Classical', 1),
  ('selling',   'Selling',   2),
  ('dance',     'Dance',     3),
  ('general',   'General',   4),
  ('neils',     'Neil''s',   5);

ALTER TABLE item ADD COLUMN list_ref TEXT REFERENCES list(key) ON DELETE SET NULL;

UPDATE item SET list_ref = list;

DROP INDEX item_list;
ALTER TABLE item DROP COLUMN list;
ALTER TABLE item RENAME COLUMN list_ref TO list;
CREATE INDEX item_list ON item(list);

INSERT INTO schema_migration (version) VALUES (6);
