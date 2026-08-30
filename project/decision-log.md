# Decision log

<!-- Append-only, newest first. -->

## 2026-08-30 — CAPTURE-BULK-PHOTOS: a bulk row carries the crate and nothing else

**Decision:** Bulk capture writes one row per photo and carries exactly
three fields to every row — crate, position and who is capturing.
Everything else on the form is dropped. Position auto-increments only
from a number the person typed; blank stays blank. Photos are
downscaled to 1568 px on the long edge before they are queued. And the
drain now continues past a row the server rejects, stopping only when
the failure is shared.

**Rationale:** Promoted out of the icebox ahead of its stated trigger,
on maintainer instruction to bring the photo path forward. That was the
right call on the evidence: M2's remaining work is a deploy and 286
keyboard decisions, both maintainer work, so this was the buildable
item — and the brief names "building the app instead of cataloguing the
records" as the risk that actually matters.

Three sub-decisions carried real weight.

**What carries over is the whole design.** The obvious implementation
copies the form to every row, and that would put one disc's catalogue
number on twenty — nineteen invented values, indistinguishable from
typed ones, which is precisely the M0 error manufactured wholesale
rather than inherited. Crate is where you are standing, position is
countable, and who is capturing does not change between shots. A
catalogue number, a label, a condition grade are each a claim about one
disc. `BULK_CARRIED` is three entries long and a test asserts the other
eight are dropped.

**Position auto-increments only from a typed start.** Photographing in
shelf order genuinely does make positions sequential, so incrementing
is not a guess — but choosing the starting point would be. Type 12
before a crate of twenty and get 12–31; leave it blank and every row
has no position at all. The record asked for a decision rather than a
silent null, and this is one in both directions.

**A bad row must not hold a crate hostage.** The drain used to `break`
on any failure, which is right for one entry and wrong for twenty: a
photo the server refuses would sit at the head of the queue for ever
with the good ones stuck behind it. The split is now by cause — no
status means the fetch never completed (offline, everything behind
fails alike), 5xx is the server or a missing binding (equally shared),
4xx is about that entry alone. Verified in a browser against the real
Worker: a deliberately oversized photo in the middle of a batch of four
came back 413 and stayed `failed` and retrying, while the other three
synced, and the badge read "3 sent · 1 retrying" — a half-uploaded
crate that looks half-uploaded.

Downscaling was the cheap part but not optional: the queue stores raw
Blobs, so a crate of twenty phone frames is ~80 MB in IndexedDB, on a
phone, in a loft, where iOS evicts under storage pressure. 1568 px is
what the chat pack sends anyway, so nothing downstream loses anything.
If the browser lacks the canvas APIs the original is queued unchanged —
losing a capture to a resize is not a trade this app should make.

Nothing in the Worker or the schema changed; `parseCapture` already
accepted a capture with a photo and no catalogue number, and a test
already said so in those words.

## 2026-08-30 — SPIKE-PHOTO-TO-FIELDS: no API keys; the label reading goes through a chat window

**Decision:** No API keys, anywhere in this project. Reading a label
photograph happens by uploading a zip of images to a chat the
maintainer already pays for, and importing the reply. The metered path
— a vision API called from `tools/`, then perhaps from the Worker — is
ruled out, and the tool that implemented it is deleted rather than
parked.

**Rationale:** Maintainer's ruling, given as "no API keys to be used"
alongside the observation that a zip export of images with row ids
would be useful. It is a better fit than the design it replaced, on
three counts the spike had already flagged as costs:

- **OPS-SPEND-GUARD stays intact.** That decision rests on the
  Cloudflare Free plan being a hard wall — D1 refuses writes past
  100k/day rather than charging. A metered API key has no wall, and
  adding one would have reopened a question that is currently closed.
- **The Worker's one-outbound-file invariant survives.** A vision
  client would have been the second file in `worker/` making an
  outbound `fetch(`, against an exact-equality assertion in
  `worker.test.mjs`. Nothing now needs that test generalised.
- **No second secret**, in a v1 that has no sign-in.

