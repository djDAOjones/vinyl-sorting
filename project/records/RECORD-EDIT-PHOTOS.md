---
id: RECORD-EDIT-PHOTOS
name: Edit a record's photographs — delete, add, and split by selection
summary: Browse can already correct every field, but its photographs are listed by key and never shown, because serving one needs a Worker GET that a sign-in-free v1 deliberately does not have; so deleting a bad shot, adding a missing disc label, or splitting a record by picking which photos go where is desk work through split-item.mjs, blind, and only reachable by whoever has the credentials.
status: open
date: 2026-09-01
milestone: next
order: 5
flags: blocked
blocked-on: whether a photo-reading route can exist without a sign-in
---
# Edit a record's photographs — delete, add, and split by selection

Raised by the maintainer on 2026-09-01. Three operations, one blocker
shared between them.

## What is wanted

- **Delete** a photograph — a mis-fire, a blurred retake, a shot of the
  carpet.
- **Add** one to an existing record, which is how a sleeve-only row gets
  its disc label without re-cataloguing the disc. Crate 3 needs this
  today: 484, 485 and 488 were photographed sleeve-only.
- **Split** a record by choosing which photographs go to which side —
  the case where one capture turns out to hold two discs.

## The blocker is one decision, not three

`/browse` lists photographs **by key rather than showing them**, and
that is not an oversight. Serving a photograph needs a Worker route that
reads R2, and v1 has no sign-in: the property that keeps that safe is
that no HTTP entry point can reach a photograph at all. `photos-pull.mjs`
exists precisely so the desk can see them without such a route ever
being added — it uses the credentials the maintainer already has for
deploying, so there is no new exposure.

Every operation above needs a person to **see** the photographs to
choose between them. Delete-by-key is not a feature, it is a trap: the
keys are opaque and the only thing distinguishing `…-3.jpg` from
`…-4.jpg` is what is in them.

So this record is blocked on a question, not on work: **can the app show
a photograph without acquiring a route that enumerates or serves them to
anyone who asks?** Plausible answers, none yet chosen:

- A signed, expiring URL minted only for a caller already holding
  `EDIT_TOKEN` — keeps the passphrase as the gate the edit routes
  already use, and an `<img>` can carry it in the URL where it cannot
  carry a header. Note the trap recorded on 2026-08-31: a photo gate
  proved with `curl -H` is proved against the one caller that could
  never fail.
- Keep it desk-only and grow `tools/split-item.mjs` into something that
  shows contact sheets locally. No new route, no new exposure, but it
  stays maintainer-only — and the people finding these problems are
  testers with phones.
- Accept a sign-in for the edit surface alone, which reopens a decision
  taken deliberately on 2026-08-30.

## What already exists

`tools/split-item.mjs` splits a record. It does it blind and by
argument, which is workable for the maintainer and useless to a tester.
The browse screen's field editing — click to correct, tick to confirm,
promote a reading into its field — is the model this should follow:
every write lands as a confirmed `shelf` value with a name on it, and
none of it makes anything decision-eligible.

**Deletion needs its own thought.** A photograph is the evidence behind
a reading; deleting one after a reading has cited it leaves a claim with
no support. Culling is [[PHOTO-CULL]] and has the same problem in a
larger size.
