---
id: CAPTURE-MERGED-ROWS
name: Two discs photographed into one row — split 453 and 455
summary: Item 453 was twelve photographs of two records and was split at photograph 7 on maintainer instruction, giving a new item 466; 455 shows the same signature less certainly and still needs a person to look, and neither may be promoted until its reading describes one disc.
status: open
date: 2026-08-31
milestone: current
order: 4
---
# Two discs in one row

The first full reading of all 18 photographed records found two rows
carrying more than one catalogue number:

- **453 — SPLIT, 2026-08-31.** Twelve photographs, `ACL 45; MFP 2024`.
  The maintainer put the boundary at photograph 7, and the photographs
  agree: `453-6.jpg` is Ace of Clubs ballet notes (Fistoulari, Paris
  Conservatoire), `453-7.jpg` is the Music for Pleasure sleeve front
  (Tchaikovsky *Romeo & Juliet* / *Francesca da Rimini*, St. Louis
  Symphony, Golschmann). Photographs 7–12 moved to **item 466**; both
  rows were re-queued for matching.
- **455** — eight photographs. `M-2314; AM 2314`, both Concert Hall.
  Less certain: a record often prints two numbers, so this may be one
  disc honestly reported. It needs a person to look.

Those two are also the rows with the most photographs — twelve and
eight against a median of five. That is the signature.

## The reader did nothing wrong

It was asked to combine what it could read across all of a record's
photographs, and it did exactly that. Given twelve photographs of two
discs it reported two catalogue numbers rather than choosing one, which
is the correct behaviour under a contract that says refuse rather than
guess. The fault is upstream: the capture flow let two discs become one
row.

## Why it happened, and what stops it

Filing a disc means leaving the viewfinder — **Done**, then **Queue
it** — so a second disc photographed without those two taps joins the
first. CAPTURE-NEXT-DISC puts a control in the camera bar that files
the disc and stays in the camera, which removes the gap this fell
through. This record is the repair; that one is the prevention.

## What splitting needs

A person, because only someone who can see the photographs knows where
one disc ends. Neither the row ids nor the timestamps carry it: all
twelve arrived in one capture with one `clientId`. So
`tools/split-item.mjs` takes the boundary as an argument and reads no
photograph itself.

It deletes nothing: the new item is an INSERT, the photographs move by
UPDATE, no R2 object is touched and nothing is re-photographed. The new
row inherits only what is true of both discs — crate, position, who
captured — because which disc a reading described is the open question.
It refuses outright if a `match_run` on the row carries a candidate or
a human decision, rather than stranding somebody's work against a row
that no longer means what it did.

**Do not promote 453 or 455** into `raw_value` until they are split.
Promoting a two-disc reading gives the matcher a catalogue number from
one disc and a title from another, which is a corroboration failure
manufactured on purpose.

**Done when** 455 describes one disc, and 453, 455 and 466 have all
been read again — the readings on file describe a row that was two
records.
