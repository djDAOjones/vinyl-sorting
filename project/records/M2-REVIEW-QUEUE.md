---
id: M2-REVIEW-QUEUE
name: Keyboard-driven review queue, and re-verify all 446
summary: The screen that decides the project — one item at a time, capture on the left, top five scored candidates on the right, cleared entirely by keyboard; first job is re-verifying all 446 existing rows.
status: todo
milestone: current
order: 4
---
# Review queue, and the first re-verification run

Keyboard only: `1`–`5` selects, `N` none of these, `S` skip, `B` back.
No mouse required, because this queue has hundreds of items in it and
mouse travel is the difference between clearing it and abandoning it.

Each candidate shows **why** it scored — which families fired, not
just a number. Rejecting all five offers a manual Discogs URL or ID
paste. Confirming writes provenance `discogs` plus `confirmed_by`, and
never overwrites `capture`.

Re-verification is a normal operation, not a migration: every item
carries `last_verified_at` and anything can be re-queued. The first
production run re-verifies all 446 existing rows — roughly forty
minutes of API time, so it runs as a pausable, resumable background
job that never blocks a screen.

**Done when** the queue can be cleared by keyboard and the 446 have
been through it.
