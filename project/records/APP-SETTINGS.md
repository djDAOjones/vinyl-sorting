---
id: APP-SETTINGS
name: A settings screen that stops short of the dangerous half
summary: Settings has to exist for the re-verify toggle, the theme and the column choices, and it sits on a URL with no sign-in — so the maintainer drew the line at export, keeping token entry and any reset at the command line.
status: open
date: 2026-08-31
milestone: current
order: 3
---
# Settings, and where it stops

Maintainer ruling, 2026-08-31, having been shown what the page would be
sitting on: **settings and export, no destruction.**

## Three tiers, and the line between them

**Device — open, stored locally.** Your name, theme, density,
whether keyboard hints show. None of it is a claim about the
collection, none of it leaves the phone, and none of it needs a gate.

**Collection — behind `EDIT_TOKEN`, stored in KV.** The re-verify
toggle (MATCH-REVERIFY-SWEEP), default columns and sorts, saved views.
These change what everyone sees, so they sit behind the same passphrase
that already guards correcting a reading.

**Export — behind `EDIT_TOKEN`.** The whole database as JSON and as
CSV, downloadable. Read-only, so it cannot break anything, and it is
the answer to "what if this all goes away".

### What is NOT on this page, and why

- **Token entry.** A Discogs token typed into a browser has to be
  stored somewhere the Worker can read it, which means KV — readable by
  anything that gets one shared passphrase, on a URL with no sign-in.
  A `wrangler secret` is strictly better and already works. AGENTS.md's
  "no secrets in the repo" is the same instinct one level up.
- **Reset, with or without a 31-day window.** Destructive data
  operations are a stop-and-ask boundary in the hard rules. The
  capability is wanted and will exist — as a tool in `tools/`, which
  takes a snapshot first, and which nobody reaches by mistyping a URL.
- **Editing the roster.** `src/who.ts` is shared by the client and the
  Worker precisely so the gate and the sign-in cannot disagree; moving
  it into KV re-opens that. A name is a code change and a deploy.

None of these are refusals — all three are wanted, and all three want a
sign-in first. That is OPEN-V1-AUTH, which the brief already schedules.

**Done when** the toggle, theme and columns are settable, an export
downloads, and nothing on the page can lose data.
