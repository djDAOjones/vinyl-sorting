---
id: CAPTURE-MERGED-ROWS
name: Two discs photographed into one row — split 453 and 455
summary: Item 453 carries twelve photographs of at least two different records — Ace of Clubs ACL 45 and Music for Pleasure MFP 2024 — because nothing between shots said "this is a new disc", and 455 shows the same signature; the rows need splitting by a person who can see which photograph belongs to which disc, and the reading that found it should not be promoted until they are.
status: open
date: 2026-08-31
milestone: current
order: 4
---
# Two discs in one row

The first full reading of all 18 photographed records found two rows
carrying more than one catalogue number:

- **453** — twelve photographs. `ACL 45; MFP 2024`, and two labels:
  Ace of Clubs (Decca) and Music for Pleasure (EMI). `453-1.jpg` is the
  MFP sleeve; `453-11.jpg` is a Tchaikovsky *Francesca da Rimini* under
  Golschmann, which is the Ace of Clubs disc. The title field carries
  the works of both.
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
twelve arrived in one capture with one `clientId`.

Mechanically it is a new `item`, its `item_photo` rows repointed, and
the reading re-run for both halves. `item_photo` has no ON DELETE
restriction that blocks this, and no photograph need be re-taken.

**Do not promote 453 or 455** into `raw_value` until they are split.
Promoting a two-disc reading gives the matcher a catalogue number from
one disc and a title from another, which is a corroboration failure
manufactured on purpose.

**Done when** 453 and 455 each describe one disc, and both have been
read again.
