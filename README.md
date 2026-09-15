# Vinyl sorter

Catalogue a classical vinyl collection, verify each record against
Discogs and MusicBrainz, and turn overlapping copies into a finite
queue of listening decisions.

**Live:** <https://vinyl-sorter.joe-2d2.workers.dev>
— a hub at `/`, capture at `/capture`, the review queue at `/review`,
the collection at `/browse`, settings at `/settings`. The Worker serves
all five, so the API is same-origin.

The app's manifest starts at `/capture`, not at the hub: a phone with
the app on its home screen opens straight into the camera, and the menu
is for the desk. Nothing goes between the shutter and Queue it.

The app was called Deep Groove until 2026-08-30, and the URL followed
on 2026-08-31. The D1 database, the R2 bucket and the phone's offline
store still carry the old name on purpose: they are identities rather
than labels, none is visible in the app, and renaming them would mean a
real migration — bindings reference a UUID and a bucket, so the data
never moved when the Worker did. What the rename did cost was the
origin, and it was paid once: every phone re-added its home-screen
icon and re-typed its name, because localStorage, cookies and the
IndexedDB capture queue are all scoped to the hostname.
`wrangler.toml` and `src/queue.ts` say so at the point it matters.

`project/brief.md` is the identity document; `AGENTS.md` is the working
contract; `project/backlog.md` is generated — edit `project/records/`
and run `node tools/gen-backlog.mjs`.

## Run it locally

No Cloudflare account is needed. D1 is SQLite, so the real Worker runs
against `node:sqlite` and the real client talks to it.

```bash
npm install
npm run api     # the real Worker on :8787, in-memory D1
npm run dev     # the capture app on :5173, proxying /api
```

```bash
npm run gate    # tsc --noEmit + the whole test suite
```

Five screens (Cloudflare drops the `.html`; Vite's dev server does not,
so links are written the long way):

| | |
| --- | --- |
| `/` | the hub — four destinations and the counts behind them |
| `/capture.html` | photograph a disc and queue it; always dark |
| `/review.html` | resolve what the matcher could not settle |
| `/browse.html` | the collection, with columns, sorts and saved views |
| `/settings.html` | theme, density, matching, and an export |

`npm run api -- --demo` seeds a few review items so the queue has work
in it, and `DG_EDIT_TOKEN=anything npm run api -- --demo` also turns on
the edit and settings routes locally.

Press <kbd>?</kbd> on any screen for the keyboard shortcuts; `g` then a
letter goes — `h` home, `a` add, `r` resolve, `c` collection, `s`
settings.

The collection screen keeps its whole view in the URL — filters, sort,
columns — so a view can be bookmarked or sent. `?view=mop-up` lists the
discs that were photographed, read, and still have no confirmed
release, which is the crate to re-shoot.

### Lists

The collection is kept in lists — **Classical**, **Selling**, **Dance**,
**General**, and any the household adds; **Neil's** is the tester's — as
one column on one table (`item.list`), not a table per list. Since
migration 006 the lists are data: a `list` table is the authority, the
Worker validates every capture, edit and `?list=` against it, and a new
list is a row, added from the settings screen behind the passphrase and
offered on every screen the moment it exists. Each device keeps the set
it last saw, and the built-in five until it has seen any, so a phone
with no signal can still file a disc.

A selector in the header of every screen, and on the hub with a count
per list, says which list is in view; **All lists** shows everything. It
is a device setting like the theme, so two people can walk two crates at
once. Press `l` to reach it, and the keyboard keeps its place on it when
a screen repaints.

Capture files every disc on the list in view. It asks once per device
which list the crate is on; the choice stays in the header, one tap
away, and never sits between the shutter and Queue it. The review queue
and the collection screen show only the list in view, and the hub's
counts follow it. A disc on the wrong list is moved from its detail on
the collection screen, behind the passphrase, and the move is recorded
as a confirmed `shelf` value with a name on it.

A row with no list — a phone still on the previous build files one — is
**unsorted**: shown as such, counted on the hub, and offered in the
selector while any exist. The rows that existed before the column did
were all classical and were filed that way by the migration; the
imported ones carry `legacy` provenance for it.

