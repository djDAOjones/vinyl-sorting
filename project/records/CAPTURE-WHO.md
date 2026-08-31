---
id: CAPTURE-WHO
name: A name typed once at the start — crude gate, and the logger for who captured what
summary: capturedBy lost its box when the More block was parked, so a phone that has never had a name typed into it sends nothing; the fix is a name typed once at first launch and checked against the six people who capture, which gates the app crudely and stamps every row afterwards without a field in the capture flow.
status: open
date: 2026-08-31
milestone: icebox
order: 4
---
# A name typed once at the start

`capturedBy` has no box on the capture screen. CAPTURE-ONE-SCREEN parked
the block it lived in, and it was barely reachable before that: a
disclosure to open, then a name to type, every time the phone changed
hands. A device that has never had one sends nothing — absent rather
than guessed, which is right, but it means a row says who read the label
only by accident.

The maintainer's design (2026-08-31) is a simple log in at the start:
**type your name.** It does two jobs at once — a crude, rudimentary
password, and the logger that stamps every row afterwards.

## Typed, not picked

A picker was considered and rejected as more friction, and it is also
self-defeating: a list of six buttons prints the valid answers on the
screen, so it cannot gate anything at all. Typing asks you to know one.

Once per device, and never again — so the interaction cost is one
screen, ever, against a name that reaches every row captured on that
phone for the rest of the project.

## Spelling is handled by the roster, not by the typist

The people are known and there are six: **Joe, Jen, Ro, Ivy, Jojo, Sue.**
The typed name is matched against that list and stored in its canonical
form, so `jojo`, `JOJO` and `JoJo` all land as `Jojo`, and the
free-text spelling problem NAMES-CANONICAL exists to clean up on the
composer side never reaches the data at all. A name not on the list is
refused — and that refusal is the gate.

## What it is not

Six household first names are guessable, and the roster has to live
where the app can read it. This is a speed bump and an honest label on a
row, not access control.

Real access control is OPEN-V1-AUTH, raised in parallel on 2026-08-31
now that the brief's revisit condition has been met. The two are halves
of one word: this item answers **who is holding the phone**, that one
answers **who may write at all**. Shipping this must not be read as
having answered that.

## What it takes

- A first-run screen: one box, one button, refuse an unknown name.
- The name in `dg.who`, which already exists and which both capture and
  the review queue already read.
- Capture sends `capturedBy` on every row, as it did before.
- A way to switch, because the phone will be handed over.
- Nothing on the Worker: `capturedBy` is already accepted and optional.

## Why it is in the icebox

While one person is doing the capturing it buys one field of provenance
on rows nobody is disputing. It earns promotion when a second person
actually starts capturing.
