---
id: BROWSE-PHOTOS
name: May a route serve a label photograph, now that browse wants to show one?
summary: DATASET-VIEWER asked for GET /api/photos/:key so the browse screen could render the label photographs, and photos-pull.test.mjs asserts that no such route exists because with no sign-in it puts the household's photographs behind a URL — two live records disagree, so the screen ships listing the keys and the question goes to the maintainer.
status: open
date: 2026-08-31
milestone: current
order: 9
flags: sign-off
---
# May a route serve a label photograph?

**Raised by splitting DATASET-VIEWER, 2026-08-31.** The browse screen
shipped without it: it lists each photograph's key, when it was taken
and how many there are, and does not render the image.

## The disagreement, in the two records' own terms

**DATASET-VIEWER asked for the route.** "The photographs actually
rendered, which needs the one Worker route that does not exist yet:
`GET /api/photos/:key`, streaming the R2 object back. R2 has no public
bucket URL here and should not get one." Its reasoning is that a Worker
route is the *safe* alternative to a public bucket.

**PHOTOS-TO-DESKTOP forbids it, and tests for it.**
`photos-pull.test.mjs` asserts `!/app\.get\([^)]*photos/` against
`worker/index.ts`, with the reason written into the assertion: "with no
sign-in that is the household's photographs behind a URL". The pull
tool exists *because* the Worker has a PUT and no GET.

## What decides it, and it is not preference

`GET /api/items/:id` is already open and already returns every
`r2_key`. So a photo GET is not one hard-to-guess URL per photograph —
it is an enumerable archive: walk the ids, read the keys, fetch the
images. Any answer that treats the key's randomness as the protection
is wrong about the shape of the surface.

The route was built and tested during DATASET-VIEWER and then withdrawn
rather than shipped, because the alternative was editing another
record's security test — which is a stop-and-ask boundary twice over.

## The options, none of them chosen here

- **Leave it.** Browse lists keys; `photos-pull` fetches to a desk. The
  screen is worth having without the images, which is the evidence for
  this option: it shipped and is useful.
- **Put the GET behind `EDIT_TOKEN`.** The passphrase OPEN-V1-AUTH
  already signed off for the edit endpoints, reused for reading photos.
  Cheap, and consistent with "the bolt goes on the drawer worth
  bolting" — but it makes a read endpoint the first thing a new
  capturer must be handed a secret for.
- **Cloudflare Access in front of everything**, which the OPEN-V1-AUTH
  entry names as the known next step, not ruled out.

Whichever is chosen, `photos-pull.test.mjs` has to be amended to say
the new rule, and that file belongs to PHOTOS-TO-DESKTOP.

## Rethink triggers already on record

OPEN-V1-AUTH listed them: the passphrase starts feeling like the wrong
shape; anyone outside the household needs to capture; a junk-row flood
arrives through the open capture endpoint; the collection becomes worth
more than the inconvenience of signing in. This item is a fifth: a
screen wants to read what only a desk tool can reach today.
