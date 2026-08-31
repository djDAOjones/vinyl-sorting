---
id: CAPTURE-NEXT-DISC
name: Queue from inside the viewfinder, so a crate never leaves the camera
summary: Photographing one disc costs three taps that are not the shutter and restarts the camera every time, so a Next disc control goes in the camera bar — one tap files the disc, zeroes the count and keeps the viewfinder open, while Done keeps its current meaning because a Done that also queued would split one disc into two on any mis-tap.
status: open
date: 2026-08-31
milestone: current
order: 2
---
# Queue from inside the viewfinder

Approved by the maintainer, 2026-08-31.

Photographing one disc today costs N shutter taps plus three that are
not: **Photograph** to open the camera, **Done** to close it, **Queue
it** to file it. The camera also restarts for every disc — a tap, a
black frame and a fresh `getUserMedia` each time.

A third control in the camera bar:

- **Shutter** — photograph
- **Next disc · 3** — queue what has been shot, count to zero,
  viewfinder stays open
- **Done** — leave the camera for the form, exactly as now

That is N + 1 per disc, and after the first the camera never closes.
Typing stays behind Done, which makes typing the exception rather than
the default — which is what photo-first has meant all along.

## Why Done does not simply queue

Auto-queueing on Done was considered and rejected. Done and "this is one
disc" are different claims: Done is what you press to check a frame, to
type a catalogue number, because somebody spoke to you. A premature one
files a disc with two of its four photographs and turns the remaining
two into a SECOND disc — one record silently becoming two, which is
exactly the fault CAPTURE-ONE-SCREEN deleted along with the crate mode.
There is no un-queue: entries drain on their own.

## The mis-tap, and the undo

Next disc carries the same risk, bounded rather than removed: it is an
explicit control that says what it does, carries the count, and sits
away from the shutter.

To take it to zero, hold the entry back from `drain()` for ~5 s and let
the flash offer **Undo**. The entry still lands on disk before anything
else, so the offline guarantee is untouched — only the send waits.

## Costs, stated

A viewfinder open across a whole crate costs battery and keeps the
camera indicator lit. Worth it for a crate; Done is still there for a
pause.

## Done when

- One tap files a disc, the count resets and the viewfinder stays open.
- Done still reaches the form with the photographs intact.
- A mis-tap is recoverable, or the reason it need not be is written down.
- Verified in-browser at 375x812 and 667x375, as CAPTURE-ONE-SCREEN was.
