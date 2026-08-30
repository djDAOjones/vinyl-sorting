---
id: M0-IMPORT-AI-WORKS
name: Import AI Works columns as guess provenance only
summary: Import the AI-generated ratings and track listings tagged source=guess so they can be displayed but can never feed a cluster, coverage check, sell list or shortlist.
status: todo
milestone: current
order: 7
---
# Import AI Works columns as guess provenance only

AI-invented ratings and track listings currently sit in the same cells
as sourced data, indistinguishable. This is the import that the
provenance rule exists to make safe.

Tag every value `source: guess`. The query layer — not convention —
enforces that guessed values never reach a decision. Getting this
wrong reproduces exactly the mess the project is trying to escape.

**Done when** every AI-derived value carries guess provenance and a
query for decision-eligible values returns none of them.
