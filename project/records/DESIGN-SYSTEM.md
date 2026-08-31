---
id: DESIGN-SYSTEM
name: One visual language across every screen, light and dark
summary: Three screens grew separately from one 225-line sheet and now disagree about spacing, controls and density; the maintainer asked for a full redesign, so the palette, type and components are settled once.
status: open
date: 2026-08-31
milestone: current
order: 2
---
# One visual language

Maintainer ruling, 2026-08-31: **full redesign**, not a tidy-up. New
palette, typography and identity, light and dark.

## What is wrong now

`style.css` was written for capture in a loft and is excellent at that.
The other two screens then borrowed it — `browse.css` and `review.css`
are each their own dialect on top, and the three now disagree about
what a button looks like, how dense a list is, and how a message is
shown. A fourth and fifth screen are about to arrive.

## The one thing the redesign may not take away

Capture's constraints are not a style. Dim light, one hand, gloves,
a phone held over a crate: big targets, high contrast, a full-screen
viewfinder, and a 16 px input floor because iOS zooms below it and
does not zoom back. **The redesign inherits these as requirements**,
and the loft screen stays dark whatever the desk screens do.

That is what makes light mode safe to add: it is for the desk.

## Shape

- **Tokens** — colour, type scale, spacing, radius, elevation, motion
  — defined once, with light and dark as two token sets rather than two
  stylesheets. `prefers-color-scheme` by default; an explicit override
  in Settings.
- **Components** — page frame, header with home-link, button, field,
  card, table, chip, empty state, toast, dialog — one definition each.
- **Two densities**, phone and desk, from one markup.

## Order

The system lands first and the screens are rebuilt onto it one at a
time, so nothing is half-migrated at a commit boundary.

**Done when** all five screens share one sheet of tokens, both themes
are legible on every screen, and capture is no worse in a loft.
