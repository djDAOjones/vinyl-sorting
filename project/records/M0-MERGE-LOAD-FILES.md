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
