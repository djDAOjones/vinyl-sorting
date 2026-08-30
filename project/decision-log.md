# Decision log

<!-- Append-only, newest first. -->

## 2026-08-28 — DATA-MODEL: four linked records, not a flat row

**Decision:** Model `item` (a disc you own), `release` (a Discogs
pressing), `performance` (a reading) and `work` (the music) as four
linked entities rather than one row per record.

**Rationale:** The existing spreadsheets cannot answer "how many
copies of this symphony do I own, and which is best?" because a flat
row conflates all four. The keep/sell decision belongs to the item;
identity belongs to the release; `work` is what you group by to find
clusters; `performance` is what you compare and what a verdict
attaches to. A conductor field on a flat row does the first two badly
and the last not at all. This conflation is the direct cause of nine
schema generations and five restarts.

**Alternatives:** Keep a flat row with more columns — rejected, it is
the thing that failed. Group by conductor string — rejected, it cannot
distinguish two recordings by the same conductor.

## 2026-08-28 — PROVENANCE: every sourced value carries its origin

**Decision:** Every sourced value carries a `field_source` row naming
its origin (shelf, discogs, musicbrainz, legacy, guess) and its
confirmation state. Values sourced `guess` or `legacy`, and
unconfirmed `discogs` values, may be displayed anywhere but may never
feed a cluster, a coverage check, a sell list or a shortlist until a
person confirms them. Enforced in the query layer, not by convention.

**Rationale:** AI-invented ratings and track listings currently sit in
the same cells as sourced data, indistinguishable. This is the single
rule that lets the AI Works columns be imported safely instead of
discarded, and the rule that stops the current mess recurring.
Convention will not hold it — the query layer will.

**Alternatives:** Discard the AI columns entirely — rejected, some of
it is useful as a starting point. Trust-by-column — rejected, the
corruption is per-cell.

## 2026-08-28 — MATCH-GATE: a catalogue number is a lead, never a verdict

**Decision:** Auto-accept a Discogs match only when score >= 80, at
least two independent signal families agree, and the margin over the
runner-up is >= 25. Reject junk catalogue input before any API call.
Persist the top five candidates and the exact queries used.

**Rationale:** 26 of 277 existing matches point at a different record
and 16 of those are labelled "Exact", because today's rule is `catno
exact → accept`. Catalogue numbers are unique per label, not globally.
The margin test kills the collisions where four records all matched
one release with nothing to separate them.

**Alternatives:** Raise the string-similarity threshold — rejected,
confidence must derive from evidence, not string equality.

## 2026-08-28 — STACK: Cloudflare Pages plus one Worker

**Decision:** Static SPA on Cloudflare Pages building from the GitHub
repo, with a Hono Worker holding the Discogs token, proxying and
rate-limiting both APIs, and running jobs. D1 for data, KV for cache,
R2 for photos, Access for sign-in.

**Rationale:** Two constraints rule out a pure static site: the
Discogs API sends no CORS headers, and a static site cannot hold a
secret. One small server-side component solves both and additionally
enforces one shared rate limit, so two people cataloguing at once
cannot throttle the account.

**Alternatives:** Supabase — reasonable, but free projects pause after
about a week of inactivity, which is wrong for a stop-start project.
Pure static site — impossible, see above.

## 2026-08-28 — REUSE-CLI: port the Windsurf Python matcher, don't rewrite

**Decision:** Port the existing CLI's normalisation ladder, query
permutations, rate limiting and resumable output into the Worker.
Three changes only: MacRoman instead of cp1252, the input sanity
check, and the corroboration gate.

**Rationale:** That logic is already proven against this exact data.
Rewriting it would discard the one component with a track record and
reintroduce bugs already found.

**Alternatives:** Fresh implementation — rejected, no upside.
