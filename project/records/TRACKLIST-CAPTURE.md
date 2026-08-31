---
id: TRACKLIST-CAPTURE
name: Capture tracklists — from Discogs first, from photographs only where that fails
summary: release_track has held zero rows since M1 because the Worker's getRelease is never called, so the tracklist Discogs already returns for every accepted match is fetched, scored and discarded — and a tracklist is the field that says what a pressing actually is when a catalogue number is shared, which is exactly the tie the corroboration gate cannot currently break.
status: open
date: 2026-08-31
milestone: current
order: 5
---
# Capture tracklists

The maintainer's point, 2026-08-31: tracklists are what settle which
pressing a record actually is, published metadata is often wrong about
them, and the collection cannot be grouped by work without them.

All true, and the cheap half is already paid for.

## Three separate things, in cost order

### 1. Store what Discogs already gives us — nearly free

`release_track` has held **zero rows since M1**. `DiscogsClient` has a
`getRelease` method that the matcher has never once called: the search
rungs return catalogue number, label and title, and the release
endpoint returns the tracklist, but only search is used.

So the cost is **one extra request per newly accepted release** — not
per row, not per query. Against a ladder already spending 9-12 requests
a row, that is noise, and it fills the table M3 and M4 both read.

Positions and durations come with it. `duration_s` and `position` are
columns that have never had a value.

### 2. Use the tracklist as a corroboration signal — cheap, once (1) exists

The gate counts independent signal families: catno, label, name, title,
format, year. A tracklist is a seventh and a strong one — two pressings
sharing a catalogue number differ by what is on them, which is
precisely the tie the gate currently cannot break and the reason it
refuses a single-family verdict.

Wants care: comparing classical tracklists is a normalisation problem
of its own — movement titles, opus numbers, translated names — and that
is [[NAMES-CANONICAL]] territory. A naive string compare would report
disagreement between two correct listings of the same record.

### 3. Read the tracklist off a photograph — expensive, and only where 1 and 2 fail

The sleeve back carries it, and the capture flow is already
photographing sleeve backs: `452-1.jpg` shows a full listing with side
divisions. So the pixels exist.

But this is the costly path and it is a fallback, not a plan: it is
worth building only for releases Discogs has wrong or does not have,
and nobody yet knows how many those are. Doing (1) first MEASURES that
— a release whose stored tracklist disagrees with the sleeve is the
population this would serve.

## Why the order matters

Building (3) first would be reading from photographs what a free API
call already answers correctly most of the time, and with no way to
tell which times those are.

**Done when** an accepted match stores its tracklist, and the number of
releases Discogs has no tracklist for is a measured figure rather than
a guess.
