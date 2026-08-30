-- M2-REVIEW-QUEUE: re-verification is a normal operation, not a
-- migration. Every item records when it was last verified and by whom,
-- so anything can be re-queued without special-casing.

ALTER TABLE item ADD COLUMN last_verified_at TEXT;
ALTER TABLE item ADD COLUMN last_verified_by TEXT;

CREATE INDEX item_last_verified ON item(last_verified_at);

-- What a person decided about a run. Separate from `match_run` because
-- the machine's opinion and the human's verdict are different facts,
-- and a later re-run must not overwrite a person's answer.
CREATE TABLE review_decision (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_run_id INTEGER NOT NULL REFERENCES match_run(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  choice       TEXT NOT NULL CHECK (choice IN ('candidate','manual','none','skip')),
  discogs_id   INTEGER,
  decided_by   TEXT NOT NULL,
  decided_at   TEXT NOT NULL DEFAULT (datetime('now')),
  note         TEXT,
  -- A choice that names a release must name which one.
  CHECK ((choice IN ('candidate','manual')) = (discogs_id IS NOT NULL))
);
CREATE INDEX review_decision_item ON review_decision(item_id);
CREATE UNIQUE INDEX review_decision_run ON review_decision(match_run_id);

INSERT INTO schema_migration (version) VALUES (2);
