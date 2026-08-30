# Deep Groove

Catalogue a classical vinyl collection, verify each record against
Discogs and MusicBrainz, and turn overlapping copies into a finite
queue of listening decisions.

**Live:** <https://deep-groove.joe-2d2.workers.dev>
— capture at `/`, the review queue at `/review`.
The Worker serves both, so the API is same-origin.

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

Two screens: capture at `/`, the review queue at `/review` (Cloudflare
drops the `.html`).
`npm run api -- --demo` seeds a few review items so the queue has work
in it.

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
nothing to paste beside it. It must be a session that has never seen
`data/label-photos/ground-truth.csv` — that is the answer sheet, and a
reading taken with it in context measures nothing.

The zip is the browser fallback: unzip it, drag the images in, paste
`PROMPT.txt`. Uploading the zip whole does not work on claude.ai, which
never passes a zip's contents to the vision path. Either way, then:

```bash
node tools/photo-import.mjs data/photo-packs/reply-01.txt
```

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
```

The token is in `Pre August 2026/Windsurf Projects/`. Until it is set,
the cron matcher logs a warning and does nothing; everything else
works.

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
