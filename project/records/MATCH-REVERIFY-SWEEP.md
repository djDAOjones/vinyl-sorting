---
id: MATCH-REVERIFY-SWEEP
name: When nothing is unmatched, re-verify the oldest rows instead of idling
summary: pendingRows only selects rows with no match_run at all, so the cron tick will start doing nothing the moment the backlog is exhausted — while 9% of the imported matches are known wrong and Discogs keeps improving underneath us.
status: open
date: 2026-08-31
milestone: next
order: 2
---
# Re-verify the oldest, rather than idling

`pendingRows` is `WHERE NOT EXISTS (SELECT 1 FROM match_run …)`. Once
every row has a run, every tick returns nothing for ever.

That is the wrong resting state. M0 measured 9% of existing Discogs
matches pointing at the wrong record, Discogs gains releases weekly,
and a row matched before its label was corrected deserves another look.

## Why this needs a brake, not just a fallback

An unconditional fallback is an infinite loop with a rate limit
attached: every five minutes, for ever, spending the shared Discogs
budget and D1's 100k daily writes on rows nothing has changed about.
So three limits, all of them real:

- **Off by default**, and toggled in Settings — the maintainer asked
  for the toggle in the same breath as the feature.
- **A minimum age.** A row is only re-verifiable if `last_verified_at`
  is older than N days; 180 to start. Nothing is re-asked because it
  happens to sort first.
- **Never a confirmed row.** A release a person confirmed through the
  review queue is settled. Re-running it can only produce a queue item
  contradicting a human decision, which is worse than not running.

Ordering is `last_verified_at ASC`, nulls first — the opposite of the
browse sort, and for the opposite reason: here, never-verified IS the
most urgent.

## The interaction that must not be missed

Every re-verified row that fails to auto-accept lands in the **review
queue**, which is the maintainer's own time. A sweep that quietly
refills a queue somebody is trying to empty is a bug, however correct
each row is. So the sweep is capped per day, and the queue says which
of its items came from a sweep rather than from a first pass.

**Done when** the toggle exists, a swept row is distinguishable in the
queue, and a tick with the toggle off still does nothing.
