---
id: M2-FIRST-RUN
name: Run the matcher over all 446 and clear the queue once
summary: The operation, not the code — deploy, let the cron matcher work through all 446 rows, then clear the review queue by keyboard.
status: todo
milestone: current
order: 5
---
# Run the matcher over all 446, and clear the queue once

The matcher and the queue are built, gated and verified against live
Discogs. What remains is running them, and that needs a deployment:
`wrangler d1 create`, the schema, the seed, the secret, then the cron
trigger does the rest at 50 requests a minute.

Budget roughly **six queries per row**, so ~2,700 requests, about an
hour of wall clock at the shared limit. It is resumable by
construction — `pendingRows` selects only items with no `match_run`,
so a batch that dies costs one batch.

Expect most of the 141 backlog rows NOT to auto-verify: label is
captured on 0% of them, so a catalogue number is usually the only
signal and the gate correctly refuses a single family. Those rows want
capture, not matching. That is what M1's capture screen is for, and it
is the honest reading of the 9% error rate.

Watch for `state = 'error'` rows: they were never successfully
searched, and must be re-queued rather than read as negatives.

**Measured on a 60-row live sample (2026-08-30), after the throttling
fix:** 4 auto-verified, 36 needing review, 20 nothing found, 0 errors,
284 queries — 4.7 per row. The same sample before the fix reported 53
"nothing found", every one of them a swallowed rate-limit error, so
treat any large no-match count as a bug until proven otherwise.

Extrapolating: ~2,100 queries for the remaining 446, roughly 45 minutes
at the shared limit, and expect a review queue of around 250 items.

**Done when** every one of the 446 has a `match_run`, and the review
queue has been cleared once by a person.
