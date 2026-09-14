---
id: CAPTURE-BACKUP-SALVAGE
name: Isolate unreadable photos and preserve recoverable queue backups
summary: Make backup failures identify the exact stage and photo, export metadata independently, and preserve readable photos with explicit incomplete manifests.
status: in-progress
milestone: current
flags:
blocked-on:
date: 2026-09-14
order: 1
---
# Backup salvage

The user reports a later backup preparation failing with NotFoundError.
The precise cause is unproven: distinguish DOM preparation failures,
unreadable stored photo bytes and download/share errors. Preserve source
data and the existing backup; do not rewrite blobs or start uploads during
salvage. Add metadata-only export, fresh per-part reads, bounded fallback
photo reads, smaller parts and single-record export. Detach readable bytes
from IndexedDB before assembling the ZIP. Incomplete exports must enumerate
every missing image in the UI and manifest, never claim complete backup.

Verify injected photo read failures, continuation to later photos, unchanged
source records, ZIP integrity and clear partial/metadata-only labeling.
Publish the tested repair; device diagnosis stays open until actual backup
reports establish what Safari can and cannot read.

Candidate verified: 330 tests and production build pass. Real Chrome
failure injection distinguishes DOM preparation errors from unreadable
photo bytes, proves fresh FileReader fallback and later-photo continuation,
and exports complete, explicitly incomplete and metadata-only files with
zero source queue/API writes. An independent ZIP reader validates all
included hashes and missing-photo reports. Original-size grouping is kept;
smaller parts and single-record exports use separate labels. Deployment next.
