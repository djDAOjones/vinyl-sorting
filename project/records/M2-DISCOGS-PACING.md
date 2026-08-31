---
id: M2-DISCOGS-PACING
name: Tune Discogs pacing — 7 of 12 queries still fail in the Worker
summary: A richer reading costs 9.4-12 queries against capture-only's 4.7, which broke the matcher three ways — Discogs throttling, Cloudflare's per-invocation subrequest cap and a row selected twice; all three are fixed and the interval now learns its own level from the refusal rate rather than being tuned by hand, backing off entirely when a tick reaches nothing.
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

**What was wrong**: the limiter had no minimum spacing, so a Worker
spent its per-minute allowance as an instant burst. Discogs cares about
burstiness; a laptop hides it because the round-trip paces the calls.
Now 30/min AND at least the learned gap apart. The local runner managed
446 rows with zero failures at ~1.25s while the Worker still fails at
2s — the shared egress IP does make Discogs stricter.

## Measured — 2026-08-31, on 16 promoted photo readings

**A richer reading makes the pacing worse, and that was the finding.**
M2-FIRST-RUN measured 4.7 queries per row on capture-only data; a
promoted vision reading supplies label, title and name as well, so the
ladder walks **9.4 to 12**. Every extra signal that makes a match more
likely also makes the row cost more to try. Of 11 rows attempted, 5
errored.

Three faults, only one of them Discogs:

- **Throttling**, arriving sooner because each row spends twice the
  requests.
- **Cloudflare's per-invocation subrequest cap** — not a Discogs limit
  at all, and one that widening the interval cannot relieve. Twelve
  queries at up to four attempts each reach it before Discogs refuses.
- **A row selected twice.** Item 451 collected two runs minutes apart:
  `pendingRows` excluded rows that already had one, but the run was
  written after the search, so a row outlasting the cron period was
  still in flight when the next tick chose it.

## It paces itself now — 2026-08-31

The three fixes above landed and the interval was tuned by hand three
times in one day, which is the tell: the tick already knows how many of
its queries were refused, and that was the only input the tuning ever
used.

- **The interval is learned, not set.** Widens 1.5x past a 5% refusal
  rate, narrows 0.9x on a clean tick, never below the shipped floor.
  Simulated against an upstream refusing under 5s it reaches 4.9s in
  seven ticks and holds at a 2% refusal rate.
- **The threshold is 5%, not 30%.** The first version tolerated 30% and
  converged — to 4.5s and a permanent 10% refusal rate. Converged and
  wasteful. A tolerance for refusals is a standing order for traffic
  that returns nothing.
- **A tick that got nothing stops asking** for two cron periods. When
  Discogs is refusing, a further request is one that will also be
  refused: it spends the subrequest budget, spends the shared window,
  and returns nothing.
- **The manual key stays widen-only** and the learned one may move both
  ways; the wider of the two is enforced. So a person can always slow
  the matcher and never speed it past the floor.

**Done when** a freshly captured record matches with no failed queries,
and no item carries two runs from one pass. The pacing no longer needs
a person, so what remains is watching whether it holds.
