---
id: SPIKE-PHOTO-TO-FIELDS
name: Can a label photograph populate the capture fields?
summary: Measure whether reading the stored label photo with a vision model yields usable leads for catno, label, composer, title and year — the cost question is settled at pennies and the provenance question is settled by the existing schema, but accuracy cannot be measured until real labels are photographed.
status: open
date: 2026-08-30
milestone: icebox
order: 3
flags: spike
---
# Can a label photograph populate the capture fields?

Every capture already stores a `label_a` photo in R2 and reads nothing
from it. That photo carries five of the six `capture` columns —
`catno_raw`, `label_raw`, `name_raw`, `title_raw`, `year_raw`. Not
`matrix_runout`: that is etched in the deadwax, which is why `runout`
is its own photo kind, and why it is the one field a label shot cannot
answer.

## Settled without the spike (2026-08-30)

**Cost is not the constraint.** An image costs `ceil(w/28) x ceil(h/28)`
visual tokens, capped at 1568 on a standard-tier model. All 750
records, one photo each, one JSON object out: **~$2.30 on Haiku 4.5**,
~$23 on Opus 5 at full phone resolution, halved again by the Batch API.
Cropping to the label before upload keeps both ends cheap. The whole
collection costs less than one record.

**Where a reading may land is already decided by the schema.** A
machine reading a photo is not `shelf`, and the hard rule forbids
writing back over `capture` — that boundary exists so duplicate
detection runs on what a person read. `raw_value` with source `guess`
is the pre-built home for exactly this, unreachable through every
decision view, and needs no migration. The review queue then promotes a
value when a person confirms it, which is the gesture M2 is already
building.

## What the spike must measure

Per field, over ~20 real labels with typed ground truth: exact match,
wrong, refused. **Refused must beat wrong.** A blank is a non-event; a
confident wrong catalogue number is the 9% error M0 measured, recreated
by a new route.

Run it from `tools/`, laptop-side, the way `match-run.mjs` already
does. That needs no second Worker secret, no test change, and no spend
a stranger can trigger.

## Blocked on

Twenty photographed labels. None exist — the archive holds six crate
shots and no label. Synthesising labels would score the model against
its own output, the same fault as verifying Discogs with Discogs.

## Decisions it feeds

- Whether the Worker gets a second upstream. `worker.test.mjs:62`
  asserts an outbound `fetch(` exists in exactly one file; a vision
  client makes two. Generalise that invariant, never delete it.
- Whether `field_source.source` gains a `vision` value, so a photo
  reading is distinguishable from a legacy AI guess.
- **OPS-SPEND-GUARD is reopened by this.** That decision rests on the
  Cloudflare Free plan being a hard wall. A metered API key has no
  wall, and it arrives through a different door than the paid-plan
  upgrade the decision named as its trigger.
