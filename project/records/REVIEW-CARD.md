---
id: REVIEW-CARD
name: Make a candidate scannable — the sleeve image, and why it scored
summary: The queue asks a person to judge 287 matches and gives them a number to judge with; the sleeve thumbnail Discogs already returns is discarded, and the evidence behind the score renders as undifferentiated chips.
status: open
date: 2026-08-31
milestone: current
order: 3
---
# Make a candidate scannable

Two complaints, one screen, and the fix for the first is nearly free.

## 1. The picture

A Discogs search response carries `thumb` and `cover_image` for every
result. `SearchResult` in `worker/discogs.ts` declares neither, so both
are parsed away and thrown out — while the reviewer, holding a
photograph of a sleeve, is asked to match it against a line of text.

**No new request.** The URL is already in the response we already pay
for. It is stored in the candidate's `signals_json` alongside the
release fields M2-REVIEW-QUEUE put there, and rendered next to the
photographs of the actual disc.

The catch: the 287 runs already in the queue were scored before this
existed and carry no thumbnail. `tools/release-backfill.mjs` is the
precedent for filling them in, and it is rate-limited work — so the
screen must render a candidate that has no image without looking
broken, today and afterwards.

## 2. The reasons

Every candidate shows its families as identical grey chips, so `catno`
and `year` — one nearly decisive, one nearly worthless — read the same.
What a reviewer needs first is: **which fields agree with what I read,
which disagree, and which are simply missing.** A three-state comparison
against the capture values, laid out as a comparison rather than as a
score with footnotes.

The score stays, smaller. It is a summary of the evidence, not a
substitute for it.

## Order

The photograph of the disc outranks all of it, and it is already there —
this record is about what sits beside it.

**Done when** a reviewer can accept or refuse a candidate from the top
of the card, and a candidate with no thumbnail looks deliberate.
