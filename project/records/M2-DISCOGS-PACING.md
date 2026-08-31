---
id: M2-DISCOGS-PACING
name: Tune Discogs pacing — 7 of 12 queries still fail in the Worker
summary: Measured on 16 promoted photo readings — a richer reading costs 9.4-12 queries against capture-only's 4.7, so 5 of 11 rows errored on Discogs throttling or Cloudflare's per-invocation subrequest cap, and one item collected two runs because a row outlasting the five-minute cron period is selected twice.
status: in-progress
milestone: current
order: 6
date: 2026-08-30
blocked-on: nothing — measured 2026-08-31, three faults identified and none yet fixed
---
# Tune the Discogs pacing

Fixed: the deployed matcher reaches Discogs and returns candidates.
Not finished: on its first real row, **7 of 12 queries still failed**
while 5 succeeded. The row reached a correct verdict anyway, but every
failed rung is lost recall — the best match may have been in one.

**What was wrong** (maintainer's diagnosis, confirmed): the limiter
had no minimum spacing, so a Worker spent its per-minute allowance as
an instant burst. Discogs cares about burstiness; a laptop hid it
because the round-trip paces the calls. Now 30/min AND ≥2s apart. The
local runner managed 446 rows with zero failures at ~1.25s while the
Worker still fails at 2s, so the shared egress IP does make Discogs
stricter — not the whole story, and not fatal.

## Done — 2026-08-30

The widen-measure-repeat loop runs without a deploy. The gap is tunable
from KV (`rl:discogs:min-interval`), **widen-only** — an override that
could narrow it would let one typo restore the burst Discogs already
refused us for. `batchSizeFor` derives rows-per-tick from the interval.
Every run records its failures in `queries_json`; runs predating those
fields count as **unrecorded**, never as zero.

## Measured — 2026-08-31, on 16 promoted photo readings

The measurement this asked for, taken on real rows. **A richer reading
makes the pacing worse, and that is the finding.**

M2-FIRST-RUN measured **4.7 queries per row** on capture-only data,
where a catalogue number was usually the only signal. A promoted vision
reading supplies label, title and name as well, so the query ladder has
far more permutations to walk: **9.4 to 12 queries per row**, roughly
2.3x. Every extra signal that makes a match more likely also makes the
row cost more to try.

Of 11 rows attempted: 1 auto-accepted, 3 needs-review, **5 error**.

Two distinct failures, from `queries_json`:

- **`throttled by Discogs after 4 attempts`.** The known fault, now
  arriving sooner because each row spends twice the requests.
- **`Too many subrequests by single Worker invocation`** — new, and not
  a Discogs limit at all. Cloudflare caps subrequests per invocation
  (50 on Free). Twelve queries with up to four retry attempts each can
  reach that before Discogs ever refuses. Widening the interval does
  not help this one; only fewer requests per invocation does.

**A third fault, separate from pacing but caused by it.** Item 451 has
**two** `match_run` rows, 10:50:12 and 10:54:48 — the first died on the
subrequest limit, the second was throttled. `pendingRows` excludes rows
that already have a run, so two cron invocations overlapped: a row
taking longer than the five-minute period is still in flight when the
next tick selects it. Nothing in the schema forbids it —
`match_run` has no unique constraint on `item_id`. Two runs mean two
verdicts for one item and double the requests spent reaching them.

## Still open

Three things, and the order matters because the second and third are
not fixed by the first:

1. **Widen the interval** — the original plan, still worth doing.
2. **Cap requests per invocation**, so the subrequest limit cannot be
   reached: fewer rows per tick, or a shorter ladder when a row already
   has several signals.
3. **Stop overlapping invocations double-processing a row** — claim the
   row before searching rather than after, so a run in flight excludes
   it.

**Done when** a freshly captured record matches with no failed queries,
and no item ever carries two runs from one pass.
