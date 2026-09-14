---
id: CAPTURE-QUEUE-BACKUP
name: Preserve device queue with photo backups and recovery diagnostics
summary: Add a read-only device recovery screen with portable record and photo backups, detailed diagnostics and explicit upload controls.
status: in-progress
milestone: current
flags:
blocked-on:
date: 2026-09-14
order: 1
---
# Preserve queued captures

Authorised: provide a practical way to save queued work and temporarily
include detailed in-app diagnostics. Keep device-specific evidence private.
Use the existing origin and IndexedDB identity, with no new dependencies
or schema changes. Do not delete queued work; temporarily retain confirmed
entries too. A separate recovery screen reads the queue without starting
uploads, offers bounded ZIP parts containing complete metadata and original
photo blobs, and only starts uploads on an explicit button press.

Backups carry checksums and stable client IDs/photo keys for verification
and idempotent recovery. Show export progress and distinguish a prepared
download from a file the user has actually saved. Diagnostics include build,
browser, storage, queue state/errors, photo sizes/types and request events;
read-only connection checks do not claim that writes have succeeded.

Verify ZIP integrity and byte-for-byte photo/metadata recovery, unchanged
source queue, browser save controls, manual retry, and production assets.
Incident diagnosis/recovery remains CAPTURE-INCIDENT-DIAGNOSIS until evidence
from the affected device and server establishes the outcome.

Verified candidate: 325 tests and production build pass. Real Chrome
exported a synthetic 129-entry, 258-photo queue in seven parts without
changing it or sending uploads. Python's standard ZIP reader independently
validated all CRCs, metadata and photo SHA-256 hashes. Explicit upload tests
retain every local entry, expose a rejected record and confirm the others.
Phone layout has no overflow or page errors. Deployment is next.
