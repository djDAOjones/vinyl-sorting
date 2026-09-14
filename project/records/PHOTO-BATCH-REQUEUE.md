---
id: PHOTO-BATCH-REQUEUE
name: Requeue the 29 newly populated photo entries
summary: Approve clearing the 29 exact empty zero-query matching attempts for items 490–518 so the online matcher can read their newly populated vision fields.
status: open
milestone: current
flags: sign-off
blocked-on: Maintainer approval for deletion under the no-destructive-data rule
date: 2026-09-14
order: 1
---
# Requeue the 29 newly populated photo entries

The photo batch is populated and verified: 30 records, including the new
David Essex item 519 split from 499. Items 490–518 each retain one rejected
attempt made before text existed. All 29 ran zero queries, have no candidate
or human decision, and say “not searchable”. They block the normal
never-matched queue. Item 519 is already eligible for the scheduler.

Exact-ID SQL is prepared at
`data/photo-runs/2026-09-14-fresh-batch/requeue-pending.sql` (ignored).
It requires the original reason, zero queries, null chosen release, and no
candidate or review decision. Before/after snapshots are also held locally.

After approval: recheck those predicates, run the prepared SQL, verify only
those 29 attempts were removed, then let the existing Worker scheduler
match with its central rate limits. Preserve all human capture, photos,
raw readings and provenance. Do not alter schema or matcher settings.
