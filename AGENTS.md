# AI Agent Rules — Vinyl Sorting (pm-next v0.2)

<!-- The whole framework, one file. Judgement curricula are the
     optional curricula.md; everything mechanical below is either a
     checked contract or a pointer to a tool. Where your harness
     supports rules imports, import this file plus the identity
     documents (project/brief.md and kin) into the rules position —
     identity only, never work-target files. -->

## Hard rules (one canonical statement — tools enforce, this states)

No new runtime dependencies. No destructive or schema-altering data
operations. No weakening or deleting tests. Minimal change: touch
what the item needs. Stop and ask at any of these boundaries; in
autonomous modes, stop means park the item with a note, take the
next.

Sanctioned dependency exception (maintainer, 2026-08-30, at the M1
boundary): the brief's named stack — `hono` at runtime, and
`typescript`, `vite`, `wrangler` and `@cloudflare/workers-types` as
dev dependencies. Nothing else. The rule still bites for every other
package, and adding one is still a stop-and-ask.

Project boundaries, same force as the above:

- `Pre August 2026/` is a read-only archive. Never edit, move or
  rename anything inside it; every import reads and writes elsewhere.
- Never write back over `capture`. Discogs data lands in `release`;
  the two stay separate for ever, so duplicate detection runs on what
  a human read rather than on what a bad match wrote.
- The provenance rule: a value sourced `guess` or `legacy`, or an
  unconfirmed `discogs` value, may be displayed anywhere but may
  never feed a cluster, a coverage check, a sell list or a shortlist
  until a person has confirmed it. Enforce it in the query layer, not
  by convention.
- No secrets in the repo. `DISCOGS_TOKEN` is a Worker secret; a token
  file present in the working tree is never committed, echoed or
  pasted into a prompt.
- Rate limits are enforced centrally in the Worker, never per caller:
  Discogs 50/min shared, MusicBrainz 1/sec with a real user-agent.

## Memory contract (exact — the two checks below FAIL deviations)

- Items are records: `project/records/<ID>.md` — flat `key: value`
  frontmatter (id, name, summary, status: open|todo|in-progress|cut,
  milestone: current|next|icebox, flags, blocked-on, date, grades,
  order; the key is `name`, never `title`) over an H1 body.
  Frontmatter is flat by construction, so: every item has an ID,
  Icebox included; IDs are SCREAMING-KEBAB with no dots; `summary:`
  is one physical line however long. An unknown `status:` renders as
  open and warns — it never silently disappears.
- `_meta.md` carries the milestone intent lines and two optional
  dialect keys: `milestones: key=Title, …` renames or re-orders the
  three groups, and `flags: a, b` extends the known flag list, which
  is otherwise sign-off, spike, detail, maintainer, security and
  blocked. A record naming a milestone outside that set is an error,
  never a silent drop. `_meta.md` itself is optional; without it the
  three default milestones apply.
- The rest of memory is four files, all budgeted: `project/brief.md`
  (what is being built, for whom, what is out — the identity
  document), `project/trajectory.md` (one line per shipped item),
  `project/decision-log.md` (append-only, newest first) and
  `project/wish-list.md` (unscoped ideas, triaged not hoarded).
- The backlog view is GENERATED: `node tools/gen-backlog.mjs`
  renders `project/backlog.md` between markers. Edit records,
  regenerate; never hand-edit between markers. On any view merge
  conflict: regenerate from the merged records — never hand-merge.
- Ship = delete the record, regenerate (update `_meta.md` intent
  lines if a milestone emptied or changed meaning), then append one
  trajectory line `- ID — outcome (YYYY-MM-DD) — see decision-log`
  and prepend one decision entry `## YYYY-MM-DD — ID: title`
  (Decision and Rationale lines; 600-word entry guard, shorter is
  better). Re-run the validator after the memory writes — it must
  be green at commit time, not merely before the writes.
- Commit every touched file per close: title `ID: summary`, one
  what/why line, one `Verify:` line with the gate result. Push when
  a remote is already configured; never add or change a remote.
- Cutting is disposal, not a state to keep: mark `status: cut` only
  long enough to decide, then delete the record and regenerate, with
  one trajectory line saying it was cut and why. A cut record left in
  place still renders, and still counts against the Active budget.
- Pruned decision-log entries move verbatim to `project/archive/`,
  created on first prune. Records are deleted rather than archived —
  the trajectory line and the decision entry carry them forward, and
  git holds the rest.
- A `sign-off` flag on a record is a human gate: park the item for
  the maintainer; never self-approve.

## Operation (stream-first)

Work items back-to-back in one context. Between items run
`node tools/janitor-read.mjs` and read the report it writes
(`latest.md` under the project reports directory; fresh = under
~24 h with its Start SHA in branch history) instead of any
re-reading ritual; stale or absent → run the validator
directly. Per item: implement → gate green → memory writes → validator green
(`node tools/check-memory.mjs` for the form of memory, `node
tools/gen-backlog.mjs --check` for view-versus-records drift — neither
catches the other's faults) → commit. Janitor reports are
generated output: gitignored, never hand-edited, never committed —
freshness is a filesystem contract, and a per-session generated file
in git only manufactures conflicts on the parallel branches below.
A budget WARN is an input, not noise: see `curricula.md` → Upkeep.
Stream start = the between-items protocol
(fresh report or direct validator run); there is no other ritual. Parallel
work: one branch per session; records make item writes disjoint;
shared-append files (decision-log, trajectory) are the residue —
union carefully at integration and let review check the seams.
Crashed sessions never block anyone: verify a dead session's
in-flight work (gate + validator), then fold it in with provenance
stated.

## Budgets (machine-readable)

The validator reads a machine-readable budget block from the first
available source: a memory-policy.md file in the project directory,
then `pm_skills/memory-policy.md`, then this block. A project-owned
policy therefore overrides an inherited framework baseline without
editing comparison or distribution material. The selected source
must contain the validator's complete non-negative integer shape;
malformed or incomplete higher-priority policy fails closed instead
of silently falling through or disabling a guard.

```json
{
  "$comment": "Canonical budgets for pm-next v0.2. Words unless stated.",
  "referenceDocSoftWords": 3500,
  "backlogActive": { "softWords": 1500, "maxOpenItems": 40 },
  "trajectoryWords": 2000,
  "decisionLog": { "maxLiveEntries": 20, "entryGuardWords": 600, "maxOldestDays": 90, "liveFloorEntries": 10, "minEntriesBeyondFloor": 5 },
  "wishListMaxOpen": 25,
  "ticketSoftWords": 600,
  "standingItemWarnDays": 30
}
```

Pruning keeps roughly the newest 70% of the live entry budget and
never drops below `liveFloorEntries`; that ratio is judgement, so it
lives here in prose rather than as a key nothing reads.

## What pm-next deliberately dropped (the deletion ledger)

Lite closes and Reconcile (streams make full closes cheap enough to
always do); the file map (oriented agents navigate; revisit at
scale); doc-deltas (project-specific; add back where protected docs
exist); the mode system (one stream mode with conservative
defaults; `sign-off` flags are the human gates). Everything else
sensible is your judgement — see `curricula.md` when a task is
complex enough to deserve staged thinking.