**The cost it carries, recorded:** a hand-run round trip has a failure
mode an API call does not. Twenty images go up and eighteen objects
come back, and without ids every row after the gap is attributed to its
neighbour — nineteen plausible readings, all shifted by one, and
indistinguishable from good data. That is why every image is named
after its row id, why the id is repeated in the prompt text, why the
importer refuses an id it never sent, and why it exits non-zero when a
reply names one. The mitigation is not incidental to the design; it is
most of it.

Also uncosted but real: a person now does the uploading, 750 records at
20 per batch. If the readings turn out good, whether that is tolerable
is the next question — and it is the one thing that could argue for
revisiting the metered path.

**Trigger to revisit:** a scored run that passes the bar, plus the
maintainer finding the manual loop tedious enough to price again.

## 2026-08-30 — OPEN-SELL-THRESHOLD: value is never a reason to keep

**Decision:** A copy is kept for musical reasons only. Market value
does not earn a keep, however high. Selling is only attempted above
**£10**; below that the effort is not worth it.

**Rationale:** Maintainer's ruling, asked as "a losing copy turns out
to be worth £80 — sell or keep as an asset?" The answer separates the
two questions the shootout kept entangling: whether the music is worth
having, and whether the object is worth money. Only the first can keep
a record. Deciding it once removes a per-record hesitation from every
session, which is an R5 mitigation — the shootout dies around session
six when each decision reopens the same argument.

The £10 floor is about effort, not worth: listing, packing and posting
a £4 record costs more than it returns.

**Follow-on, unresolved:** what happens to a sub-£10 loser. It is not
sold and not kept, and nothing in the design says where it goes —
donate, charity shop, or a "not worth selling" pile. Small, but it will
come up the first session that produces one, so it is in the wish-list
rather than invented here.

## 2026-08-30 — OPS-SPEND-GUARD: the Free plan is the wall; the write budget is belt-and-braces

**Decision:** Ship the per-tick write budget and ship no CPU limit. The
account is on the **Free plan** (confirmed from the dashboard: 113 of
100,000 requests today, with an Upgrade button), so runaway billing is
not possible — D1 refuses writes past 100k/day rather than charging for
them. `WRITE_BUDGET_PER_TICK` stays at a provisional 200.

**Rationale:** This item was written on the premise that "Cloudflare
sells no hard spend cap", which is true on Workers Paid and moot on
Free. Its own scope note said to settle the plan question first because
it decides how much the rest matters. It did: the wall already exists,
the budget alert is set, and the per-tick budget is now redundancy
rather than the only defence.

The ceiling stays provisional deliberately. The item asked for it to be
measured, and it still should be — but a guessed number costing nothing
while billing is impossible is not worth blocking the item for. A test
asserts its headroom, so it cannot be tightened into a throttle by
accident.

**Cost of getting this wrong, recorded:** `[limits] cpu_ms` was added
here as prudence and made the Worker undeployable on Free — every
deploy failed with code 100328 until it was removed. The lesson is
narrower than "test your config": a guard that blocks shipping is worse
than the risk it guards. The test is inverted to hold that.

**Trigger to revisit:** upgrading to a paid plan. Then the wall
disappears, cpu_ms becomes settable, and the ceiling wants its
measurement.

## 2026-08-30 — DEPLOY: six faults only the real platform could show, and one wrong conclusion

**Decision:** Ship to a Worker serving its own static assets. The
matcher runs from cron, pacing Discogs requests at least 2 s apart.

Live at `deep-groove.joe-2d2.workers.dev` with 446 items, 446 match
runs and 2,045 candidates. Every fault below passed locally:

1. **Remote D1 rejects explicit transactions.** The seed wrapped itself
   in `BEGIN`/`COMMIT`; miniflare accepted it, D1 refused.
2. **`d1 info <name>` resolves through wrangler.toml**, which holds a
   placeholder on a first run — which is why the maintainer's first
   deploy appeared to do nothing. Ids now come from `d1 list --json`.
3. **D1 caps a query at 100 bound parameters.** The review queue bound
   one per run id, so a 200-row page returned 500 in production.
4. **A stored global `fetch` is detached in Workers**, raising "Illegal
   invocation". Node tolerates it; the default is now a wrapper.
