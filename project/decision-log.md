# Decision log

<!-- Append-only, newest first. -->

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

## 2026-08-30 — M0-MERGE-LOAD-FILES: the 83 rows were already merged, so 0 are new

**Decision:** Merge 0 new rows and record 83 duplicate decisions. The
83 usable rows in `1st load to add.xlsx` and `2nd load to add.xlsx` are
already present in `Classical Remedial`. The reconciled dataset stays
at 446 rows, not 529.

**Rationale:** Two independent methods agree. Positionally, the 83 rows
map in order onto Remedial rows 59-141 — all 83 catalogue strings and
all 46 titles match exactly, with only the IDs differing because the
Remedial sheet renumbered them to 1058+. Separately, the merge's own
key-based de-duplication, which knows nothing about row order, matched
all 83 and merged none. 2nd load occupies Remedial 59-104 and 1st load
105-141.

446 is also what the brief already says: "446 already catalogued". The
~300 new records are the physical backlog that has never been entered,
not these files.

**De-duplication is by key with multiplicity.** Four rows read
`RTL2075 MCPS`, and they are four physical copies rather than one row
counted four times, so a key already present four times absorbs four
incoming rows and no more. A test asserts each of the four matched a
different existing copy. Key matches with disagreeing titles are
treated as ambiguous and kept, per the record — carrying a duplicate a
person can resolve while holding the disc beats merging on a guess.
None occurred.

The key folds case, spacing and the Unicode dashes so `TWO-269` and
`TWO‑269` compare equal. That folding is for comparison only; stored
values stay faithful, because normalising the data itself is M2's job.

**Consequence for M2:** the re-verification run is 446 rows, and the
load files need never be read again.

**Alternatives:** Merge all 83 and de-duplicate later — rejected, it
would put 83 known duplicates into the dataset that M2 would then
re-verify against Discogs at real cost. Match on catalogue number
alone — rejected, it cannot distinguish a genuine second copy from a
re-import, which is exactly what multiplicity handles.

## 2026-08-30 — M0-IMPORT-REMEDIAL: the placeholder rule is mechanical, and every drop is named

**Decision:** A `Classical Remedial` row is a placeholder when it
carries no value in any column other than ID. That rule partitions the
sheet exactly 210 placeholders / 141 real records. The 141 import as
`needs-capture`; the 210 are dropped, and every dropped ID is returned
so the reconciliation report can list them.

**Rationale:** The record allows dropping but not dropping silently.
A rule that needs no judgement can be re-run and disputed later — if
the numbers ever look wrong, the report names the rule and the 210 IDs
it applied to, and anyone can check it against the frozen sheet. The
rule was not chosen to fit a target: it was applied first and produced
210/141, which is what the brief already claimed.

**On provenance:** every value here is `legacy`. None of these rows was
ever matched against Discogs, so no Discogs field exists to carry over,
and a test asserts none appears. `Label` is empty on all 141 — the
"label captured on 0% of the backlog" finding — so the combined string
in `Catalogue #` goes through the splitter: 31 split, 73 bare catalogue
numbers, 37 refused and left with their combined string intact.

**On item ids:** allocation moved out of the importers into
`build-dataset.mjs`, so numbering runs unbroken across batches. Ids are
stable as long as the import order is, and that order is fixed by the
M0 sequence. The composed dataset is DG-0001 to DG-0446 — 305 enriched
plus 141 backlog, which is exactly the brief's "446 already
catalogued".

**Alternatives:** Drop rows lacking a title or catalogue number —
rejected, it would have discarded the 58 rows that carry only a
composer, which are real records. Keep the placeholders as empty rows
to be filled later — rejected, they are 210 unallocated ID slots, not
records; the physical backlog is counted by handling discs, not by
counting blank spreadsheet rows.

## 2026-08-30 — M0-IMPORT-ENRICHED: which columns Discogs wrote, established from the data

