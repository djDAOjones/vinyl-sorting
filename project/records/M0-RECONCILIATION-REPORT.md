---
id: M0-RECONCILIATION-REPORT
name: One clean CSV plus a reconciliation report
summary: Produce the single reconciled CSV and a report stating what came from where and what was dropped — the M0 done-when, and the gate on starting M1.
status: todo
milestone: current
order: 8
---
# One clean CSV plus a reconciliation report

The M0 acceptance criterion from the brief: **one CSV plus a
reconciliation report exists, stating what came from where and what
was dropped.**

The report is the artefact that makes the import trustworthy — every
count in it should be reproducible from the frozen inputs. Expect the
totals to move once the backlog is captured and composers resolved;
the report is a record of this pass, not a permanent truth.

**Done when** both files exist and their counts reconcile against the
frozen manifest.
