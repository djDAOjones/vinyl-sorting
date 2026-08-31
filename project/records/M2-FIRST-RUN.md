---
id: M2-FIRST-RUN
name: Run the matcher over all 446 and clear the queue once
summary: The operation, not the code — deployed and run as of 2026-08-31, every row carrying a match_run and 287 sitting in needs-review, so all that remains is a person clearing the queue by keyboard.
status: in-progress
milestone: current
order: 5
---
# Run the matcher over all 446, and clear the queue once

The matcher and the queue are built, gated and verified against live
Discogs. The deployment and the run are done; what remains is a person
clearing the queue.

## Where it stands, measured 2026-08-31

`/api/match-stats` on the deployed Worker: 465 items and **none
unmatched** — every row has a `match_run`. 135 auto-accepted, 287
needs-review, 42 rejected, 1 error. And `reviewed: 0` — nobody has
resolved a single item, so the second half of Done when is the whole
remaining job.

The one error row was never successfully searched, and wants
re-queueing rather than reading as a negative.

Migration 004 was applied to production on 2026-08-31, so the `vision`
source PHOTO-PROMOTE writes now exists there: schema 4, with all 4,734
provenance rows, 465 items and 98 photographs intact across the
`field_source` rebuild and every decision view recreated. The gap this
record noted is closed; what is left here is only the keyboard.

Re-running is resumable by construction — `pendingRows` selects only
items with no `match_run`, so a batch that dies costs one batch.

Expect most of the 141 backlog rows NOT to auto-verify: label is
captured on 0% of them, so a catalogue number is usually the only
signal and the gate correctly refuses a single family. Those rows want
capture, not matching. That is what M1's capture screen is for, and it
is the honest reading of the 9% error rate.

**Measured on a 60-row live sample (2026-08-30), after the throttling
fix:** 4 auto-verified, 36 needing review, 20 nothing found, 0 errors,
284 queries — 4.7 per row. The same sample before the fix reported 53
"nothing found", every one of them a swallowed rate-limit error, so
treat any large no-match count as a bug until proven otherwise.

**Done when** every one of the 446 has a `match_run` — met — and the
review queue has been cleared once by a person.
