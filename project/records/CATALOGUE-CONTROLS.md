---
id: CATALOGUE-CONTROLS
name: Sort, filter and choose columns on the collection screen
summary: Browse offers two sorts and three filters over eight fixed columns — enough to look at 483 rows, not enough to ask a question of them — and the two sorts most wanted, value and release date, have no data behind them.
status: open
date: 2026-08-31
milestone: next
order: 1
---
# Sort, filter and choose columns

Asked for: sort by value, sort by release date, choosable columns, a
genre toggle. Three of the four need data the database does not hold.

## What exists, what does not

| Wanted | Where it lives | State |
| --- | --- | --- |
| Release date | `release.year` | Column exists, populated for matched rows |
| Value | `release.lowest_price`, `num_for_sale` | Columns exist, **never written** |
| Genre | — | **No column anywhere** |
| Columns, sorts, filters | client | Fixed at eight |

So the interface work is the small half.

### Value

`lowest_price` comes from the Discogs release endpoint, which
TRACKLIST-CAPTURE now calls once per accepted release — so the field
arrives on the same request already being made, for new matches. The
existing 300-odd need a backfill pass at the pacing M2-DISCOGS-PACING
settled, and prices go stale, so `price_checked_at` (already a column)
has to be shown rather than hidden.

**Sorting by value ranks unpriced rows last, never first.** The same
rule `sort: verified` already follows: absent is not zero.

### Genre

Needs migration 005 and a Discogs field (`genres`, `styles`). Classical
is nearly the whole collection, so the honest use of this is not a
genre column at all — it is a **not-classical toggle**, which is what
the brief means when it says the schema stays genre-neutral while the
v1 interface does not show it.

## The filter the mop-up ruling needs

Maintainer, 2026-08-31: **photographed, read, still unresolved.** The
17 sleeve-only rows get re-shot from the disc, and without a filter
naming them the mop-up crate is assembled from memory. It is a
composition of state the row already carries — has a photograph, has a
promoted reading, has no confirmed release — and it belongs here with
the other saved views rather than in a tool.

## Shape

Filters compose and are nameable. A view is a URL, so it can be
bookmarked and sent — which is also how the mop-up filter gets used
twice without being rebuilt.

**Done when** a saved view survives a reload, value sorts with unpriced
last, and the mop-up crate can be listed from the screen.
