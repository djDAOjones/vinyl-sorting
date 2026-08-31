---
id: CAPTURE-WHO
name: Say who is capturing — pick a name once, rather than type one every time
summary: capturedBy lost its box when the More block was parked and was barely reachable before that, so a phone that has never had a name typed into it sends nothing; the household is six known people, which is a list to pick from rather than a field to type into, and picking is identification rather than the access control OPEN-USERS-ACCESS deferred.
status: open
date: 2026-08-31
milestone: icebox
order: 3
---
# Say who is capturing

`capturedBy` has no box on the capture screen. CAPTURE-ONE-SCREEN parked
the block it lived in, and it was barely reachable before that: a
disclosure to open, then a name to type, every time the phone changed
hands. A device that has never had one typed into it now sends nothing
at all — absent rather than guessed, which is right, but it means the
provenance of a capture says who read the label only by accident.

The maintainer's proposal (2026-08-31) is a simple log in. The people
are known and there are six of them: **Joe, Jen, Ro, Ivy, Jojo, Sue.**

Six names is a list, not a free-text field. Typing manufactures
spellings — `jo`, `Jojo`, `JoJo` — of exactly the kind NAMES-CANONICAL
exists to resolve on the composer side, and there is no reason to invent
the same problem for six people whose names are already known. One tap,
once per device, sticky afterwards.

## Identification, not access control

Worth stating plainly, because the words overlap and the difference is
the whole size of the item.

The brief records **no sign-in for v1** (OPEN-USERS-ACCESS, 2026-08-30).
That decision was about whether the Worker needs authentication before
M2 puts the Discogs token behind a public endpoint. A name picker with
no password answers a different question — which of six known people is
holding the phone — and can ship without reopening it.

If what is wanted is also a gate — a password, an account, a queue only
its owner can clear — that IS OPEN-USERS-ACCESS, and the brief already
says it reopens at M2. Whoever promotes this record should say which of
the two is meant. They are different builds, and only one of them is
small.

## What the small version takes

- A chooser on first launch: six buttons, no keyboard. Stored in
  `dg.who`, which already exists and which both screens already read.
- A way to change it, because the phone will be handed over.
- Capture sends `capturedBy` on every row, as it did before.
- Nothing on the Worker. `capturedBy` is already accepted and already
  optional.

## Why it is in the icebox

The value is real but small while one person is doing the capturing:
one field of provenance on rows nobody is disputing yet. It earns
promotion when a second person actually starts capturing, or when the
log in is wanted for access control too — at which point it stops being
this item.
