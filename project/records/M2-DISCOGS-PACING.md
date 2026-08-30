---
id: M2-DISCOGS-PACING
name: Tune Discogs pacing — 7 of 12 queries still fail in the Worker
summary: Spacing requests 2s apart made the deployed matcher work, but a majority of queries still fail, costing recall; the gap is now tunable without a deploy and every run records its failures, so the remaining work is measuring rather than building.
status: in-progress
milestone: current
order: 6
date: 2026-08-30
blocked-on: needs a deploy and a freshly captured record to measure against; the tuning loop itself is now built
---
# Tune the Discogs pacing

Fixed: the deployed matcher reaches Discogs and returns candidates.
Not finished: on its first real row, **7 of 12 queries still failed**
while 5 succeeded. The row reached a correct verdict anyway, but every
failed rung is lost recall — the best match may have been in one.

**What was wrong** (maintainer's diagnosis, confirmed): the limiter
enforced a per-minute budget with no minimum spacing, so a Worker spent
the whole allowance as an instant burst. Discogs enforces a lower rate
than it publishes and cares about burstiness; a laptop hid the fault
because the round-trip paces the calls for you. Now 30/min AND ≥2s
apart.

**Both things are true.** Spacing was the bug, but the local runner
managed 446 rows with **zero** failed queries at ~1.25s while the
Worker still fails a majority at 2s — so the shared egress IP does make
Discogs stricter. Not the whole story, and not fatal.

## Done — 2026-08-30

The loop this item describes — widen, measure, repeat — is now
runnable without a deploy each time round.

- **The gap is tunable from KV**:
  `wrangler kv key put --binding=CACHE rl:discogs:min-interval 3000`.
  **Widen-only.** An override that could narrow the gap would let one
  typo restore the burst behaviour Discogs already refused us for, so
  anything unparseable, narrower than the shipped 2s, or wider than 60s
  falls back to the default. Failing closed costs recall; failing open
  costs the token.
- **The batch follows the gap.** `batchSizeFor` derives rows-per-tick
  from the interval, so widening the gap no longer silently doubles how
  long an invocation runs. At today's 2s it still yields exactly four
  rows, so nothing changes until someone tunes it.
- **Every run records `queriesRun` and `queryErrors`**, inside the
  existing `queries_json` — no migration, and `match-report` already
  reads that column with `json_extract`. The report gained a Pacing
  section: queries run, failed, percentage, and rows with at least one
  failure.

The report counts runs that predate these fields as **unrecorded**, not
as zero failures. All 446 current runs are in that bucket — reporting
them as clean would have manufactured exactly the false green this
item exists to remove.

A test pinned an edge worth keeping: past an ~8s gap a single row costs
more than the 40s tick budget, and the floor of one row deliberately
wins — a tick rounding down to zero rows would stall the matcher for
good. Waiting is not CPU, so a long tick is free against `cpu_ms`; it
only has to finish inside the 5-minute period, which is what caps the
override at 60s.

## Still open

Measurement, which needs a deploy and a freshly captured record. Widen
to 3s, run, read the Pacing table; repeat at 4s if failures persist.

**Done when** a freshly captured record matches with no failed queries.