**Decision:** Import all 305 rows with per-field `<field>_source`
columns. `Label`, `Discogs ID`, `Discogs URL` and `Discogs ID Score`
are `discogs`; `Musicians` and `Track listing` are `discogs` on the 277
matched rows and `legacy` on the other 28; everything else is `legacy`.
Confirmation is `no` on every row. The existing confidence labels ride
along as `discogs_confidence_legacy` and `discogs_score_legacy` — data
to audit, never provenance.

**Rationale:** Which columns the enrichment actually wrote was measured
rather than assumed. `Label`, `Discogs ID`, `Discogs URL` and
`Discogs ID Score` are populated on exactly the 277 rows where
`Discogs record found?` is Yes and on none of the other 28 — a perfect
correlation, so they are Discogs output. `Musicians` and `Track
listing` are filled on all 305, but 166 of the 277 matched rows carry
Discogs credit-role markers such as "(Orchestra)" and artist
disambiguation such as "(6)", and none of the 28 unmatched rows do, so
that column was overwritten by the same pass. The remaining columns
are filled uniformly across all 305 and therefore predate it.

The legacy confidence labels are carried but never trusted: 236 rows
say "Exact", and 16 of the known-wrong matches are among them. A test
asserts that no confidence label can make a row decision-eligible.

**On `decision_eligible`:** the provenance rule is emitted as a
computed column rather than left to convention, so it can be tested.
It reads `no` on all 305 rows, which is the correct end state for a
pure import — nothing has been confirmed by a person and nothing was
captured off the shelf.

Per-field confirmation state is deliberately not emitted as thirty more
columns all reading `no`. M0 confirms nothing, so one row-level
`confirmed` column states the invariant; M1's D1 schema materialises
real per-value `field_source` rows.

**Alternatives:** Treat every column in the sheet as `discogs` —
rejected, it would misattribute the composer and title a person typed
years ago. Treat the whole sheet as `legacy` — rejected, it would lose
the record of what to re-verify in M2. Trust the confidence labels —
rejected, that is the defect the project exists to fix.

## 2026-08-30 — M0-SPLIT-LABEL-CATNO: labels are recognised, never inferred

