---
id: PHOTOS-TO-DESKTOP
name: Pull captured photos and their row ids out for a chat pack
summary: Built and gated — photos.pull reads (item_id, r2_key) pairs from D1 and fetches each object by name, writing data/label-photos plus a ground-truth starter taken from the values a person typed into capture; it cannot run until R2 is switched on in the dashboard, which is why no photograph has ever left a phone.
status: in-progress
date: 2026-08-30
milestone: current
order: 4
flags: detail, blocked
blocked-on: R2 is not enabled on the Cloudflare account, so no photo has ever reached the bucket
---
# Pull captured photos and their row ids out for a chat pack

`tools/photo-pack.mjs` reads a local directory. Photos taken on the
phone are not in one; they belong in R2, and the Worker exposes
`PUT /api/photos/:key` and no GET at all.

## Built and green (2026-08-30)

`node tools/photos-pull.mjs` — one query, one fetch per object, no new
route.

- **Pairs come from D1, never from a bucket listing.** `item_photo`
  carries `(item_id, r2_key)`, which was the record's open question and
  the schema answers it. A tool that enumerated R2 would be one step
  from the export route this design exists to avoid.
- **It is read-only against production**, and tests assert it: no
  INSERT, UPDATE, DELETE, DROP, ALTER or CREATE, and `get` as the only
  R2 verb. It runs with real credentials against `--remote`, so a stray
  verb would be a production write rather than a failing test.
- **The row ids are `item.id`** — what actually ties a reading back to
  a record, and better than the filename stems the spike falls back to.
- **Ground truth is generated, not retyped.** `capture` holds what a
  human read off the label, which is the definition of ground truth
  here, so the CSV is written from it with only `decoy_numbers` left
  blank. Retyping those values would be transcribing them twice and
  inviting a discrepancy. An existing file is never overwritten — the
  decoys are the expensive half.

## The obvious design is still the wrong one

A zip-download route in the app inverts the property that keeps a
sign-in-free v1 safe: "no route reads a photo" becomes "one route
enumerates and returns all of them". Unlike the matcher, which runs
from cron and has no caller, an export route exists to be called. A
test now asserts the Worker still has a photo PUT and no photo GET.

## Why nothing has come through yet

**R2 is not enabled on the account.** `[[r2_buckets]]` is commented out
in `wrangler.toml` because a binding to a bucket that cannot exist
fails the deploy, so the live Worker has no `PHOTOS` binding and every
photo upload returns 503. The app does the right thing — it keeps them
queued — but the consequence is that no photograph has ever left a
phone, and the capture screen gives no sign of it.

`tools/deploy.sh` now attaches the binding itself once R2 answers,
rather than asking for a hand-edit of TOML, and says plainly what is
lost while it is off.

**Done when** a photograph taken on the phone appears in
`data/label-photos/` named by its item id.
