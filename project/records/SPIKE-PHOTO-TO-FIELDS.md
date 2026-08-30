---
id: SPIKE-PHOTO-TO-FIELDS
name: Can a label photograph populate the capture fields?
summary: The round trip is built, tested and in the gate — photos pack into chat-sized zips, the reply imports under id checks, and the scorer keeps refusals apart from wrong answers; twenty photographed labels are now the only thing left, because synthesising labels would score the model against its own output.
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

Three commands, no API key. `photo-pack.mjs` writes chat-sized zips —
20 images, the prompt to paste, a manifest; `photo-import.mjs` reads
the reply back; `photo-score.mjs` judges it. Twenty-five tests, in the
gate. See `data/label-photos/README.md`.

**Nothing touches the database**, and a test asserts it cannot. A spike
measures; promoting a reading into the store is the decision the
measurement exists to inform.

Three design moves carry the rule inherited from split-label-catno —
refuse rather than guess:

- **`other_numbers`** gives a number the model can see but cannot
  assign somewhere to go that is not `catno_raw`. A classical label is
  littered with them: matrix and stamper codes, side numbers, opus and
  K. numbers, timings, (P) years.
- **The prompt forbids inference from knowledge of the recording**, so
  a recognised Karajan cannot supply a catalogue number from memory. In
  a chat there is no strict schema behind the prompt, so those words
  are the whole guard, and a test asserts they survive editing.
- **Every row carries its own `row_id`** and an unsent id is refused.
  That is the failure mode a hand-run trip has and an API call does
  not: twenty images up, eighteen objects back, and without ids every
  row after the gap is attributed to its neighbour — plausible
  readings, all shifted by one, indistinguishable from good data.

Scoring holds `refused` and `wrong` apart instead of averaging them
into an accuracy figure that would hide the only question worth asking.
A ground-truth decoy reported as the catalogue number fails the run on
a single occurrence: the M0 error recreated, a number treated as a
verdict rather than a lead.

## Settled without photographs

Cost is nil — the reading happens in a chat already paid for. The
metered path was priced first (~$2.30 on Haiku 4.5 for all 750) and
then ruled out on its own terms; see the decision log.

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

- Whether `field_source.source` gains a `vision` value, so a photo
  reading is distinguishable from a legacy AI guess.
- Whether a hand-run round trip is tolerable at 750 records, or whether
  a good result argues for revisiting the metered path after all.
