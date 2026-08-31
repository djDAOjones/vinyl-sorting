---
id: DATASET-VIEWER
name: A third screen that lists the whole collection, with photographs and provenance
summary: 465 catalogued items cannot be seen anywhere in the app — capture only writes and the review queue shows one match at a time — so this is the browse screen: a filterable list, an item detail with its photographs, and every field labelled with where the value came from and whether a person has confirmed it.
status: open
date: 2026-08-31
milestone: current
order: 7
---
# A third screen that lists the whole collection

The app has two screens and neither answers "what is in the
collection?". Capture writes and forgets; the review queue shows one
match at a time and drops the item once resolved. 465 rows are live in
D1 and the only way to see them is `GET /api/items` in a browser tab.

That is the immediate cost. The larger one is that nothing shows *why*
a row looks the way it does — 287 items sit in needs-review, and nobody
can see whether the capture text behind one is a clean reading or the
label mashed into the catalogue number, which the brief records as the
state of the backlog.

## The list

One row per item, keyset-paged as `/api/items` already
does. Columns: id, catalogue number, label, name, title, crate and
position, match state, and a provenance mark. Filter by match state
(auto-accepted / needs-review / rejected / unmatched), by whether a
photograph exists, and by free text over the capture fields. Sort by id
or by `last_verified_at`.

Filtering is client-side: the whole collection fits one fetch at
`limit=500`, and a filter that costs a round trip is a filter nobody
uses. That stops being true past the later batch, and the endpoint is
already paged for it.

## The detail

Everything `GET /api/items/:id` already returns — item, captures,
photographs, provenance — plus the photographs
actually rendered, which needs the one Worker route that does not exist
yet: `GET /api/photos/:key`, streaming the R2 object back. R2 has no
public bucket URL here and should not get one.

Alongside it, the match history: every `match_run`, the candidates it
weighed, and the `review_decision` if one exists. The review queue
shows this once and throws it away; it is what makes a wrong match
explicable a month later.

## Provenance is the point

Every field carries its `field_source` row, shown as a mark rather than
a column of jargon: read at the shelf, from Discogs, read off a
photograph (`vision`, migration 004), legacy import, guess — and
separately, confirmed by a person or not. The distinction is the whole
project. A `guess` and a `shelf` value are indistinguishable in every
spreadsheet this replaces, and 9% of existing Discogs matches are
provably wrong because a catalogue number was read as a verdict.

Unconfirmed values are displayed, which the provenance rule expressly
permits, and are visibly unconfirmed.

## Out of scope

No editing — that is DATASET-EDIT, which this exists to make possible.
No release, work or performance editing: M3 has not built that model.
No `decision` field (keep / sell); that is M5's outcome, and setting it
here would let a verdict be reached without listening.

## A latent bug in the endpoint

`GET /api/items` LEFT JOINs `capture` without aggregating, so an item
with two capture rows returns twice. One-per-item holds today and
nothing enforces it — aggregate to the newest `captured_at` while this
screen is being built, not after a duplicate teaches it.

## Verified by

`npm run gate`. Worker tests for the photo route and the enriched item
payload in `worker.test.mjs`; the screen is DOM assembly with no logic
worth a harness, in the shape of `review.ts`. A third Vite input,
`browse.html`; Cloudflare drops the `.html`, so `/browse`.