5. **KV refuses a TTL below 60 s.** The spacing key wanted 8. The fake
   KV ignored TTLs entirely, so it shipped — a double more permissive
   than the real thing is worse than none, and it now enforces the floor.
6. **The rate limiter had no minimum spacing.** A per-minute budget is
   spent as an instantaneous burst, and Discogs enforces a lower rate
   than it publishes while caring about burstiness.

**A wrong conclusion, corrected.** On seeing 429s from the Worker while
the same token returned 200 from a laptop with 59 requests remaining, I
concluded Discogs was throttling Cloudflare's shared egress IPs and
that no amount of rate limiting could help. The maintainer said the
real limit is lower than published and needs about one request every
two seconds. That was right, and it was my bug: the fixed-window
counter permitted the entire budget instantly. The laptop looked
healthy precisely because its round-trip time paced it.

Both factors are real — the shared IP does make Discogs stricter, since
7 of 12 queries still fail at 2 s where the laptop managed 446 rows
with zero failures — but the dominant cause was mine. Tuning continues
in M2-DISCOGS-PACING.

**The pattern worth keeping:** a suite of 167 tests and a local
emulator caught none of these. Faults 4, 5 and 6 would each have
silently mis-reported records as unmatchable, had the error state built
in M2-MATCHER not refused to call a failed search a negative result.

**R2 stays off.** Enabling it needs a dashboard action the API refuses
and which may ask for payment details, so the binding is optional:
photo uploads answer a retryable 503 and the phone keeps them queued.

## 2026-08-30 — M2-REVIEW-QUEUE: two bugs that only a real browser was going to find

**Decision:** Ship the keyboard-driven queue — 1–5 choose, N none, S
skip, B back, M manual id — with each candidate showing which families
of evidence agreed rather than only a score. Resolving is the ONLY
route to decision-eligibility: the matcher writes `discogs` unconfirmed,
and a person's answer is what adds `confirmed_by`.

**A type-ahead race was mis-filing decisions.** `resolve()` read
`queue[cursor]` and advanced the cursor only after awaiting the write,
so a second keypress during the in-flight request answered the SAME
item twice — and because the write upserts on run id, the second answer
silently overwrote the first while the next item was skipped entirely.
Driving it in a browser produced `POST /review/1`, `/review/2`,
`/review/2`: three keystrokes, two items, one wrong answer recorded and
one item never seen. Someone clearing hundreds of items types ahead, so
this was the normal case. Fixed by capturing the run id before the
await and advancing optimistically, with a rollback that puts the item
back rather than losing it.

**The service worker would have blocked every future deployment.** It
was cache-first for everything same-origin, so once `index.html` was
cached a new build never reached anyone — the stale HTML kept pointing
at the old hashed assets. It was caught because the browser kept
serving a fixed module's old copy back during testing. Now navigations
and HTML are network-first with cache as the offline fallback, and only
content-hashed `/assets/*` are cache-first.

Neither bug was reachable from the test suite as written: one needed
real event timing, the other a real cache. That is the argument for
driving the thing rather than only asserting about it.

**On the done-when.** "The queue can be cleared by keyboard" is met and
was demonstrated. "The 446 have been through it" is not — that is an
operation needing a deployment and about an hour of API time, split out
as M2-FIRST-RUN rather than quietly counted as done.

## 2026-08-30 — M2-MATCHER: the gate works, and the audit nearly marked its own homework

**Decision:** Ship the ported ladder with the three intended changes —
MacRoman repair upstream, an input sanity check before any API call,
and the corroboration gate (score >= 80, families >= 2, margin >= 25).
Matching runs from a **cron trigger, not a route**, which is how "no
sign-in" survives the arrival of a live token: there is no HTTP entry
point to aim, and the query set is a pure function of stored capture
values.

**The audit had to be corrected before it measured anything.** The
first run scored each claimed release against the captured `label` —
but on those 277 rows the label came FROM Discogs, so the label family
always fired and 276 of 277 looked corroborated. That is Discogs
agreeing with itself. Re-run using only values whose recorded
provenance is `legacy` or `shelf`, it reports **12 unsupported**, 4 of
them labelled "Exact". The AGENTS.md rule — verification runs on what a
human read, not on what a bad match wrote — turns out to apply to the
verifier as much as to the data.

