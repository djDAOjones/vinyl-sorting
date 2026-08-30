---
id: CAPTURE-BULK-PHOTOS
name: Photograph a crate in one pass, one row per photo
summary: Capture takes one disc at a time, so walking a crate of twenty is twenty form interactions — add a bulk mode that turns a multi-select or a run of shots into one row each, with the crate sticky and nothing typed.
status: open
date: 2026-08-30
milestone: icebox
order: 4
flags: detail
---
# Photograph a crate in one pass, one row per photo

The brief's photo-first promise is "walk a crate photographing labels
and type nothing". The app does not do that yet. `src/main.ts` has one
file input with `capture="environment"` and no `multiple`, `save()`
builds exactly one entry holding one `label_a` blob, and crate is
re-validated per save. Twenty discs is twenty round trips through the
form.

The backend is already willing: `parseCapture` accepts a capture with a
photo and no catalogue number, and a test says so in those words.
Nothing in the Worker or the schema needs to change.

## What it has to do

Pick or shoot many, write one row per photo, take the crate from the
sticky value, and type nothing. Each photo keeps its own `clientId`, so
the Worker's idempotency still holds and a retry cannot double-write.

## Three things that will bite

- **Photos are queued at full size.** `queue.ts` stores the raw Blob,
  and a phone frame is around 4 MB, so a crate of twenty is ~80 MB
  sitting in IndexedDB — on a phone, in a loft, where iOS evicts under
  storage pressure. Downscale before queueing. 1568 px on the long edge
  lands near 800 KB and is what the chat pack sends anyway, so nothing
  downstream loses anything.
- **The drain is serial and stops on the first failure.** `sync.ts`
  breaks out of the loop deliberately — "almost certainly offline; stop
  rather than burning the queue". That is right for one entry and
  untested for twenty over mobile data. A crate that half-uploads must
  be obviously half-uploaded, and must finish on its own when signal
  returns.
- **`position` is per-record**, and in bulk mode there is nobody typing
  it. Either drop it for bulk captures or auto-increment down the
  crate, but decide rather than letting it silently go null.

## Why it is not the trial's blocker

A trial needs twenty photographs, not twenty captures. The phone's own
camera plus AirDrop puts them in `data/label-photos/` today, and
`tools/photo-pack.mjs` takes them from there. This item is for the real
run across 750, where twenty form interactions per crate is the thing
that stops the cataloguing.

Trigger: a scored spike run that clears its bar, so bulk capture is
feeding something proven rather than a hunch.
