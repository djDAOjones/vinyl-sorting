---
id: APP-RENAME
name: Move the app to vinyl-sorter.joe-2d2.workers.dev
summary: The product was renamed in August and the URL never followed; the Worker name IS the workers.dev hostname, so this is a redeploy under a new name — and the data does not move with it, which is the part wrangler.toml gets wrong.
status: open
date: 2026-08-31
milestone: current
order: 1
---
# Move the app to vinyl-sorter

`wrangler.toml` argues at length that this should never happen, and one
of its three reasons is simply false. Correcting that is most of the
work of deciding.

## What actually moves: nothing

The bindings do not reference the Worker. They reference the resources:

- `database_id = "59862adc-…"` — a UUID. A Worker of any name binding
  that id gets the same D1, with all 483 items and their match runs.
- `bucket_name = "deep-groove-photos"` — an account-level bucket. Same
  photographs, same keys, no copy.
- KV `id = "3f625375…"` — likewise.

So the file's claim that renaming "means a new database and moving 448
items and 446 match runs into it" is wrong, and it has been the main
argument against doing this since 30 August.

## What actually breaks: the origin

Everything the browser scopes to an origin starts empty at the new one.

- **Home-screen icons** point at the old URL and keep pointing there.
  Every phone re-adds the app by hand.
- **`localStorage`** — `dg.who` and `dg.edit`. Everyone re-types their
  first name, and whoever edits re-enters the passphrase.
- **The `dg_who` cookie**, so photographs 401 until the name is retyped.
- **The IndexedDB capture queue.** This is the one with teeth: a phone
  holding unsent captures has them at the OLD origin, and nothing at
  the new one can reach them. Drain every phone before the cut.

Worker **secrets** are per-script and do not come across either;
`DISCOGS_TOKEN` and `EDIT_TOKEN` are set again on the new name.

## The ruling, 2026-08-31

Maintainer: rename, and **delete the old Worker** rather than leaving a
redirect. No grace period.

Deleting promptly is not only tidiness. The old script keeps its own
`crons` trigger and its own copy of `DISCOGS_TOKEN`, and it binds the
same D1 — so two live Workers would run two matchers against one
database and one Discogs rate limit, racing `claimRow` and doubling the
traffic that M2-DISCOGS-PACING spent three fixes calming down.

## Order

1. `name = "vinyl-sorter"`, deploy.
2. Set both secrets on the new script.
3. Verify against the LIVE URL — health, an item, a photograph — not
   against a local build.
4. `wrangler delete` the old script.
5. README, brief and this file follow the URL.

**Done when** the app answers at `vinyl-sorter.joe-2d2.workers.dev`
with its data intact, `deep-groove` answers nothing, and exactly one
cron trigger exists.