**What the gate caught.** A conductor captured as "Kletski" matched to
King Diamond's *Abigail II* on a colliding `2241-2`. `CFP 4016`, a
Classics for Pleasure number, matched to a Fontana pop single and
labelled "Exact". A 1938 Carnatic 78. A 2014 dance compilation. These
are precisely the collisions the margin and family tests exist to
refuse, and the old rule accepted them.

**The brief's figure of 26 cannot be reproduced, and is not claimed.**
It does not say which rows it meant or how they were identified, so
there is nothing to compare against. 12 is what the gate measures on
the evidence available. Reporting 26 would be fitting the number to the
story.

**Where risk remains:** 102 of the 265 supported rows carry no people
evidence at all — catalogue number, title and format only — and 29 of
those have no year either. A generic compilation title plus a colliding
catalogue number clears 80 unaided, so that is where a wrong match is
likeliest to be hiding.

**Alternatives:** Weight the catalogue number higher so more rows
auto-accept — rejected, that is the defect. Keep the label in the
audit — rejected, it is circular and produced a flattering, meaningless
result.

## 2026-08-30 — M1-CAPTURE-UI: the queue is the product, and it was verified in a browser

**Decision:** A single-screen PWA. Every capture is written to
IndexedDB before anything else happens, and the UI never awaits the
network. Sync is a background drain with capped exponential backoff
that never drops an entry. Label and catalogue number are separate
inputs, with the reason printed under them.

**Verified end to end in a real browser, not asserted.** A capture was
entered with no backend running; it queued, was marked for retry
rather than lost, survived a hard refresh with every field intact,
retried four times under backoff, and then synced the moment the
Worker appeared — arriving in the database as crate B4, position 12,
`SXL 6113`, Decca, Solti, VG+, with `shelf` provenance, unconfirmed,
and `decision_eligible` still zero. That sequence is the done-when:
captured with no signal, appears in the collection afterwards.

**Photo-first, so a photo-only capture is valid.** The requirement is
a crate — a session card has to say where the disc is — plus either a
photo or a catalogue number. Walking a crate photographing labels and
typing nothing is the fast, delegable path, and the API and the client
agree on it; a shared test feeds the client's request body to the
Worker's validator.

**Crate and captured-by are sticky.** You work through one crate at a
time, so re-typing it per disc is the single largest avoidable cost.
With no sign-in there is no identity to read, so `captured_by` is a
remembered free-text field — a partial recovery of the "who captured
this" the provenance model wants.

**The app measures itself.** Each entry records milliseconds from
starting the disc to queueing it, and the header shows a running
median. The done-when asks for a measured median under 30 s; the
instrument now exists and reports honestly, but the number will only
mean anything once real discs are captured. Nothing here claims that
threshold has been met.

**Local development needs no Cloudflare account.** `tools/dev-api.mjs`
serves the real Worker over the node:sqlite bindings, so the whole app
runs on a machine with no wrangler login. Deployment does need one and
is a maintainer step; README carries the runbook.

**Alternatives:** Post directly and queue only on failure — rejected,
it makes the offline path the exceptional one and therefore the broken
one. A combined label/catalogue field — rejected, that is the defect
M0 measured at 9%.

## 2026-08-30 — M1-WORKER: with no sign-in, the Worker's shape is the security

**Decision:** Named operations only — health, capture write, photo
upload, item reads, and a decision-eligible count that reads through
the views. Everything else returns 404 "no such operation". No route
takes a caller-supplied upstream query, and **M1 contains no outbound
request at all**.

**Rationale:** v1 has no sign-in, so nothing at the perimeter
distinguishes the maintainer from a stranger who finds the URL. What
does the work instead is the absence of anything worth aiming. The
strongest available form of "no proxy" is not a hard-coded upstream
but no outbound call to hard-code one into, and a test asserts exactly
that: zero bare `fetch(` in the Worker sources. A second test asserts
no route reads `DISCOGS_TOKEN` — the binding is declared so the types
know it exists, and dereferenced nowhere. The token is unreachable,
not merely unused.

