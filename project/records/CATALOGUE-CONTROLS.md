---
id: CATALOGUE-CONTROLS
name: Sort, filter and choose columns on the collection screen
summary: The interface half is done — every column sortable and choosable, five named views including the mop-up crate, and the whole view in the URL — and genre shipped as the four lists (FOUR-LISTS, 2026-09-09), so what remains is the one sort that needs data the database does not hold: value, which needs a price backfill.
status: in-progress
date: 2026-08-31
milestone: next
order: 1
---
# Sort, filter and choose columns

Asked for: sort by value, sort by release date, choosable columns, a
genre toggle. Three of the four need data the database does not hold.

## Where it stands, 2026-09-01

**The interface half is done and deployed.** Twenty-two columns, each
declaring how to read and sort itself in one place; any of them
choosable and sortable; five named views; and the whole view — filters,
sort, direction, columns — encoded in the URL, so it can be bookmarked
and sent. Absent values sort LAST in both directions, which is the same
rule the old `verified` sort had to learn: a null is not a small number
and not an early date.

**The mop-up filter exists and is one click.** `/api/items` gained a
`reading_count`, so "photographed, read, still unresolved" is a
composition of state the row already carries, and the crate no longer
has to be assembled from memory.

## What is left, and what each one is blocked on

**Value** needs `release.lowest_price` to be populated. The column has
existed since M1 and has never been written. TRACKLIST-CAPTURE now
calls the release endpoint once per accepted match, so new matches can
carry it for free — the ~300 already matched need a backfill pass at
the pacing M2-DISCOGS-PACING settled, and prices go stale, so
`price_checked_at` has to be shown rather than hidden.

**Genre** shipped as FOUR-LISTS on 2026-09-09 — neither a genre column
nor a not-classical toggle, but the four lists the collection is
actually kept in (classical, selling, dance, general) on `item.list`,
with a selector on every screen. Migration 005 was that one.

**Done when** value sorts with unpriced last.
