---
id: SPIKE-PHOTO-TO-FIELDS
name: Can a label photograph populate the capture fields?
summary: The round trip has now run end to end — crate 3, six records read blind and scored — and it fails, but on schema rather than on reading: ten of fourteen wrong values are two documents answering different questions, and the decoy check that the whole spike exists for never ran at all, because `decoy_numbers` was not a column the typed sheet had. Photographs are no longer the blocker; ground truth typed to the scorer's own columns is.
status: in-progress
date: 2026-08-30
milestone: current
order: 3
flags: spike, blocked
blocked-on: ground truth typed to the scorer's columns — `decoy_numbers` above all
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

## The first real run (2026-09-01)

Crate 3 — six records read blind, then scored against a sheet typed at
the crate. `data/photo-runs/opus5-2026-09-01-crate3/`.

**7 exact, 1 refused, 14 wrong: fails.** The number is honest and
measures almost nothing, which is the finding. `notes.md` beside the run
has the breakdown; three things belong here.

**The decoy check never ran.** The sheet had no `decoy_numbers` column,
so nothing could spring the trap — and the report still printed "decoy
numbers reported as catalogue numbers: 0 — must be 0". A report that
cannot tell an untested condition from a passed one is itself a fault.

**Ten of fourteen are schema, not sight** — transcription against
summary, orthography, a column the sheet lacks. Of the four that tested
reading, the reading won three. 487 is the case in miniature: cover
wreath `M. 2316`, disc `AM-2316`, sheet took the sleeve, and the scorer
counted the disc against the decoy.

**The ground truth is a reading too**, and here it was wrong at least as
often as the machine. The scorer treats the sheet as fact by
construction. Whether that survives 750 records is now a live question.

Two harness faults were found by this run and fixed the same day:
`parseChatReply` extracted the array only when the reply did not *start*
with `[`, and a blank skeleton row scored as five wrong answers instead
of reading as untyped. Both now tested.

## What is left

**Ground truth in the scorer's seven columns** — `decoy_numbers` above
all, since without it a run can neither pass nor fail the thing it
measures. Photographs are no longer short: 42 records on disk, 37 read,
and 31 of those from crates 1–2 were read before any answer existed and
are still untyped. They would score today, and they already exceed the
twenty this record asks for.

Half of crate 3 was sleeve-only (484, 485, 488) and 484 has no typed row
at all, so it repeats the crate-2 condition rather than testing the fix.

More testers are coming, which makes two conveniences load-bearing: the
sheet needs the scorer's schema rather than each person's own, and a
reading must name who read it — crate 3 was read by the session that
scored it, which is weaker than a fresh one.

Cost and provenance are already settled — see the decision log.

## Decisions it feeds

Whether `field_source.source` gains a `vision` value, so a photo
reading is distinguishable from a legacy AI guess; and whether a
hand-run round trip is tolerable at 750 records.