This is what makes the no-sign-in decision cost nothing in M1: capture
is a person typing what is printed on a label, so there is no Discogs
path to protect yet. M2 changes that, and M2-MATCHER carries the gate.

**Capture writes are idempotent on a client-generated id.** The
offline queue retries, and a retry must not create a second physical
disc. A replay returns 200 rather than 201 so the client can drop the
queued entry either way without treating success as an error.

**Captured values are `shelf` and unconfirmed.** Reading a label is
not verifying a pressing — M2 confirms. So a freshly captured disc is
decision-ineligible exactly like an imported one, and a test asserts
it.

**A photo-only capture is valid.** Photo-first means walking a crate
photographing labels and typing nothing, so the API requires a crate
(a session card has to say where the disc is) plus either a photo or a
catalogue number — not a catalogue number.

**The rate limiter is built although nothing calls it**, so M2 cannot
skip it, with the shared budgets AGENTS.md fixes: Discogs 50/min,
MusicBrainz 1/sec. A test drives two limiter instances standing in for
two isolates and proves 50 total, not 50 each. The counter store is an
interface because KV is eventually consistent; when M2 needs
exactness, a Durable Object satisfies the same three methods.

**Testable with no Cloudflare account.** D1 is SQLite, so the bindings
are stubbed over `node:sqlite` and the Worker is exercised through
real HTTP requests against the real schema — no wrangler, no emulator.

**Alternatives:** A general `/api/discogs/*` proxy — rejected; with no
sign-in it hands a stranger the maintainer's rate limit and identity.
Per-caller rate limiting — rejected by AGENTS.md, and it cannot work
when callers are anonymous.

## 2026-08-30 — M1-SCHEMA: provenance decides where a value lands, and views decide what may read it

**Decision:** The four-entity schema from brief section 03, with two
enforcement mechanisms rather than conventions.

**The query layer is real code.** Four views — `v_confirmed_field`,
`v_decision_eligible_item`, `v_decision_eligible_release`,
`v_eligible_work_coverage` — are the only route by which anything may
feed a cluster, coverage check, sell list or shortlist. A `guess` or
`legacy` value is unreachable through them *even when marked
confirmed*, and an unconfirmed `discogs` value likewise. Tests assert
both directions: that the loaded dataset yields nothing, and that
confirming one row makes exactly that row appear. A view that is
merely empty proves nothing; this one discriminates.

**A value's destination is decided by its provenance, not its name.**
`label_raw` sourced `legacy` is something a person typed and goes to
`capture`; the same column sourced `discogs` is something a matcher
wrote and goes to `release`. This is the AGENTS.md boundary — never
write back over capture — made structural. Of the 446 rows, 31 labels
reached `capture` (the ones M0 split out of the backlog) and 267
reached `release`.

**Nothing is dropped.** Values with no home in the model yet go to
`raw_value` with provenance intact: 1,248 `guess`, 554 `discogs`
(musicians and track listings on matched rows, homeless until M3
resolves tracks into works) and 528 `legacy`. A first attempt tallied
these by column name and was wrong twice — the 28 track listings M0
reclassified are named like legacy columns and are guessed in truth.
Counting by name would have reproduced, in the statistics, the exact
confusion the provenance rule exists to end.

**Load result:** 446 items, 446 captures, 267 releases across 277
links — 10 items share a pressing with another, which is two copies of
one release and not a duplicate — and 4,681 `field_source` rows. Zero
decision-eligible, which is the done-when.

**Testable without Cloudflare.** D1 is SQLite, so the schema and the
load run against Node's built-in `node:sqlite`: no emulator, no
account, no deploy. The same SQL is what `wrangler d1 execute` applies.

**Alternatives:** Enforce provenance in application code — rejected,
that is the convention the rule explicitly refuses. Drop the values
with no home — rejected, `musicians` and the track listings are M3's
input.

## 2026-08-30 — OPEN-USERS-ACCESS: no sign-in for v1, and the risk is deferred rather than accepted

**Decision:** No sign-in for v1. Two or more trusted people capture,
and the maintainer chose no authentication after being shown that
Cloudflare Access needs no password — an emailed code or a Google
sign-in — and that it is free to 50 users. That is the maintainer's
call and the build follows it. `brief.md` is updated so the identity
document stops claiming Access sign-in.