**Decision:** Split against a gazetteer of the 98 distinct labels
attested in this collection's own data — the 277 rows of `Classical
Master` where Discogs already supplied a separate Label. A label is
emitted only when an attested name matches and the remainder is a
well-formed catalogue number. Everything else is refused with a named
reason, and refusals route to capture. Three outcomes, not two:
`split`, `bare-catno` (no label present, which is complete rather than
failed) and `refused`.

**Rationale:** The record's rule is that a wrong label is worse than an
absent one, because a wrong label corroborates a wrong match — the
exact failure that put 26 of 277 existing matches on the wrong record.
A pattern-based splitter would have to decide whether `Harmony` in
`CBS Harmony 30001` is a sub-label or part of the catalogue number, and
it would be guessing. Deriving the vocabulary from the data replaces
that guess with evidence, and makes the refusals principled: `Decca Ace
of Diamonds SDD 538` is refused because this collection has never
attested `Ace of Diamonds`, not because a regex failed.

Two-character labels are excluded from the gazetteer. `PS` is an
attested label and also the prefix of `PS 287` and `PS5032`; keeping it
would split real catalogue numbers in half.

**Result on the 141 backlog rows:** 31 split, 73 bare catalogue numbers
with no label present, 37 refused — 18 unattested sub-labels, 11
unattested label prefixes, 7 cells holding two pressings, 1 unrecognised
parenthetical. All 31 splits were checked by eye and are correct,
including `EMI Eminence` beating `EMI` on longest match. Label casing
is normalised to the attested form, so `Vox` becomes `VOX`.

Nothing is discarded: every result keeps `combinedRaw`, so a refusal
loses no data and a later pass with a larger gazetteer can re-split it.

**Alternatives:** Pattern-only splitting — rejected, it cannot tell a
sub-label from a catalogue prefix, and would emit exactly the confident
wrong labels this project exists to stop. Accepting a parent label when
the sub-label is unattested — rejected for the same reason: `Decca` is
a label that pressing does not carry. Compound matching of two adjacent
attested labels — rejected, it would gain 2 rows and would also merge
`Columbia/CBS`, which is genuinely two labels.

## 2026-08-30 — M0-REPAIR-ENCODING: two corruptions, one confirmed as MacRoman

**Decision:** Repair in two separate passes. Byte-level: decode
`classical vinyl list in progress.csv` with MacRoman rather than
UTF-8. String-level: undo "UTF-8 bytes decoded as MacRoman" inside the
workbooks by re-encoding to MacRoman and decoding as strict UTF-8,
accepting the result only when the whole string decodes cleanly.
U+00A0 folds to a space rather than being deleted; zero-width
characters are deleted; newlines survive.

**Rationale:** The byte histogram settles the diagnosis rather than
assuming it — 0xCA x68, 0xD0 x57, 0x8E x19 read as NBSP, en dash and
e-acute under MacRoman, and as unassigned, Eth and E-circumflex under
cp1252. The record predicted cp1252 would produce different wrong
answers; it does, and there is now a test asserting it.

Strictness is the safety property. A repair that accepts partial
decodes would rewrite legitimate text: `Side A • Side B` and
`√2 is irrational` contain the exact characters MacRoman mojibake
produces. Requiring that the entire string decode as valid UTF-8, and
that it contain a UTF-8 lead byte at all, leaves both untouched — both
are negative controls in the suite.

U+00A0 folds to a space because in `CBS Harmony 30001` it separates
the label from the catalogue number. Deleting it welds two tokens
together and defeats the exact match this whole item exists to enable.
Newlines survive because track listings are multi-line and M3 reads
them per track.

**Scale:** 331 distinct strings repaired across the frozen inputs —
324 invisible-character fixes and 7 mojibake fixes. All 7 are in the
`Label (and Catalog #)` column of the load files, which is the field
the corroboration gate depends on.

**Alternatives:** cp1252 — rejected on the evidence above. A
character-by-character substitution table — rejected, it cannot tell
a real bullet from half a mojibake pair, which is precisely the
distinction that matters. Normalising U+2011 to ASCII hyphen here —
rejected as out of scope: M0 repairs faithfully, M2 normalises, and
conflating the two hides the original bytes. Noted on M2-MATCHER
instead.

## 2026-08-30 — M0-ARCHIVE-FREEZE: freeze 87 sources, not 9,285 files

**Decision:** The frozen manifest covers the 87 files that are
actually source data. `.venv/`, `__pycache__/` and nested `.git/`
are excluded by declared pattern, each with its reason recorded in
the manifest itself. Digests are sha256 over bytes; mtime is
deliberately not recorded. The archived Discogs token is listed by
path and size with its digest written as `REDACTED-SECRET`.

**Rationale:** `Pre August 2026/` holds 9,285 files, of which 9,106
are a Python virtualenv belonging to the old Windsurf CLI. Hashing
them exceeded two minutes and froze nothing of value — a venv is
reproducible from `pyproject.toml` and is not an input to any
import. Scoped to real sources the manifest builds in 0.5 s, which
makes `--check` cheap enough to run as a gate rather than a ritual.
mtime is omitted because this tree lives on OneDrive and sync
rewrites timestamps, so recording them would make `--check` fail for
reasons unrelated to the bytes. The token digest is redacted because
the manifest is committed, and a hash of a live credential does not
belong in git history.

**Alternatives:** Hash everything — rejected, minutes of work to
freeze artefacts that no import reads. Exclude silently — rejected,
an undeclared exclusion is indistinguishable from a bug; the
manifest carries `excluded` and `redacted` lists so what is absent
is auditable.
