---
id: DATASET-EDIT
name: Correct a reading and confirm it, from the browse screen
summary: The editable half of browse — fix what was misread, fill the label captured on 0% of the backlog, promote a photo reading, confirm a value already right; every edit lands as a confirmed `shelf` value behind a shared passphrase, and because it writes to `capture` it amends a hard rule in the same commit.
status: open
date: 2026-08-31
milestone: current
order: 8
flags: security
---
# Correct a reading and confirm it

**Signed off 2026-08-31**, amendment and passphrase included. Build as
written. The `security` flag stays because the item touches the write
surface, not because a ruling is owed. Reasoning and rethink triggers:
decision log. Unblocked 2026-08-31: DATASET-VIEWER shipped the list, the
detail panel and the provenance marks this writes through.

Four operations, all on one item, from the detail panel:

- **Correct** a `capture` field — catalogue number, label, name, title,
  year, matrix. In place, per the maintainer's decision of 2026-08-31.
- **Correct** the physical `item` fields: crate, position, media and
  sleeve grade, notes.
- **Confirm** a field already right, changing no value — the cheap,
  common case, and why the screen earns its keep.
- **Promote** a `vision` reading from `raw_value` into the matching
  `capture` field: one tap, "yes, that is what the label says".

## What an edit writes

The value, and a `field_source` row: source `shelf`, `confirmed_by` and
`confirmed_at` set. `insertCapture` writes `shelf` *unconfirmed* —
typing at a crate is not verifying a pressing, and deciding at a screen
that a value is right is what `confirmed_by` was added for. Upsert on
`UNIQUE (entity, entity_id, field)`, as `resolveRun` already does.

Nothing becomes decision-eligible: `v_decision_eligible_item` needs a
confirmed `release_id` on the *item*, which only the review queue
produces. This improves what the matcher searches with; it is not a
verdict.

## It changes a hard rule

AGENTS.md says "Never write back over `capture`"; `001-init.sql` calls
the table "Never machine-written". The reason is that duplicate
detection must run on what a person read rather than on what a bad
match wrote — a bar on *machine* writes. A person fixing their own typo
is the opposite case, but the sentence as written forbids it.

So the boundary is reworded in the same commit — machine writes barred,
human correction permitted — with the schema comment matched and a
decision-log entry carrying the reasoning. Ship without it and the
contract contradicts the code.

**Authorised**, so no longer a stop-and-ask: make the edit, keep it
narrow, and say in the commit that machine writes stay barred.

The cost, accepted with the decision: the previous reading is gone. For
the 446 imported rows it survives in `data/deep-groove-v1.csv`; for app
captures it does not.

## The passphrase

A shared secret, `EDIT_TOKEN`, set with `wrangler secret put` and sent
as a header; the client holds it in `localStorage` beside `dg.who`.
Write endpoints from this record refuse without it, 401.

`POST /api/captures` and the photo upload stay open: an offline queue
must not acquire a way to fail, and adding a record is not the risk
that rewriting 465 is. The repo is public and names the live URL, so
this door is a real one.

Not sign-in, and it does not pretend to be. OPEN-V1-AUTH closed on
2026-08-31 deciding exactly this, so it is the settled shape rather
than an interim one.

## Out of scope

No deletion of items — destructive, and a hard rule. No bulk edit: the
corruption worth fixing in bulk is MacRoman mis-decoding, a one-off
import job with a tested ladder already in `text-repair`, not a thing
to hand-drive 465 times. No release, work or performance editing.

## Verified by

`npm run gate`. Tests: a write refused without the token; an edit
writing a confirmed `shelf` row; a second edit of the same field
upserting rather than duplicating; a `vision` row still absent from
`v_confirmed_field` after promotion, which writes a new `shelf` row
rather than laundering the old one.