`/api/review-queue` and `/api/match-stats` take `?list=<key>` (or
`unsorted`) and refuse any other value; `/api/lists` answers with the
lists and the counts, and `POST /api/lists` adds one behind the
passphrase. A list's key is derived from its label — `Neil's` is
`neils` — and never typed.

**Never rebuild the `item` table on D1.** Every child references it
with `ON DELETE CASCADE`, D1 keeps foreign keys enforced and will not
let a migration turn them off, and a rename rewrites the children to
follow the renamed table — so the usual rename-copy-drop rebuild ends
by cascading through every photograph and match run. Migration 006
moves a column instead; its comment says how.

### Walking a crate

One disc at a time, photographed as many times as it needs. The
crate-in-one-pass mode was withdrawn on 2026-08-31: it wrote one row per
photograph, and more than one photograph is always wanted — label,
sleeve, runout — so a crate walked that way manufactured three discs
where one stood.

**Photograph the disc label, not only the sleeve.** Ruled on 2026-08-31,
after the second crate — items 467-483 — came back sleeve-only. The
sleeve is where the decoys are: a mono and a stereo catalogue number
printed as a pair, an LP number beside a tape number, an export number
beside the domestic one, and adverts carrying the catalogue number of a
different record entirely. Only the disc says which of them is in your
hand. Those seventeen rows stay as they were shot — the discs have been
handled once already — and any the reading cannot positively identify is
mopped up with a disc photograph then, not now.

Type your first name once on a device and it goes on every row captured
there; tap it in the header to hand the phone over.

Capture opens a live camera that takes the whole screen: one tap per
photograph, no "Use Photo" to confirm, and the viewfinder never closes.
In landscape the controls sit on the right-hand edge, where they cost
width rather than the height a phone has little of. **Next disc** files
the disc in hand and keeps the viewfinder open — so a crate is N shutter
taps plus one per disc, and the camera never restarts; a mis-tap is
recallable for five seconds from the toast. **Done** ends the viewfinder
for the form, **Queue it** files from there. The torch button is always offered and tried on the first tap, rather
than gated on a capability report that under-reports on some browsers.
Where the browser refuses — Safari on iOS does — it hides itself and
says what does work: the system torch from Control Centre stays lit
while the camera runs.

The phone's own camera is still one tap away underneath, because a
video frame has no HDR or multi-frame stacking and a catalogue number
printed small may need the better sensor.

Capture asks nothing about a photograph. `Queue it` ends the record. Every
one is stored as kind `other`, meaning "a photograph of this item, not
described", because there is no consistency to describe and any other
value would be an invented fact. Order is kept in the key, since order
is the one thing actually known.

Photos are downscaled to 1568 px before they are queued, so a crate of
twenty is ~16 MB in IndexedDB rather than ~80 MB. And a photo the
server refuses no longer blocks the crate behind it: the drain stops
for a shared failure (offline, 5xx) and moves on past one that is only
about that row (4xx).

## Browse and correct the collection

`/browse` opens on six columns — id, name, title, label, **~value** and
match — filterable by state, by whether a photograph exists, and by free
text. Twenty-five more, catalogue number and crate and photograph count
among them, are a tick away in the column chooser, and any set travels
in the URL. Each of those three falls back in provenance order — what a
person typed, then what was read off a photograph, then (label only)
what Discogs says — and both machine tiers lean, with the tooltip naming
which machine and saying nobody has confirmed it. Only a value a person
stands behind stands upright. Opening one shows every field with **where the
value came from** and whether a person has confirmed it — read at the
shelf, from Discogs, read off a photograph, legacy import, guess, or
nothing recorded at all — plus the match history behind the row: each
run, the candidates it weighed and the verdict if there is one.

Editing is behind a shared passphrase. Click a value to correct it in
place, tick it to confirm it unchanged, or promote a reading taken off a
photograph into the field it belongs to. Every write lands as a
confirmed `shelf` value with a name on it, and none of it makes anything
decision-eligible — only the review queue can confirm a release.

Photographs are listed by key rather than shown: serving one needs a
Worker route a sign-in-free v1 deliberately does not have. Use
`tools/photos-pull.mjs` to fetch them to a desk.

### ~value: what the cheapest copy is asking

`~value` is `release.lowest_price` — the cheapest current listing on
Discogs in GBP. Not a valuation and not what a disc would fetch, which
is what the tilde is for. Three states, and they are different facts: an
em-dash means nobody has looked, `none` means it was checked and nothing
is listed, and a figure over 30 days old is dimmed and dated in place so
a stale market snapshot cannot read as today's.

A new match carries a price for free — it comes off the release request
the tracklist already pays for. Everything matched before 2026-09-14
needs the backfill, and prices go stale, so re-run it:

```bash
node tools/price-refresh.mjs --older-than 30
```

One request per release, paced as everything here is. It writes three
columns on `release` and nothing else — no item repointed, no
confirmation altered. Unlike `release-backfill.mjs` it overwrites rather
than fills gaps, because a price that is never overwritten is a price
that lies.

## Re-verify the existing matches

Audits every row that already claims a Discogs release, asking whether
the evidence actually supports the claim. Releases are cached, so a
second run costs no API calls.

```bash
node tools/reverify.mjs
```

It scores **only values a person supplied**, judged by recorded
provenance. That matters more than it sounds: on the 277 enriched rows
the `label` column came from Discogs, so letting it corroborate a
Discogs match compares Discogs with itself. A first run did exactly
that and reported 1 unsupported out of 277 — a measurement of nothing.

"Unsupported" means *not corroborated by independent human evidence*,
which is not the same as *wrong*. Those rows go to the review queue,
where a person decides.

## Rebuild the M0 dataset

Reads the frozen archive, writes `data/`. The archive is read-only for
the life of the project and is never modified.

```bash
node tools/freeze-archive.mjs --check && node tools/build-report.mjs
```

## Read the labels from photographs — SPIKE-PHOTO-TO-FIELDS

Capture already stores a photo of every label and reads nothing from
it. This packs those photos for a chat window, imports the reply, and
scores it against what a person typed off the same records.

**No API key, by your decision on 2026-08-30.** The reading happens in
a chat you are already paying for, so nothing metered sits behind the
Cloudflare Free plan and OPS-SPEND-GUARD's wall still holds.

```bash
node tools/photo-pack.mjs
```

That writes each pack twice — a directory `data/photo-packs/pack-NN/`
and a `pack-NN.zip` beside it — batched to 10 images, which is under
every chat client's per-message cap. Both hold the images named after
their row ids, a `READ-THIS-FIRST.md`, a `PROMPT.txt` and a manifest.

**The cheap path is the directory, and it involves no upload at all.**
Point a session on this machine at it:

> Read `data/photo-packs/pack-01/READ-THIS-FIRST.md` and do what it says.

That file carries the task, the ids and the destination, so there is
nothing to paste beside it.

**Photograph, read, and only then type what the label says.** A reader
with repository access can open `ground-truth.csv` whatever the prompt
asks, so the order is the guard rather than the promise: the import
records whether an answer already existed for each row, and the scorer
holds those rows out of the bar and names them. Looking it up cannot
produce a pass — only a wasted photograph.

The zip is the browser fallback: unzip it, drag the images in, paste
`PROMPT.txt`. Uploading the zip whole does not work on claude.ai, which
never passes a zip's contents to the vision path. Either way, then:

```bash
node tools/photo-import.mjs data/photo-packs/reply-01.txt
```

If the reading says photographs arrived turned, stand them up and read
those rows again rather than re-photographing — the disc has been
handled once already:

```bash
node tools/photo-rotate.mjs
```

It applies the `rotate_cw` degrees the reading reported, and is
idempotent by ledger rather than by inspection: a corrected photograph
is indistinguishable from one that was always upright, so nothing else
could stop a second run turning it twice.

```bash
node tools/photo-score.mjs
```

Every row carries its own `row_id`, and the importer refuses an id it
did not send. That is the whole point of the ids: twenty images up and
eighteen objects back would otherwise attribute every row after the gap
to its neighbour — nineteen plausible readings, all shifted by one, and
indistinguishable from good data.

The scorer keeps **refused** and **wrong** apart rather than averaging
them. A blank costs a re-read of a photo you already have; a confident
wrong catalogue number is the 9% error M0 measured, arriving by a new
route. A run reporting a decoy number — matrix, stamper, side — as the
catalogue number fails on one occurrence.

Neither tool touches the database, and a test asserts they cannot: a
spike measures, and promoting a reading into the store is the decision
the measurement exists to inform.

It needs ~20 photographed labels first — `data/label-photos/README.md`.

### Getting the photos off the phone

Photograph a crate through the app, then pull them down. No renaming:
each file is named after its item id, which is what ties a reading back
to a record.

```bash
node tools/photos-pull.mjs --limit 20
```

That reads `(item_id, r2_key)` pairs from D1, fetches each object by
name, and writes `data/label-photos/` plus a `ground-truth.csv`
pre-filled from the values you typed into capture — leaving only
`decoy_numbers` to add by hand. It is read-only against production, and
a test asserts it: no write verb, and `get` as the only R2 verb. It
never enumerates the bucket, so no photo-reading route was added to the
Worker, which is what keeps a sign-in-free v1 safe.

**It returns nothing until R2 is switched on.** `[[r2_buckets]]` is
commented out because a binding to a bucket that cannot exist fails the
deploy, so photo uploads currently return 503 and the app keeps them
queued on the phone for ever. Enable R2 once at
<https://dash.cloudflare.com> → R2, then re-run `bash tools/deploy.sh`
— it attaches the binding itself.

## Deploying — needs your Cloudflare account

Everything that can be automated is. Two commands are yours because
they need your login and your credential; the rest is one script.

```bash
npx wrangler login
```

```bash
bash tools/deploy.sh
```

That creates the D1 database, the R2 bucket and the KV namespace,
writes their ids into `wrangler.toml`, applies both migrations, loads
the dataset, deploys the Worker and publishes the client. It is
idempotent — if it fails halfway, run it again.

Then the one step I will not automate, because storing a credential is
yours to do:

```bash
npx wrangler secret put DISCOGS_TOKEN
npx wrangler secret put EDIT_TOKEN     # the browse-screen passphrase
```

The Discogs token is in `Pre August 2026/Windsurf Projects/`. Until it
is set, the cron matcher logs a warning and does nothing; everything
else works. `EDIT_TOKEN` is a passphrase you choose: until it is set the
edit routes answer 503, because an unset secret must never read as an
unlocked door. Capture and photo upload stay open either way — an
offline queue in a loft must not acquire a way to fail.

**Already verified locally, so it should not surprise you:** the Worker
bundles at 95 KiB with all three bindings resolving, both migrations
apply through wrangler's own D1 (18 tables, 4 views), and the seed
loads into it — 267 releases, 4,681 provenance rows, 0 decision
eligible. What is untested is only what needs a real account.

## Discogs pacing

Discogs enforces a lower rate than it publishes, and cares how bursty
the traffic is. The limiter therefore spaces requests **at least 2 s
apart** as well as capping them at 30/min — a per-minute budget alone
is spent as an instant burst, which is what a Worker does and what a
laptop hides, because the round-trip paces the calls for you.

The cron matcher works with that pacing, though 7 of 12 queries still
failed on its first live row; tuning is `M2-DISCOGS-PACING`. To match a
batch from here instead, which is faster and currently more reliable:

```bash
node tools/match-run.mjs
```

Resumable — only rows with no `match_run` are selected.

## How no-sign-in stays safe now the matcher exists

v1 has **no sign-in**, by your decision on 2026-08-30. M2 gives the
Worker a live Discogs token and an upstream to call, so the M1
guarantee — no outbound request exists — no longer holds. What replaces
it is stricter about what matters:

- **The matcher runs from a cron trigger, not a route.** There is no
  HTTP entry point to it, so no visitor can make it run or aim a query.
  The query set is a pure function of stored capture values.
- **Nothing served over HTTP can reach Discogs or the token.** A test
  extracts the whole `createApp()` body and asserts it mentions neither
  the token, the client, nor the batch runner.
- **Every upstream call goes through one rate-limited client**, and a
  test asserts that exactly one file in `worker/` makes an outbound
  request.

Deploy to the Pages subdomain rather than a guessable custom domain.


## Recovering rejected and unmatched records

In **Collection**, choose **Not confirmed** and open a record. **Prepare to
resolve** shows the label details available to the matcher, gaps to check,
and the latest search finding. Use **Check / edit label details** to correct
what is legible in the photographs; release metadata is never reused as
matching evidence.

**Queue a fresh search** requires the edit passphrase and a recognised name.
It adds an attempt without deleting history. Cron processes it through the
shared Discogs limiter. Duplicate requests, attempts within five minutes,
and confirmed releases are refused. A running attempt can be retried after
fifteen minutes; an already queued request stays queued. Refresh the record
to see progress. Corrections alone do not trigger a new search.

**Review / link a release** opens the individual record, including rejected
and error attempts. A never-searched record can enter manual review even
without searchable text. Paste an exact Discogs **release** URL or numeric
ID, open it, compare the pressing with the photographs, then confirm. Master
and artist links are refused. Manual linking records your judgement; it does
not fetch release metadata. **Leave unresolved** and **Decide later** retain
an optional note and are accessible through **Include deferred / no match**.

New searches retain their input snapshot and actual attempted queries.
Errors, budget truncation and candidate limits are labelled incomplete and
cannot produce an automatic match. Alternative numbers remain one evidence
family; all automatic matches still require human confirmation before they
feed collection decisions.


Unresolved records automatically gather MusicBrainz evidence below preparation.
Saved results open without unlocking or provider requests. Failed requests retry
after one and six hours, then pause; changed readings queue fresh evidence and a
Discogs retry. Confirmed/auto-accepted records are skipped. Unlock editing for
**Search MusicBrainz** on demand. Candidates remain unconfirmed; compare format,
label, number, credits and package against photographs. Evidence persists under
`_system/source-preparation/` in R2. One record per cron tick shares the central
MusicBrainz lease, spacing and backoff. No catalogue fields change.