**The concern, recorded once:** an open URL means anyone who finds it
can read and edit the collection, and any public endpoint that reaches
Discogs does so with a token now confirmed live. The brief also says
"not public, ever". Per-person identity would additionally have told
`shelf`-sourced values who read them off the record.

**Why this costs nothing yet.** Capture does not call Discogs — it is
typing what is printed on a label, offline, into an IndexedDB queue. So
M1 needs no Discogs path reachable from the browser at all. The Worker
gets named operations only, capture-write and dataset-read, rather than
a general proxy; the token stays a Worker secret that no caller can
aim. Deployment goes to an unguessable Pages subdomain.

**Where it becomes live: M2.** The matcher is the first thing that
would let a caller drive Discogs queries. Noted on M2-MATCHER as a
gate: before shipping the matcher, either add Access then, or keep
matching strictly server-side as a queued job with no
caller-controlled query. The second option preserves "no sign-in" and
still closes the quota hole, so this may never need revisiting as an
auth question at all.

**Alternatives:** Cloudflare Access with an email allowlist —
recommended and declined. A shared passphrase — not offered seriously;
it is more friction than Access and weaker.

## 2026-08-30 — OPEN-SYSTEM-OF-RECORD: the app database is authoritative

**Decision:** Confirmed by the maintainer — the app database is the
system of record. Import is one-way: the frozen spreadsheets flow in
once and are never written back. The CSV export to OneDrive is a
readable backup, not a synchronisation contract.

**Rationale:** The alternative makes round-tripping a first-class
problem, and round-tripping between a database and a spreadsheet is
where the previous nine schema generations died. One-way import means
`data/deep-groove-v1.csv` is a handoff artefact rather than a live
mirror, and M1 can load it and forget it.

**Consequences to hold to:**

- Editing moves into the app. A spreadsheet edited after M1 loads is
  not a source of truth, and nothing will reconcile it.
- The export is written for a human to read and for disaster recovery.
  Nothing reads it back in.
- `Pre August 2026/` stays read-only, as it already is.

**Alternatives:** OneDrive stays authoritative — rejected by the
maintainer. It would have required two-way sync, conflict resolution
and a merge story for per-field provenance, none of which a private
household tool should be carrying.

## 2026-08-30 — OPEN-DISCOGS-TOKEN: valid, not a seller, and that costs less than assumed

**Decision:** Keep the existing token. The account will not be made a
seller. Valuation uses lowest asking price, number for sale and the
have/want ratio; condition-graded price suggestions are out of scope.

**Verified, not assumed.** The token authenticates — HTTP 200 on
`/oauth/identity`, account `walter_odington` (id 1149676), 40-char key.
`num_for_sale` is 0 and `/marketplace/price_suggestions` returns 404
"You must fill out your seller settings first", so the account is
definitively not a seller.

**What that actually costs.** Tested against release 7387168, the first
row of the M0 dataset:

- `/marketplace/stats` — HTTP 200. `num_for_sale: 21`,
  `lowest_price: GBP 1.59`.
- `/releases/{id}` — HTTP 200. `community.have: 70`, `community.want:
  13`, `lowest_price: 2.15`.
- `/marketplace/price_suggestions` — 404, seller-only.

So the only loss is "what should a VG+ copy fetch". Lowest current
price, supply and the have/want ratio are all reachable, and have/want
is a better scarcity signal than a price suggestion anyway. An earlier
note in this session claimed a non-seller account could not value a
record at all; that was wrong, and it changes OPEN-SELL-THRESHOLD from
a question about whether valuation is possible into a question about
what to do with the number.

**Handling:** the token was read inside a script and never echoed. It
stays out of the repo, enters the Worker via `wrangler secret`, and the
archived copy remains listed in the manifest without a digest.

**Alternatives:** Fill out seller settings to unlock price suggestions
— rejected by the maintainer, who has never sold and does not intend
to. Mint a fresh token — unnecessary, this one works.

## 2026-08-30 — M0-RECONCILIATION-REPORT: the report is generated from the build it describes

