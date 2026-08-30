---
id: M2-MATCHER
name: Normalisation, sanity check, query ladder, scoring and the corroboration gate
summary: The matcher that treats a catalogue number as a lead rather than a verdict — two independent signal families must agree with a clear margin over the runner-up before anything is auto-accepted.
status: todo
milestone: icebox
order: 3
---
# The matcher and its corroboration gate

The single most important behavioural change from today, where
`catno exact → accept` is how ID 2 became a disco 7".

Gate: `verified` requires score >= 80 **and** families >= 2 **and**
(top - second) >= 25. Families are independent kinds of evidence —
identifier, label, people, title, format. Anything scored but
ungated is `needs_review`; nothing found is `no_match`.

The input sanity check matters as much as the gate: junk catalogue
strings like `RD ?` are rejected before any API call, which is what
kills the collisions where four records all matched one release with
nothing to separate them.

Always persist the top 5 candidates and the exact queries used —
that is what makes a wrong match explicable later.

Port the proven ladder from the Windsurf Python CLI. Three changes:
MacRoman instead of cp1252, the input sanity check, the corroboration
gate.

**Done when** the 26 known-bad matches are caught. ~4 days.
