---
id: M1-CAPTURE
name: Schema, Worker skeleton and the capture screen
summary: D1 schema per the brief section 03, Hono Worker with no sign-in and the Discogs token as a secret it never proxies openly, and the photo-first offline capture form; then import M0's dataset.
status: todo
milestone: next
order: 1
---
# Schema, Worker skeleton and the capture screen

The milestone that unblocks everything physical. Build **photo-first**
capture before type-at-shelf: walk a crate photographing labels, type
nothing, transcribe later at a desk. It is faster per disc and it is
delegable.

Six capture fields: label photo, catalogue number, label, one name,
crate + position, condition ×2, with matrix/runout optional. Label and
catalogue number are separate inputs — never one combined field.

Offline is a hard requirement, not a nicety. Entries queue in
IndexedDB and sync when a connection returns; the UI never blocks on
the network and never loses a queued entry on refresh.

**Done when** a record can be captured on a phone with no signal, in a
loft, and appears in the collection afterwards. Median entry under 30
seconds, measured rather than estimated. ~3 days.

**From OPEN-USERS-ACCESS (2026-08-30):** no sign-in for v1. Build the
Worker with named operations only — capture write, dataset read — and
no general Discogs proxy endpoint. Capture never calls Discogs, so the
token need not be reachable from the browser at all in M1. Deploy to an
unguessable Pages subdomain.

