---
id: NAV-HOME
name: Every screen needs a visible way back to the hub
summary: The keyboard already goes home — `g` then `h` — but a phone has no keyboard, and capture opens full-screen into the camera by design, so on the device the app is actually used on there is no way back to the menu except the browser's own chrome, which a home-screen PWA does not show.
status: open
date: 2026-09-01
milestone: next
order: 4
flags: detail
---
# Every screen needs a visible way back to the hub

Raised by the maintainer on 2026-09-01, after a testing pass through
capture on a phone.

## What exists, and why it is not enough

`g` then a letter goes — `h` home, `a` add, `r` resolve, `c`
collection, `s` settings — and `?` lists them. That is the whole of
navigation between the five screens, and it is keyboard-only.

The phone is the device capture was built for. It has no keyboard, and
the app's manifest starts at `/capture` rather than the hub precisely so
that a home-screen icon opens straight into the camera. Both decisions
are right and neither should change. Together they mean the primary
device reaches exactly one screen and cannot leave it: a PWA launched
from the home screen has no address bar and no back button, so the
browser chrome that rescues this on the desk is not there.

## What it must not break

- **Nothing goes between the shutter and Queue it.** Capture takes the
  whole screen with one tap per photograph and no confirm step. A home
  control that can be hit while aiming would cost a crate.
- **Landscape puts controls on the right-hand edge**, where they cost
  width rather than the height a phone has little of. Any new control
  follows that rule or it is wrong in the orientation people shoot in.
- The keyboard shortcuts stay. This is an addition for the phone, not a
  replacement for the desk.

## Open question

Whether capture is the exception — reached by **Done** rather than by a
persistent control — or whether it too carries one. Capture is the
screen most at risk from a stray tap and the only one a phone opens
into, which argues both ways.
