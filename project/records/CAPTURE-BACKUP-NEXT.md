---
id: CAPTURE-BACKUP-NEXT
name: Keep sequential backup downloads responsive
summary: Remove the hidden saved-file acknowledgement lock and use a native download link so users can save a file then prepare the next part directly.
status: in-progress
milestone: current
flags:
blocked-on:
date: 2026-09-14
order: 1
---
# Sequential backup downloads

The prepared-file guard leaves every preparation button disabled after a
download until a separate acknowledgement is tapped. Remove that dead end:
disable preparation only while bytes are being assembled, provide an actual
download anchor, and make next-part selection immediately available. Keep
the immediately previous download alive while preparing the next file and
bound retained object URLs. Never claim that requesting a download proves
the file was saved. Preserve queue contents and partial-file warnings.

Verify repeated downloads, consecutive complete and incomplete parts,
metadata export, failure retry and retained previous-file readability,
with no queue/API writes. Publish and verify the actual compiled interface.

Candidate: 330 tests and production build pass. Browser checks download the
same file twice, proceed directly to the next complete/partial export,
retry a preparation failure and read the previous file after preparing the
next one. All preparation controls unlock without acknowledgement; metadata,
photo fallback and single-record rescue remain working. No queue/API writes
or page errors. Deployment is next.
