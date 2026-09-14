---
id: PHOTO-BATCH-NEXT
name: Process the next photo batch when its location is known
summary: User requests another photo batch; await its location or completed upload before reading and populating it.
status: todo
milestone: current
flags: blocked
blocked-on: New batch location or completed upload
date: 2026-09-14
order: 1
---
# Next photo batch

Authorised: read the fresh images, populate unconfirmed vision raw fields,
check for combined records and preserve capture and image provenance, using
the established photo-batch workflow. No external catalogue lookup during
image transcription. Do not repeat a prior batch or overwrite readings.

The new batch is not yet available in the checked sources. Asked the user
whether it is submitted in the app, still on the capture device, or in
another local folder. Await that information; no catalogue writes made.
