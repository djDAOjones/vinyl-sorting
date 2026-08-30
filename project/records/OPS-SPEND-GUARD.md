---
id: OPS-SPEND-GUARD
name: Spend guard — cap what a runaway cron can cost
summary: Cloudflare has no hard dollar cap, so the ceiling has to be built: a budget alert to notice, a CPU limit per invocation, and a per-tick write budget in the matcher so a loop cannot bill its way through the night.
status: todo
date: 2026-08-30
milestone: icebox
order: 3
---
# Spend guard — cap what a runaway cron can cost

Cloudflare sells no hard spend cap for Workers or D1. Budget alerts
email you and explicitly do not pause or cap usage; the only real wall
is the Free plan, where D1 returns errors past 100k rows written per
day rather than charging for them. Everything else is a ceiling we
build ourselves.

The exposure is narrow. Of the metered lines, only D1 rows written can
move: $1.00 per million after the 50M/month included on Workers Paid.
Rows read are $0.001 per million and the cron is 288 invocations a day,
so neither will ever register. Reaching $10 means writing roughly 60
million rows in a month — that is not a usage question, it is an
unbounded write loop in the matcher running unattended on a
five-minute schedule.

So the guard belongs in our code, not the dashboard.

## Scope

Settle first, because it decides how much of the rest matters:
**which plan is this account actually on?** On Free the wall already
exists and the work is small. On Workers Paid there is no wall and the
per-tick budget is the only thing standing between a bug and a bill.
Free looks viable — 288 cron ticks a day sit nowhere near the 100k
request limit — but R2 for label photos may force the question.

Then: whether the per-tick ceiling is a fixed number or derived from
the row count, and what the matcher does when it hits it — stop
quietly, or refuse to run again until a human looks.

## Implement

- A budget alert at $10 (Manage Account → Billing → Billable Usage).
  Pay-as-you-go accounts get one by default since June 2026 — check
  before creating a duplicate. It notifies; it does not protect.
- `[limits] cpu_ms` in `wrangler.toml`, which currently has none, so
  every tick may burn the full 30s default.
- A write budget in the scheduled handler: count rows written per
  tick, stop at the ceiling, and say so in the run report rather than
  failing silently. The run report already exists from M2-FIRST-RUN.

Trigger: after the matcher has been over all 446 once. The real write
volume per tick is a measurement then, not a guess, and the ceiling
should be set from it — generously, but from it.

**Done when** the alert exists, `cpu_ms` is set, and the matcher
refuses to exceed its per-tick write budget and reports when it stops
short. ~half a day.
