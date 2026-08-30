-- CAPTURE-MANY-PHOTOS: a photograph the app cannot honestly describe.
--
-- Capture now takes as many photographs of a record as it needs, and
-- deliberately does not ask which is which. The maintainer's reasoning
-- (2026-08-30): "there will be no consistency, so any attempt to
-- ascribe information is dishonest and a waste of time." Categorising
-- costs a tap per photo and buys a label that is wrong as often as not.
--
-- The five existing kinds all make a claim — that this is the side-A
-- label, or the sleeve front, or the deadwax. With nobody asserting
-- any of them, storing one would be inventing a fact, which is the
-- failure this project exists to avoid: a wrong value costs more than
-- an absent one, and nothing downstream can tell an assumed `label_a`
-- from a confirmed one.
--
-- So `other` is added, meaning exactly "a photograph of this item, not
-- described". The five specific kinds stay valid for anything that can
-- honestly claim one.
--
-- Done as a table rebuild because SQLite cannot ALTER a CHECK. The
-- rebuild is safe now and will not stay that way: production holds one
-- photo row today.

CREATE TABLE item_photo_new (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id  INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('label_a','label_b','front','back','runout','other')),
  r2_key   TEXT NOT NULL UNIQUE,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Existing rows keep the kind they were given: those were asserted by
-- an interface that asked, so they are evidence rather than guesses.
INSERT INTO item_photo_new (id, item_id, kind, r2_key, added_at)
  SELECT id, item_id, kind, r2_key, added_at FROM item_photo;

DROP TABLE item_photo;
ALTER TABLE item_photo_new RENAME TO item_photo;
CREATE INDEX item_photo_item ON item_photo(item_id);

INSERT INTO schema_migration (version) VALUES (3);
