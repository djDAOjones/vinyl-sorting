---
id: PHOTOS-TO-DESKTOP
name: Pull captured photos and their row ids out for a chat pack
summary: Photos taken on the phone land in R2 and nothing can read them back — the Worker has a PUT and no GET — so the desktop needs a way to fetch them with their item ids, without turning "no route reads a photo" into "one route returns all of them" in an app with no sign-in.
status: open
date: 2026-08-30
milestone: icebox
order: 5
flags: detail
---
# Pull captured photos and their row ids out for a chat pack

`tools/photo-pack.mjs` reads a local directory. Photos taken on the
phone are not in a local directory; they are in R2, and the Worker
exposes `PUT /api/photos/:key` and no GET at all. Today the HTTP
surface can write a photograph and can never read one.

## The obvious design is the wrong one

A zip-download route in the app is the shape this suggests, and it
inverts the property above: "no route reads a photo" becomes "one route
enumerates and returns all of them". In a v1 with **no sign-in**, that
is the household's photographs behind a URL, and unlike the matcher —
which runs from cron and has no caller — an export route exists to be
called. It would want the auth conversation the 2026-08-30 decision
deferred.

## The design that costs nothing

Pull from the desktop, with credentials Joe already has from deploying.
`item_photo` carries `(item_id, r2_key)`, so:

- `wrangler d1 execute` for the pairs,
- `wrangler r2 object get` for each object,
- write `data/label-photos/<item_id>.jpg` and a `row-ids.csv`.

`photo-pack.mjs` then runs unchanged, and the row ids are `item.id` —
which is exactly what ties a reading back to a record, and better than
the filename stems the spike falls back to.

No new route, no new exposure, no auth conversation, and the M1/M2
invariant about what the HTTP surface can reach survives intact.

**To check first:** whether wrangler can enumerate and fetch R2 objects
the way this assumes. If it cannot, the fallback is a route carrying a
shared secret, and that is a smaller conversation than a public export.

## On the zip itself

Keep the zip as transport only — download, unzip on the desktop, drag
the loose images into the chat. Whether ChatGPT's vision reads images
out of an uploaded zip is genuinely unclear (its code interpreter can
unzip; whether the extracted files reach the vision path is not
documented either way), and no part of this should depend on the
answer.
