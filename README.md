# Deep Groove

Catalogue a classical vinyl collection, verify each record against
Discogs and MusicBrainz, and turn overlapping copies into a finite
queue of listening decisions.

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

## Rebuild the M0 dataset

Reads the frozen archive, writes `data/`. The archive is read-only for
the life of the project and is never modified.

```bash
node tools/freeze-archive.mjs --check && node tools/build-report.mjs
```

## Deploying — needs your Cloudflare account

These are the steps I cannot run: they need your login. Everything
above is already verified locally.

```bash
npx wrangler login
```

Create the database, and put its id into `wrangler.toml` where it says
`REPLACE_WITH_ID_FROM_wrangler_d1_create`:

```bash
npx wrangler d1 create deep-groove
```

Create the photo bucket and the cache namespace, putting the KV id into
`wrangler.toml` likewise:

```bash
npx wrangler r2 bucket create deep-groove-photos && npx wrangler kv namespace create CACHE
```

Apply the schema:

```bash
npx wrangler d1 execute deep-groove --remote --file schema/001-init.sql
```

Generate the seed — it is derived from the committed CSV in one
command, so it is not itself committed — and load M0's 446 rows:

```bash
node tools/load-dataset.mjs --sql && npx wrangler d1 execute deep-groove --remote --file data/seed.sql
```

Store the Discogs token as a secret. It is never committed, and no
route reads it until M2 — a test enforces that.

```bash
npx wrangler secret put DISCOGS_TOKEN
```

Deploy the Worker, then the built client:

```bash
npx wrangler deploy && npm run build && npx wrangler pages deploy dist
```

## One thing to know before M2

v1 has **no sign-in**, by your decision on 2026-08-30. That costs
nothing today because capture never calls Discogs and the Worker makes
no outbound request at all. It stops being free at M2, when the matcher
starts issuing Discogs queries against your live token — `M2-MATCHER`
carries the gate, with the option of keeping matching server-side as a
queued job so "no sign-in" can stay true.

Until then, deploy to the Pages subdomain rather than a guessable
custom domain.
