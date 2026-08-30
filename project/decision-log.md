# Decision log

<!-- Append-only, newest first. -->

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
