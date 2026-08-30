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
