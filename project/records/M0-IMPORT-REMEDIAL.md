---
id: M0-IMPORT-REMEDIAL
name: Import 141 remedial rows, drop 210 placeholders
summary: Import the 141 real Remedial rows as needing capture and drop the 210 empty placeholder rows, counting both in the reconciliation report rather than deleting silently.
status: todo
milestone: current
order: 5
---
# Import 141 remedial rows, drop 210 placeholders

The Remedial sheet holds 141 real records that were never fully
captured and 210 empty placeholders. The placeholders are noise; the
141 are work.

Dropping is fine, dropping silently is not — the report states the
count and the rule that identified them, so the decision is auditable
if the numbers later look wrong.

**Done when** 141 rows exist in a needs-capture state and the 210
dropped rows are accounted for in the report.
