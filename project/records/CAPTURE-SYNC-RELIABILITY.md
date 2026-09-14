---
id: CAPTURE-SYNC-RELIABILITY
name: Recover interrupted uploads and make capture receipt status unmistakable
summary: Investigate missing captures, prevent a stuck upload from silently blocking the queue, and distinguish locally saved entries from server-confirmed records.
status: in-progress
milestone: current
flags:
blocked-on:
date: 2026-09-14
order: 1
---
# Capture sync reliability

User requests incident investigation and clear warnings when captures are
not being recorded online. Device-local evidence is still needed to prove
the particular incident cause; do not substitute a code hypothesis for it.
Personal timing and queue evidence remain local, not in repository records.

Observed code defects: persisted syncing entries are never selected after
an interrupted session; fetch has no timeout; a successful HTTP status is
not checked for a valid item receipt; IndexedDB writes resolve before the
transaction commits; save failures have no visible catch; camera success
says Filed before server acknowledgement. Fix these without changing the
IndexedDB identity, schema, photo keys or capture payload semantics.

Scope: queue storage/logic, sync controller, capture status/alerts and tests.
Bound requests, recover interrupted attempts, retain idempotent retry,
handle storage failures without clearing current photos, and add prominent
unsent counts, last error, retry and local diagnostic-copy controls. Keep
offline capture supported; never delete unsent data or auto-confirm matches.

Verify with injected network/storage failures, persisted interrupted queues,
real browser capture flows and the project gate/build. Record verified
findings separately from the phone-specific cause and recovery status.

Implementation verified: 321 tests pass, production build passes, and real
Chrome checks with synthetic records prove persisted interruption recovery,
failed-upload retry with an item receipt, visible camera warnings, copied
diagnostics, offline photo retention, and photos preserved when a storage
transaction aborts after request success. Publishing and live asset checks
are next; incident diagnosis still requires device-local evidence.