**Decision:** `tools/build-report.mjs` writes both artefacts —
`data/deep-groove-v1.csv` and `data/reconciliation-report.md` — from a
single `buildDataset()` call, and embeds a machine-readable summary
block. The gate asserts those numbers still equal a fresh build, that
the digests the report quotes match `data/archive-manifest.json`, and
that every source row is either imported, dropped or explained.

**Rationale:** A hand-written report is out of date the moment an
import changes, and a report that disagrees with its dataset is worse
than none — it is the artefact that is supposed to make the import
trustworthy. Generating both from the same in-memory rows makes
disagreement impossible rather than unlikely. The summary block exists
so the gate can check the claim rather than the prose.

The report states rules, not just counts: the placeholder rule, the
multiplicity rule for de-duplication, why a wrong label is worse than
an absent one, and that there are no AI ratings. Tests assert those
sentences are present, because a count without its rule cannot be
disputed later.

**M0 is complete.** 446 rows: 305 enriched, 141 backlog, 0 merged from
the load files because all 83 were already present. 210 placeholders
dropped with every ID listed. 0 rows decision-eligible. Verified: the
frozen archive is byte-for-byte unchanged after the whole milestone
(87 files, 143,245,336 bytes), the rebuild is byte-identical, and git
records no write inside `Pre August 2026/`.

**Expect the totals to move.** The report says so in its own text. It
is a record of this pass, not a permanent truth; what should survive is
the rule each count came from.

**Milestone state:** Current is now empty. M1 is ready to promote but
carries three `sign-off` questions — OPEN-USERS-ACCESS,
OPEN-SYSTEM-OF-RECORD and OPEN-DISCOGS-TOKEN — and promoting it is a
maintainer call, not a self-approval. `_meta.md` says so rather than
leaving an unexplained empty milestone.

**Alternatives:** Write the report by hand — rejected, it would drift
from the data on the first re-import. Emit only the summary JSON —
rejected, the report has to be readable by a person deciding whether
to trust the import.

## 2026-08-30 — M0-IMPORT-AI-WORKS: the ratings do not exist, and the track listings had already leaked

**Decision:** Attach the AI columns to the 305 enriched rows tagged
`source: guess` — track listing, track-listing confidence, remarks and
sources. Keep the rating columns in the schema and let them arrive
empty. Reclassify the 28 enriched-sheet track listings that are
byte-identical to the AI output from `legacy` to `guess`.

**Finding 1 — there are no AI ratings.** `Critical Rating` is empty in
all six AI Works files that carry the column, including
`AI_Vinyl_Works_Stage_7 Rating Qualifiers etc.xlsx`. The
AI-invented ratings the brief warns about were never written. This
narrows the item rather than blocking it: what does exist is 305 AI
track listings, their confidence (High/Medium/Low), remarks and
sources. The rating columns stay in the schema and arrive blank, which
is the honest result and leaves M5's valuation pass somewhere to land.

**Finding 2 — the AI track listings had already leaked into the
sourced data.** On all 28 rows where Discogs found nothing, `Track
listing` in `Classical Master` is byte-identical to the AI file's
value; on none of the 277 matched rows is it. That is precisely the
"AI-invented data sits indistinguishably beside sourced data" problem
the brief describes, and it is now measured rather than feared. Those
28 values are reclassified to `guess` — identity with the AI output is
evidence, not inference. Their tell-tale is visible in the prose:
"exact symphony numbers not verified from accessible sources", sitting
in a data column.

**On the v2 override:** v2 `classical Track listings 01.xlsx` was
chosen to win over v1 Stage 8 for track listings. It agrees with Stage
8 on all 305 rows, so the override changed nothing. Recorded because
"we checked and they agree" is a different fact from "we did not
check", and `ai_track_listing_origin` says so per row.

**Rationale for the guess tag:** enforcement is by computation, not
convention. `decision_eligible` is recomputed after the AI pass so a
guessed value cannot make a row eligible by arriving late, and a test
asserts that a guessed value stays ineligible even when the row is
marked confirmed.

**Alternatives:** Discard the AI columns — rejected, the track listings
are a usable starting point and the provenance rule is what makes
keeping them safe. Leave the 28 as `legacy` — rejected, that labels AI
prose as a human entry, which is the exact confusion this item exists
to end.
