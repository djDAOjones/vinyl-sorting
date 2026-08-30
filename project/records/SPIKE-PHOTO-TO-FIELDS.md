---
id: SPIKE-PHOTO-TO-FIELDS
name: Can a label photograph populate the capture fields?
summary: The harness is built, tested and in the gate, and the cost and provenance questions are settled — twenty photographed labels are now the only thing between here and an answer, because synthesising labels would score the model against its own output.
status: in-progress
date: 2026-08-30
milestone: icebox
order: 3
flags: spike, blocked
blocked-on: twenty photographed labels with typed ground truth
---
# Can a label photograph populate the capture fields?

Every capture already stores a `label_a` photo in R2 and reads nothing
from it. That photo carries five of the six `capture` columns —
`catno_raw`, `label_raw`, `name_raw`, `title_raw`, `year_raw`. Not
`matrix_runout`: that is etched in the deadwax, which is why `runout`
is its own photo kind, and the one field a label shot cannot answer.

## Built and green (2026-08-30)

`tools/photo-extract.mjs` reads photos and asks a vision model what is
printed on them; `tools/photo-score.mjs` scores the answers against
typed ground truth. Nineteen tests, in the gate. Two commands to run —
`data/label-photos/README.md`.

**The harness touches no database.** Not the schema, not `capture`, not
`raw_value`, and a test asserts it cannot reach sqlite. A spike
measures; promoting a reading into the store is the decision the
measurement exists to inform.

Two design moves carry the rule inherited from split-label-catno —
refuse rather than guess:

- **`other_numbers`** gives a number the model can see but cannot
  assign somewhere to go that is not `catno_raw`. A classical label is
  littered with them: matrix and stamper codes, side numbers, opus and
  K. numbers, timings, (P) years.
- **The prompt forbids inference from knowledge of the recording**, so
  a recognised Karajan cannot supply a catalogue number from memory. A
  test asserts that clause survives editing — it is the only thing
  standing between this tool and an invented value, and one careless
  rewrite from being lost.

Scoring holds `refused` and `wrong` apart instead of averaging them
into an accuracy figure that would hide the only question worth asking.
A ground-truth decoy reported as the catalogue number fails the run on
a single occurrence: that is the M0 error recreated, a number treated
as a verdict rather than a lead.

## Settled without photographs

Cost is not the constraint: **~$2.30 on Haiku 4.5 for all 750**, ~$23
on Opus 5 at full phone resolution, halved again by the Batch API. The
scorer prices from usage the API actually reports, so a run corrects
this arithmetic rather than inheriting it.

Provenance needs no migration. `raw_value` with source `guess` is the
schema's pre-built home for a machine reading, unreachable through
every decision view; the review queue promotes on confirmation.

## What is left

Twenty photographed labels and their typed ground truth, taken the way
capture will get them and including the awkward ones on purpose.
`data/label-photos/README.md` says which, and why twenty.

Synthesising labels instead would score the model against its own
output, the same fault as verifying Discogs with Discogs.

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
