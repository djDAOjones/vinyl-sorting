---
id: APP-HOME-HUB
name: A home page that names the four things the app does
summary: Three screens exist and none of them is a front door — capture sits at the root, so the collection and the review queue are reachable only from each other, and a new screen has nowhere to be announced.
status: open
date: 2026-08-31
milestone: current
order: 1
---
# A home page

## The shape

`/` becomes a hub — four large targets: **Add vinyl**, **Resolve
entries**, **The collection**, **Settings** — each with a live count
underneath, because a button that says how much work is behind it is
worth four that do not.

Capture moves to `/capture`.

## The one thing that must not regress

The brief's stated risk is building the app instead of cataloguing the
records, and capture is tuned around it: nothing between the shutter
and Queue it. Putting a menu in front of the camera is exactly the tax
that principle refuses.

So the manifest's `start_url` becomes `/capture`. **A phone that has
the app on its home screen still opens straight into the camera** — the
hub is for the desk and for anyone arriving at the bare URL. The two
audiences get different front doors and neither pays for the other.

## Back-links

Every screen gets a way home, in the same place on each. Capture keeps
its exemption in the loft — but it gains one at the top, small, where
the current build has nothing at all.

**Done when** every screen can reach every other screen without the URL
bar, and an installed phone still opens the camera first.
