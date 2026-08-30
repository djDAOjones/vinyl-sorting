---
id: M0-IMPORT-ENRICHED
name: Import the 305 enriched rows as unverified
summary: Import the 305 enriched records from Vinyl Records Record 2 Jen.xlsx with every Discogs-derived field marked unverified, so none of them can feed a decision before re-verification.
status: todo
milestone: current
order: 4
---
# Import the 305 enriched rows as unverified

Every Discogs-derived field arrives marked `unverified`. 26 of 277
existing matches are provably wrong and 16 of those are labelled
"Exact", so the existing confidence labels carry no information and
must not be imported as if they did.

These rows are the input to M2's first production run, which
re-verifies all 446.

**Done when** 305 rows exist with Discogs provenance and unverified
confirmation state.
