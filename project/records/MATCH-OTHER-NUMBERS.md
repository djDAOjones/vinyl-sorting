---
id: MATCH-OTHER-NUMBERS
name: Try the other catalogue numbers on the label before giving up
summary: The reading already records every number it can see in other_numbers and no query has ever used one — so a row whose primary number was the wrong guess is refused with its right answer sitting unused in the same JSON.
status: open
date: 2026-08-31
milestone: current
order: 4
---
# Try the other numbers

Maintainer, 2026-08-31, with two worked examples:

- **480** carries `SUA 10639 Mono` behind the stereo number the reading
  picked as primary.
- **469** carries `642 273 GL` behind `GL5840`.

`data/photo-extract.json` holds `other_numbers` for every read row.
Nothing consumes it: not `photo-promote.mjs`, not `photo-import.mjs`,
and not `worker/match/queries.ts`. The alternative is captured, stored,
and never tried.

## Why it is nearly free

The ladder already runs 9-12 queries a row. An extra number adds its
own rungs only **after the primary has produced nothing scored** —
which is exactly the population that currently ends as "not found", so
the cost falls on rows that are currently a dead loss and on no others.

## Why it decides mop-up cases by itself

This is the part worth having. For a sleeve-only row with two candidate
numbers:

- one matches and the other does not → **finished**, and the tie the
  corroboration gate could not break is broken by elimination;
- neither matches → **re-shoot**, and the row has earned its place in
  the mop-up crate rather than being guessed at.

Both outcomes are better than the single answer available now, which is
"needs review" with no way to tell those two cases apart.

## Care

A second number is a second chance to be wrong. It enters as a
**separate signal family instance, never as corroboration of the
first** — two numbers off one label are one label, and treating them as
two families would let a row verify itself.

**Done when** `other_numbers` reaches the matcher, a fallback query
only runs after the primary fails, and a match found on an alternative
number says so in the queue.
