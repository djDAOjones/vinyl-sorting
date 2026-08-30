# Curricula — staged thinking for non-trivial work (optional read)

<!-- pm-next v0.2. Read when an item is complex enough to deserve
     staged thinking: multiple files, a real design choice, or a
     sign-off flag. Trivial items skip straight to implement. -->

## Scope (before building)

State: the problem, the affected areas, the smallest useful scope,
what is explicitly out, and the target files. Search before
concluding; cite what you find. Park out-of-scope ideas to the
wish-list, one line each.

## Options (when a real choice exists)

Two or three ways, each with fit, risk, and trade-offs; recommend
one. Where options differ on an empirically checkable claim costing
minutes to check, check it in scratch first and present measured
comparisons, not argued ones.

## Validate (before implementing anything risky)

Name the regression surface, the acceptance criteria, and anything
irreversible. A blocking concern narrows scope rather than pushing
through.

## Review (after autonomous or parallel work)

Read-only: map changes to intent, check scope adherence and the
hard rules, verify memory hygiene, look for seam damage at merges.
Verdict: accept / accept with follow-ups / needs changes, with a
punch list. Review proposes; fixes run as their own items.

## Upkeep (when the validator warns)

Budgets propose; they never block. A WARN is the signal that memory
now costs more to read than it is worth. The four below are the ones
that actually recur; anything else the validator warns about is read
the same way — fix the cause, not the number.

- **Decision log over its live-entry or age budget** — prune: move
  the oldest entries verbatim to `project/archive/`, leaving the
  live file at roughly 70% of the entry budget and never below the
  floor `liveFloorEntries` sets.
  Archive, never delete; an index line says what moved and when.
  (Shipped records are the opposite case and are deleted, because
  the trajectory line and the decision entry carry them forward. A
  log entry has no such carrier, so it moves rather than goes.)
- **Backlog Active over words or open items** — too much is
  committed, not too much is written. Cut what is dead (and delete
  the record — a cut row still renders and still counts), park what
  is merely wanted to the wish-list, and let the rest wait in Icebox
  with a trigger rather than a hope. Trimming summaries relieves the
  word half; only removal relieves the item half.
- **Items standing past the age warning** — re-judge rather than
  re-order. Per item: does its blocked reason still hold and has its
  trigger fired; are its grades still true against what has shipped
  since; is its intent dead. Refresh the wording with a current
  date, or cut it with a reason. Age informs the judgement; it is
  never itself the reason to promote something.
- **Trajectory or a reference document over budget** — compress on
  ship, not in bulk: outcomes belong in one line each, the why in
  the decision log, the detail in neither.

Two rules hold across all four. Propose before writing when the
maintainer is present, and say plainly when nothing needs doing — a
quiet no-op is the common case and a good result. Never let upkeep
edit the generated view: it is records in, view out, always.

## Bugs

Reproduce, then diagnose to a root cause with cited evidence,
then fix minimally upstream. Competing hypotheses get stated with
the evidence that would separate them.
