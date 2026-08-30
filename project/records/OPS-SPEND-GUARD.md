---
id: OPS-SPEND-GUARD
name: Spend guard — cap what a runaway cron can cost
summary: Cloudflare has no hard dollar cap, so the ceiling has to be built; the code half is in — cpu_ms is capped and the matcher stops at a per-tick write budget and says so — leaving the $10 budget alert and a ceiling set from the first full run's measured volume.
status: in-progress
date: 2026-08-30
milestone: icebox
order: 3
flags: maintainer
blocked-on: the $10 budget alert is a Cloudflare billing action only the maintainer can take; the measured ceiling waits on M2-FIRST-RUN
---
# Spend guard — cap what a runaway cron can cost

Cloudflare sells no hard spend cap. Budget alerts email you and
explicitly do not pause usage; the only real wall is the Free plan,
where D1 errors past 100k rows written per day rather than charging.
Everything else is a ceiling we build.

The exposure is narrow. Only D1 rows written can move — $1.00/million
after the 50M included on Workers Paid. Reaching $10 means writing ~60
million rows in a month: not usage, an unbounded write loop running
unattended on a five-minute schedule. So the guard belongs in our code.

## Done — 2026-08-30

- `[limits] cpu_ms = 10000` in `wrangler.toml`. A tick is milliseconds
  of CPU; its wall time is spent waiting on the two-second Discogs
  spacing, which costs none. The 30s default was 30s of room a runaway
  loop could use.
- `persistRun` returns the rows it wrote; `runMatchBatch` keeps a
  per-tick budget against it and stops **before** a row, never
  part-way through one — a half-written run leaves the item looking
  pending and gets it searched again, paying the rate limit twice. It
  says so in the log when it stops short.

Worth keeping: D1 meters rows **written**, not rows **added**, so the
item update and the provenance upsert each cost a write while adding
no row. A first test counted table sizes and disagreed with the code
by exactly those two; `total_changes()` is what matches billing.

`WRITE_BUDGET_PER_TICK` is **200 and provisional** — this record asks
for the number to be measured, not guessed. Worst case is ~10 writes a
row and four rows a tick, so ~40 on a healthy tick with 5x headroom. A
test asserts that headroom, so dropping it near normal volume fails
loudly instead of silently truncating real work.

## Still open

- **The $10 budget alert** — Manage Account → Billing → Billable
  Usage. Pay-as-you-go accounts have had one by default since June
  2026, so check before creating a duplicate. Maintainer action: it is
  a billing surface, not a repo one.
- **Which plan is this account on?** It decides how much the rest
  matters: on Free the 100k/day wall already exists; on Workers Paid
  there is none.
- **The measured ceiling**, once M2-FIRST-RUN has been over all 446.

**Done when** the alert exists, `cpu_ms` is set, and the matcher
refuses to exceed a measured per-tick budget and reports stopping short.
