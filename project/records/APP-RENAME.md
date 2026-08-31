---
id: APP-RENAME
name: Move the app to vinyl-sorter.joe-2d2.workers.dev
summary: The product was renamed in August and the URL never followed; the Worker name IS the workers.dev hostname, so this is a redeploy under a new name — and the data does not move with it, which is the part wrangler.toml gets wrong.
status: in-progress
date: 2026-08-31
milestone: current
order: 1
---
# Move the app to vinyl-sorter

`wrangler.toml` argues at length that this should never happen, and one
of its three reasons is simply false. Correcting that is most of the
work of deciding.

## What actually moves: nothing

Bindings reference resources, not the script: `database_id` is a UUID,
`bucket_name` an account-level bucket, KV likewise. A Worker of any
name binding them gets the same D1 and the same photographs.

So `wrangler.toml`'s claim that renaming "means a new database and
moving 448 items and 446 match runs into it" is simply wrong, and it
has been the main argument against doing this since 30 August.

## What actually breaks: the origin

Everything the browser scopes to a hostname starts empty at the new
one — home-screen icons, `dg.who` and `dg.edit` in localStorage, the
`dg_who` cookie the photographs need, and **the IndexedDB capture
queue**. That last one has teeth: a phone holding unsent captures has
them at the OLD origin, and nothing at the new one can reach them.

Worker **secrets** are per-script and do not come across either.

## The ruling, 2026-08-31

Maintainer: rename, and **delete the old Worker** rather than leaving a
redirect. No grace period.

Deleting promptly is not only tidiness. The old script keeps its own
`crons` trigger and its own copy of `DISCOGS_TOKEN`, and it binds the
same D1 — so two live Workers would run two matchers against one
database and one Discogs rate limit, racing `claimRow` and doubling the
traffic that M2-DISCOGS-PACING spent three fixes calming down.

## Where it stands, 2026-08-31

Done: `name = "vinyl-sorter"`, built, deployed, `DISCOGS_TOKEN` set,
and verified against the LIVE URL rather than a local build — health,
an item, and a 512 KB photograph fetched with a **cookie**, which is
the request an `<img>` actually makes and the one that caught
BROWSE-PHOTOS out. An unnamed caller still gets 401.

Two things remain, and both are the maintainer's.

**`EDIT_TOKEN` is not set on the new script.** Secrets are per-script,
its value exists nowhere but the old Worker, and a passphrase must not
be pasted into a session transcript to move it. Until it is set,
correcting a reading on the browse screen answers 503 — "editing is not
configured on this deployment", which is the honest message and the
right one. One command fixes it:

    npx wrangler secret put EDIT_TOKEN

**The old script is still running, deliberately.** The plan said delete
it promptly, and the reason was that two live Workers mean two cron
matchers racing one D1 and one Discogs budget. That reason is currently
void: `unmatched` is 0, so `pendingRows` returns nothing and both ticks
do nothing at all.

Which leaves only the argument for keeping it: a phone holding unsent
captures can still drain them to the old origin, and once the script is
gone they are unreachable for ever. The last capture reached D1 at
20:44, so the phone that was working had signal — but that is evidence,
not proof. It costs nothing to leave it up until every phone has been
opened once.

**Done when** `EDIT_TOKEN` is set, the phones have synced, the old
script is deleted, and exactly one cron trigger exists.
