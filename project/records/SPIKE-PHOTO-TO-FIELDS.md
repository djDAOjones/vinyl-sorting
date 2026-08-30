---
id: SPIKE-PHOTO-TO-FIELDS
name: Can a label photograph populate the capture fields?
summary: The round trip is built, tested and in the gate — each pack is a directory a session reads in place with no upload as well as a zip for browser chat, the reply imports under id checks, and the scorer keeps refusals apart from wrong answers; twenty photographed labels are now the only thing left, because synthesising labels would score the model against its own output.
status: in-progress
date: 2026-08-30
milestone: current
order: 3
flags: spike, blocked
blocked-on: twenty photographed labels with typed ground truth
---
# Can a label photograph populate the capture fields?

Every capture already stores a `label_a` photo in R2 and reads nothing
from it. That photo carries five of the six `capture` columns — all but
`matrix_runout`, which is etched in the deadwax and is why `runout` is
its own photo kind.

## Built and green

Three commands, no API key: `photo-pack.mjs`, `photo-import.mjs`,
`photo-score.mjs`. **Nothing touches the database**, and a test asserts
it cannot — a spike measures; promoting a reading into the store is the
decision the measurement exists to inform.

Three moves carry the split-label-catno rule, refuse rather than guess:

- **`other_numbers`** gives a number the model can see but cannot
  assign somewhere to go that is not `catno_raw` — a classical label is
  littered with matrix codes, side numbers, opus numbers and (P) years.
- **The prompt forbids inference from knowledge of the recording.** In
  a chat nothing enforces a schema, so those words are the whole guard
  and a test asserts they survive editing.
- **Every row carries its own `row_id`** and an unsent id is refused.
  Twenty images up and eighteen back would otherwise attribute every
  row after the gap to its neighbour — indistinguishable from good data.

Scoring holds `refused` and `wrong` apart rather than averaging them
into a figure that would hide the only question worth asking. A decoy
reported as the catalogue number fails the run on one occurrence: the
M0 error recreated, a number treated as a verdict.

## Two ways in, one contract (2026-08-30)

Maintainer's call: batches of 10, saved to a directory. Each pack is
written twice — `pack-NN/` and `pack-NN.zip`. The directory is the
cheap path: a session reads it in place, so no upload, no dragging and
no per-message cap. `READ-THIS-FIRST.md` carries the task, the ids and
the destination, embedding `chatPrompt` verbatim so the two statements
of one contract cannot drift.

The zip is browser transport only. Uploading it whole does not work —
claude.ai never passes a zip's contents to the vision path.

**Reading in place costs one new guard**: the reader is now on the same
disk as `ground-truth.csv`, and a reading taken with the answer sheet
in context measures nothing — verifying Discogs with Discogs, a third
time. `BLIND_READ` is its own tested constant and no pack may contain
the ground truth, but nothing mechanical can prove a context never
opened a file. A fresh session is the practice.

## What is left

Twenty photographed labels and their typed ground truth, taken the way
capture will get them and including the awkward ones on purpose.
`data/label-photos/README.md` says which, and why twenty. Synthesising
them instead would score the model against its own output.

Cost and provenance are already settled — see the decision log.

## Decisions it feeds

Whether `field_source.source` gains a `vision` value, so a photo
reading is distinguishable from a legacy AI guess; and whether a
hand-run round trip is tolerable at 750 records.
