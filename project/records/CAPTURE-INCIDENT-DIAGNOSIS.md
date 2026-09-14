---
id: CAPTURE-INCIDENT-DIAGNOSIS
name: Establish device-specific missing capture cause and recovery
summary: Upload safeguards are deployed; inspect the affected device queue to establish its actual failure and recover any retained entries.
status: todo
milestone: current
flags: blocked
blocked-on: Device queue status and browser context from the user
date: 2026-09-14
order: 1
---
# Missing capture diagnosis

CAPTURE-SYNC-RELIABILITY fixes demonstrated code defects, but does not prove
which occurred on the affected device or that all missing captures reached
local storage. Await its queued/sent/retrying status and browser versus
home-screen context. Preserve website data and any unsaved photographs;
do not reinstall, clear storage, or equate an empty queue with recovery.

After recording the existing status, guide a safe same-origin refresh to
load the recovery build and inspect Upload details / Copy diagnostics.
Compare retained client IDs and server receipts where available; establish
what arrived, what remains queued, and any unresolved gap. Resume
PHOTO-BATCH-NEXT only for newly received images. Keep personal timings,
device diagnostics and catalogue metadata in private local evidence.

Close only with evidence of the actual cause and recovery outcome, or a
clearly bounded finding that the remaining evidence cannot establish it.
