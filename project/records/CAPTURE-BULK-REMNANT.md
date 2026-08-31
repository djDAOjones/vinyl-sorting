---
id: CAPTURE-BULK-REMNANT
name: bulkFields and BULK_CARRIED have no caller — decide whether they stay
summary: CAPTURE-ONE-SCREEN removed the crate button and saveBulk with it but left bulkFields and BULK_CARRIED exported and tested with nothing calling them, because deleting them deletes tests and tidying up after a removal is not the same decision as the removal.
status: open
date: 2026-08-31
milestone: icebox
order: 5
---
# bulkFields and BULK_CARRIED have no caller

CAPTURE-ONE-SCREEN removed the crate-in-one-pass button and `saveBulk`
with it, but left `bulkFields` and `BULK_CARRIED` exported from
`src/queue-logic.ts`, with assertions in
`tools/test/queue-logic.test.mjs` still covering them. Nothing calls
either one.

They were left deliberately. Deleting them deletes tests, which is a
stop-and-ask boundary in AGENTS.md, and tidying up after a removal is
not the same decision as the removal — it was not what was asked for.

Two honest endings:

- **Delete both, and their tests.** The mode is retired on a reason that
  will not reverse — more than one photograph is always needed — so the
  logic is not waiting for anything.
- **Keep them, and say so in the file**, so the next reader does not
  spend the same five minutes working out whether something is broken.

Either costs nothing today. It is written down so the question gets
asked once rather than rediscovered.
