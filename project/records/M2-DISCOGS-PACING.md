---
id: M2-DISCOGS-PACING
name: Tune Discogs pacing — 7 of 12 queries still fail in the Worker
summary: Spacing requests 2s apart made the deployed matcher work, but a majority of queries still fail, which costs recall; find the rate that holds from Cloudflare's shared egress.
status: todo
milestone: current
order: 6
date: 2026-08-30
---
# Tune the Discogs pacing

Fixed: the deployed matcher now reaches Discogs and returns candidates.
Not finished: on its first real row, **7 of 12 queries still failed**
while 5 succeeded. The row reached a correct verdict anyway, but every
failed rung is lost recall — the best match may have been in one of
them.

**What was actually wrong** (maintainer's diagnosis, confirmed): the
limiter enforced a per-minute budget with no minimum spacing, so a
Worker spent the whole allowance as an instant burst — twelve requests
in a few hundred milliseconds. Discogs enforces a lower rate than it
publishes and cares about burstiness. A laptop hid the fault because
the round-trip paces the calls for you.

Now 30/min AND at least 2 s apart, per the rate that held in the
earlier Windsurf CLI work.

**Both things are true.** Spacing was the bug. But the local runner
managed 446 rows with **zero** failed queries at ~1.25 s spacing, while
the Worker still fails a majority at 2 s — so Cloudflare's shared
egress IP does make Discogs stricter, it just is not the whole story
and is not fatal.

**Next:** widen the interval (3 s, 4 s) and measure failures per row
rather than guessing; consider making `minIntervalMs` configurable so
it can be tuned without a deploy. Keep the batch size matched to it —
four rows at 2 s is already ~40 s of a five-minute tick.

**Done when** a freshly captured record matches with no failed queries.
