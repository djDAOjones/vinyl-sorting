---
id: PHOTO-CULL
name: Cull photographs that carry no text no other shot carries
summary: Crate 3 took 34 photographs of 6 records and roughly a fifth were re-shoots of the same corner, which cost pack space and reading attention and bought nothing; a proposed rule set keeps one whole-sleeve view for identification plus every shot that is the sole source of some value, and proposes the rest for deletion rather than deleting them, because a cull driven by an extraction lets a bad reading destroy its own evidence.
status: open
date: 2026-09-01
milestone: next
order: 6
flags: detail
blocked-on: RECORD-EDIT-PHOTOS — nothing can show a person the shots they are being asked to drop
---
# Cull photographs that carry no text no other shot carries

Raised by the maintainer on 2026-09-01: drop shots whose text nothing
depends on, but keep a whole-sleeve view because that is what identifies
the record by eye. Rules were left to me; these are proposed, not
settled.

## The evidence

Crate 3: **34 photographs of 6 records**, 5.7 a record. Reading them, at
least seven bought nothing — a second shot of a corner already read.

| record | redundant | what it repeated |
| --- | --- | --- |
| 484 | `484-4` | the `GL25021` corner, already in `484-3` |
| 484 | `484-5` | the title band, already in `484-2` |
| 485 | `485-6` | the `GSTP-8A/S8` corner, already in `485-5` |
| 486 | `486-2` | the HMV logo, on the sleeve and both discs already |
| 488 | `488-6` | the spine, repeating the front's title and label |
| 489 | `489-4`, `489-5` | two crops of the top bar whole in `489-3` |

That is ~20% of the pack, and the cost is not storage. Packs cap at 10
records and 20 images, so redundant shots split a crate across more
packs than it needs, and every one of them is a thing a reader looks at.

## Proposed rules

Keep a photograph if **any** of these holds:

1. **It is the record's whole-sleeve view.** Exactly one, kept always,
   even carrying no text at all — this is the identification-by-eye case
   the maintainer named, and it is what a person recognises a record by
   when the fields disagree.
2. **It is a disc label.** Never culled, ever, and never the last one.
   The disc is the only thing that says which record is in your hand:
   crate 2 came back sleeve-only and could not be identified, and on
   487 the sleeve says `M. 2316` where the disc says `AM-2316`.
3. **It is the sole source of some value** — a number, a name, a year
   that appears on no other shot of that record.
4. **It carries a decoy** — a number that is *not* the catalogue number.
   Counter-intuitive, and the reason is that these are the hardest rows:
   a shot proving `M. 2316` exists is what makes `AM-2316` a judgement
   rather than a guess.

Propose for deletion anything else — specifically a shot whose readable
text is a **subset** of another shot of the same record. Two photographs
of one corner are one photograph.

## The rule that matters more than the rules

**Propose, never delete.** The subset test runs on an extraction, so a
reading that missed a number marks the only shot carrying it as
redundant and destroys the evidence that would have corrected it. That
is the failure mode of the whole idea, and it is silent.

So a cull is a list a person confirms, per record rather than per crate,
and a photograph a reading has already cited is never proposed —
deleting it leaves a claim in the store with nothing behind it. Which
needs a person to see the shots: [[RECORD-EDIT-PHOTOS]], and this is
blocked behind it.

## Cheaper than culling

Most of crate 3's waste was doubled shots taken seconds apart — a second
tap after a first that looked wrong on a phone screen in a loft. Capture
noticing a near-identical frame, while retaking is still free, beats
deleting it later. Not this record's work; the same problem met earlier.
