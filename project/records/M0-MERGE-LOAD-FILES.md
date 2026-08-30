---
id: M0-MERGE-LOAD-FILES
name: Merge 83 usable rows from the load-to-add files
summary: Merge the 83 usable rows out of 1st and 2nd load to add.xlsx into the single dataset, de-duplicating against rows already imported.
status: todo
milestone: current
order: 6
---
# Merge 83 usable rows from the load-to-add files

De-duplicate against what M0-IMPORT-ENRICHED and M0-IMPORT-REMEDIAL
already brought in. Matching on repaired catalogue number plus label is
the sane key here; where it is ambiguous, keep both and flag for
capture rather than merging on a guess.

**Done when** 83 rows are merged and the duplicate decisions are
listed in the report.

**From M0-SPLIT-LABEL-CATNO — verify before merging:** the 83 usable
load rows appear to be *already present* in `Classical Remedial` as
rows 59–141. All 83 catalogue strings and all 46 titles match exactly,
in order; only the IDs differ (Remedial renumbered them to 1058+).
2nd load maps to Remedial 59–104, 1st load to Remedial 105–141. If that
holds, this item merges 0 new rows and records 83 duplicate decisions —
and the dataset total is 446, not 529, which is what the brief's "446
already catalogued" says.
