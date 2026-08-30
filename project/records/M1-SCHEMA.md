---
id: M1-SCHEMA
name: D1 schema and the M0 dataset loaded into it
summary: Build the four-entity D1 schema from brief section 03 with field_source provenance enforced in the query layer, and load M0's 446 reconciled rows into it.
status: todo
milestone: current
order: 1
---
# D1 schema and the M0 dataset loaded into it

Brief section 03: `item` / `release` / `performance` / `work` as four
linked entities, plus `capture` (what a human read, never
machine-written), `field_source` for provenance, and the match,
cluster and session tables that M2–M5 will fill.

Two things must be true from day one, both from the brief:

- **Genre-neutrality.** `composer_id`, `work_id`, `performance_id`,
  `conductor` and `catalogue_ref` are all nullable. A house 12" is a
  valid item with a release and no work at all.
- **The provenance rule lives in the query layer**, not in
  convention. A `guess` or `legacy` value, or an unconfirmed
  `discogs` one, may be selected for display and must be unreachable
  from anything that feeds a cluster, coverage check, sell list or
  shortlist.

D1 is SQLite, so the schema is testable locally with Node's built-in
`node:sqlite` — no emulator, no deploy, no account.

**Done when** the schema applies clean, M0's 446 rows load into it
with their provenance intact, and a decision-eligible query returns
nothing.
