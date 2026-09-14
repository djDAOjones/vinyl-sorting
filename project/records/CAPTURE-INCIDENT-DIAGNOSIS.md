---
id: CAPTURE-INCIDENT-DIAGNOSIS
name: Establish device-specific missing capture cause and recovery
summary: Upload safeguards are deployed; inspect the affected device queue to establish its actual failure and recover any retained entries.
status: todo
milestone: current
flags: blocked
blocked-on: Revised rescue exports and exact failed-photo diagnostics from the device
date: 2026-09-14
order: 1
---
# Missing capture diagnosis

CAPTURE-SYNC-RELIABILITY fixes demonstrated code defects, but does not prove
which occurred on the affected device or that all missing captures reached
local storage. The browser context is now known. Preserve website data and any unsaved photographs;
do not reinstall, clear storage, or equate an empty queue with recovery.

The user now reports a visible waiting queue. CAPTURE-QUEUE-BACKUP is live:
open Save queued work within the same app/browser, save and verify every
ZIP part, copy diagnostics, then explicitly resume uploads. The recovery
screen does not start uploads automatically. Confirmed entries are retained
temporarily. A subset of received archives has now passed independent ZIP
and photo checksum checks. The user assigned restoration of those complete
archives to another task; this task has made no import writes and owns the
remaining failed-part rescue. Keep actual counts and receipts private.

CAPTURE-BACKUP-SALVAGE is deployed: export all record metadata independently,
retry affected original-size parts, and preserve explicit incomplete ZIPs
where photos remain unreadable. Fresh record reads and FileReader fallback
may recover a stale handle; they do not prove that underlying photo bytes
remain available. Request exact missing-photo reports, then check local
originals and existing server photo objects using the preserved keys.
Avoid overlapping writes with the other restoration task.

After recording the existing status, guide a safe same-origin refresh to
load the recovery build and inspect Upload details / Copy diagnostics.
Compare retained client IDs and server receipts where available; establish
what arrived, what remains queued, and any unresolved gap. Resume
PHOTO-BATCH-NEXT only for newly received images. Keep personal timings,
device diagnostics and catalogue metadata in private local evidence.

Close only with evidence of the actual cause and recovery outcome, or a
clearly bounded finding that the remaining evidence cannot establish it.
