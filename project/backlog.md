# Backlog

<!-- GENERATED between markers: edit project/records/, run tools/gen-backlog.mjs. -->

## Active

<!-- generated:records:start (edit records/, run gen-backlog) -->

### Current milestone

<!-- Intent: M2 and the photo path, side by side. M2's remaining work is all maintainer work — all 446 rows already have a match_run from the local runner, so what is left is a deploy and clearing the queue by keyboard. The photo path was promoted out of the icebox on 2026-08-30 because it is the buildable work, and because the brief's stated risk is building the app instead of cataloguing the records. -->

- [~] **SPIKE-PHOTO-TO-FIELDS Can a label photograph populate the
  capture fields?** [spike] [blocked: twenty photographed labels with
  typed ground truth] (2026-08-30) — The round trip is built, tested and
  in the gate — each pack is a directory a session reads in place with no
  upload as well as a zip for browser chat, the reply imports under id
  checks, and the scorer keeps refusals apart from wrong answers; twenty
  photographed labels are now the only thing left, because synthesising
  labels would score the model against its own output.
- [~] **PHOTOS-TO-DESKTOP Pull captured photos and their row ids out for
  a chat pack** [detail](records/PHOTOS-TO-DESKTOP.md) [blocked: R2 is not
  enabled on the Cloudflare account, so no photo has ever reached the
  bucket] (2026-08-30) — Built and gated — photos.pull reads (item_id,
  r2_key) pairs from D1 and fetches each object by name, writing
  data/label-photos plus a ground-truth starter taken from the values a
  person typed into capture; it cannot run until R2 is switched on in the
  dashboard, which is why no photograph has ever left a phone.
- [ ] **M2-FIRST-RUN Run the matcher over all 446 and clear the queue
  once** — The operation, not the code — deploy, let the cron matcher work
  through all 446 rows, then clear the review queue by keyboard.
- [~] **M2-DISCOGS-PACING Tune Discogs pacing — 7 of 12 queries still
  fail in the Worker** (2026-08-30) — Spacing requests 2s apart made the
  deployed matcher work, but a majority of queries still fail, costing
  recall; the gap is now tunable without a deploy and every run records
  its failures, so the remaining work is measuring rather than building.

### Next milestone

<!-- Intent: Empty — M3 (works, performances, per-track completeness) is next but stays in the icebox until the review queue has been cleared once. -->

### Icebox

<!-- Intent: M3–M5 — resolve works, cluster and decide — committed and sequenced, each triggered by the milestone before it going green; plus the open questions those milestones need answered, which unblock on their own evidence rather than on a milestone. The photo path left here on 2026-08-30. -->

- [ ] **OPEN-PASSAGE-SELECTION Should the app propose the comparison
  passage?** [sign-off] (2026-08-30) — Whether the app proposes the
  two-to-three-minute comparison passage from the track listing, or the
  listener always chooses it themselves.
- [ ] **M3-WORKS-PERFORMANCES MusicBrainz works, performances and
  per-track completeness** — Resolve work and recording identity from
  MusicBrainz, resolve composers for the 131 Various/Unknown rows, and
  attach real per-track completeness so clustering stops relying on the
  track-count heuristic.
- [ ] **M4-CLUSTERS-CONTRAST Cluster building, contrast scoring and
  shortlisting** — Build clusters from complete performances, score how
  far apart two readings are before any listening happens, and shortlist
  large clusters to three with the remainder visibly set aside and
  recallable.
- [ ] **M4-COMPILATION-COVERAGE Compilation coverage check** — For each
  of the 132 compilations, answer per track whether that work is owned on
  a record being kept — disposing of 43% of the collection without a
  record going on the turntable.
- [ ] **M5-SHOOTOUT-SELL-LIST Blind shootout sessions, three outcomes,
  and the sell list** — Session cards sized to a sitting, blind scoring
  with performance and sound scored separately, keep-one / keep-several /
  defer, and the valuation pass feeding shortlists and the sell list.

<!-- generated:records:end -->
