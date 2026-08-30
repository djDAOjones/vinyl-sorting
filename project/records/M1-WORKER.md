---
id: M1-WORKER
name: Hono Worker with named operations and the token as a secret
summary: A Hono Worker exposing only the operations capture needs, holding DISCOGS_TOKEN as a secret it never proxies openly, with central rate limiting ready for M2.
status: todo
milestone: current
order: 2
---
# Hono Worker with named operations and the token as a secret

No sign-in (OPEN-USERS-ACCESS), so the shape of the Worker is what
carries the safety: **named operations, never a general proxy.**
Capture writes, dataset reads, photo upload. No endpoint takes a
caller-supplied Discogs query.

Capture never calls Discogs, so in M1 the token needs no
browser-reachable path at all. It goes in via `wrangler secret` and
stays unused until M2 — at which point auth is revisited before the
matcher ships.

Rate limiting is enforced centrally here and never per caller:
Discogs 50/min shared, MusicBrainz 1/sec with a real user-agent. Build
the limiter now even though nothing calls it yet, so M2 cannot skip
it.

**Done when** the Worker serves the capture and dataset operations
against the D1 schema, rejects anything it does not name, and the
token is present as a secret without any route exposing it.
