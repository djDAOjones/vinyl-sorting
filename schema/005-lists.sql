-- FOUR-LISTS: which of the four lists a disc is on.
--
-- The collection is kept in four lists - classical, selling, dance and
-- general - and on 2026-09-09 the maintainer asked for them in the app.
-- ONE COLUMN ON ONE TABLE, not four tables: an item is the same kind of
-- thing whichever list it is on, and every screen, query, export and
-- provenance row would otherwise have to exist four times over. The
-- brief kept the schema genre-neutral so that this day could come; it
-- has, and the change is one nullable column.
--
-- NULLABLE, and null means UNSORTED rather than any list. A capture
-- that did not say which list it belongs on - a phone still running the
-- previous build, or an entry queued before this column existed - lands
-- here as null and is shown as unsorted, which is true. A default would
-- assert a list nobody chose, which is the same fault as a crate
-- answered with filler (2026-08-30). The interface refuses to file a
-- NEW capture without a list; the schema tolerates one so that the
-- offline queue never acquires a way to fail.
--
-- The backfill puts every existing row on the classical list. All 446
-- imported rows came off the two sheets named Classical Master and
-- Classical Remedial, and every disc captured in the app since was
-- captured for the classical project - the other three lists had no
-- way in until now. The imported rows carry legacy provenance for the
-- value, because that is where it came from; the app-captured rows
-- carry none, because nobody asserted it, and the browse screen says
-- "no provenance recorded" for those, which is the honest reading.
--
-- A from-scratch rebuild (deploy.sh on an empty database) applies this
-- before the seed loads, so seeded rows would arrive unsorted; the two
-- statements below are idempotent and can be re-run by hand that day.
-- The live database is not rebuilt, so this is a note, not a fault.
--
-- src/lists.ts carries the same four words for the client and the
-- Worker, and a test holds the two copies together.

ALTER TABLE item ADD COLUMN list TEXT
  CHECK (list IN ('classical','selling','dance','general'));
CREATE INDEX item_list ON item(list);

UPDATE item SET list = 'classical' WHERE list IS NULL;

INSERT OR IGNORE INTO field_source (entity, entity_id, field, source)
  SELECT 'item', id, 'list', 'legacy'
    FROM item
   WHERE import_ref LIKE 'DG-%';

INSERT INTO schema_migration (version) VALUES (5);
