---
id: M2-EGRESS-IP
name: Discogs throttles Cloudflare's shared egress, so matching cannot run in the Worker
summary: The cron matcher gets 429s from Discogs because Workers egress from shared IPs; matching runs from the maintainer's machine instead, and needs a way to write results back to the live database.
status: todo
milestone: current
order: 6
date: 2026-08-30
flags: sign-off
---
# Matching cannot run inside the Worker

Measured on the live deployment, 2026-08-30. The cron matcher failed
all 12 queries for its first real row with
`throttled by Discogs after 4 attempts`. The same token, from the
maintainer's machine, at the same moment: **HTTP 200,
`x-discogs-ratelimit-remaining: 59`**.

So the account is not throttled — Discogs is rate-limiting by SOURCE
IP, and Cloudflare Workers egress from addresses shared with many
other customers. The central rate limiter cannot help: it correctly
limits *our* usage, and the budget is being spent by strangers.

**What works today.** `tools/match-run.mjs` runs the identical matcher
locally and completed all 446 rows with 0 failed queries. The live app
serves capture and the review queue perfectly well; only the automatic
matching of NEW captures is affected.

**The gap.** A record captured in the app will sit unmatched. The
local runner reads and writes a local SQLite file, so its results have
to reach the deployed D1 — and the existing seed dump cannot be used
for that, because re-seeding would clobber any review decisions
already made in the app.

**Options, needing a decision:**

1. Teach `match-run.mjs` to work against remote D1 directly (via the
   D1 HTTP API and an account API token), so `npm run match` matches
   whatever the app has captured. Most useful, most work.
2. Emit only the NEW `match_run` and `match_candidate` rows as SQL to
   apply with `wrangler d1 execute`. Simple and safe; a manual step.
3. Proxy Discogs through something with a stable IP. Rejected unless
   the others fail — it adds infrastructure to avoid one API's policy.
4. Leave the cron in place and accept that it occasionally succeeds.
   Rejected: intermittent success is worse than a known manual step.

Until this is settled the cron trigger stays deployed and harmless —
it processes 0 rows when there is nothing pending and records an
`error` state, never a false "nothing found", when it is throttled.

**Done when** a record captured in the live app reliably gets matched.
