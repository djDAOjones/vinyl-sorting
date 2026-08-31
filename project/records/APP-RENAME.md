---
id: APP-RENAME
name: Set EDIT_TOKEN on the renamed Worker
summary: The move to vinyl-sorter is done and the old script is deleted, but Worker secrets are per-script and EDIT_TOKEN did not come across — so correcting a reading and downloading an export both answer 503 until one command is run.
status: open
date: 2026-09-01
milestone: current
order: 1
---
# Set EDIT_TOKEN on the renamed Worker

The rename itself closed on 2026-09-01. `vinyl-sorter.joe-2d2.workers.dev`
serves all five screens against the same D1, the same R2 and the same
KV — the bindings reference a UUID and a bucket, so nothing moved —
`deep-groove` answers 404, and exactly one cron trigger exists.

`DISCOGS_TOKEN` was set again from the archived token file. **The other
secret cannot be moved by anyone but the maintainer**: its value exists
nowhere but in a person's head and the deleted script, and AGENTS.md
bars a passphrase from being pasted into a session transcript.

Until it is set, `POST /api/items/:id/field`, `POST /api/settings` and
`GET /api/export` all answer 503 — "editing is not configured on this
deployment", which is the honest message rather than a broken one.

    npx wrangler secret put EDIT_TOKEN

## The thing to check afterwards

Every phone re-adds the app from the new URL, and re-types its name:
`localStorage`, the `dg_who` cookie and the IndexedDB capture queue are
all scoped to the hostname. **Anything a phone had queued and unsent at
the moment of the cut was at the old origin and is unreachable.** The
last capture reached D1 at 20:44 on 2026-08-31, so the phone that was
working had signal — that is evidence rather than proof, and it is the
cost the maintainer accepted when choosing a clean cut over a redirect.

**Done when** the secret is set and one edit has been made through the
browse screen.
