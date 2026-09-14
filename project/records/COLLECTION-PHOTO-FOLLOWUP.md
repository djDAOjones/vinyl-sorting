---
id: COLLECTION-PHOTO-FOLLOWUP
name: Request and add photographs from the collection
summary: Surface specific photography requests and attach verified photos to the existing record with durable retries and human completion.
status: in-progress
milestone: current
flags:
blocked-on:
date: 2026-09-14
order: 1
---
# Collection photo follow-up

Approved: investigate then implement in the existing collection. Counted Needs
photos view, row reason badges, requests next to photos, Add photos on every
record, explicit human check after online attachment, next needing photos
and return-position preservation. Zero photos is directly observable; do
not infer which images are absent from photo count.

Namespaced raw metadata holds named requests and resolution audit; exclude
it from image-reading counts and presentation. No schema changes. Existing
edit passphrase gates requests and append-only photo attachment. A separate
IndexedDB queue prevents older capture tabs treating additions as new
records. Verify bytes, retain offline work, retry idempotently, require full
server receipts, and include target IDs in rescue exports. No delete/split.

Verify guards, replay, cross-item isolation, missing photo refusal, explicit
resolution, unchanged capture/provenance, metadata exclusion, offline reload,
auth failure, navigation and mobile UI. Other task owns catalogue imports.
