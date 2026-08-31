# Backlog

<!-- GENERATED between markers: edit project/records/, run tools/gen-backlog.mjs. -->

## Active

<!-- generated:records:start (edit records/, run gen-backlog) -->

### Current milestone

<!-- Intent: M2, the photo path and the browse screen, side by side. M2 is deployed and every row now carries a match_run, so its remaining work is maintainer work — clearing 287 needs-review by keyboard. Migration 004 reached production on 2026-08-31, so a photo reading can now be promoted there. The photo path was promoted out of the icebox on 2026-08-30 because it is the buildable work, and because the brief's stated risk is building the app instead of cataloguing the records; DATASET-VIEWER and DATASET-EDIT joined it on 2026-08-31, because 465 catalogued rows can currently be neither seen nor corrected anywhere in the app. -->

- [~] **SPIKE-PHOTO-TO-FIELDS Can a label photograph populate the
  capture fields?** [spike] [blocked: twenty photographed labels with
  typed ground truth] (2026-08-30) — The round trip is built, tested and
  in the gate — each pack is a directory a session reads in place with no
  upload as well as a zip for browser chat, the reply imports under id
  checks, and the scorer keeps refusals apart from wrong answers; twenty
  photographed labels are now the only thing left, because synthesising
  labels would score the model against its own output.
- [ ] **CAPTURE-MERGED-ROWS Two discs photographed into one row — split
  453 and 455** (2026-08-31) — Item 453 was twelve photographs of two
  records and was split at photograph 7 on maintainer instruction, giving
  a new item 466; 455 shows the same signature less certainly and still
  needs a person to look, and neither may be promoted until its reading
  describes one disc.
- [~] **PHOTOS-TO-DESKTOP Pull captured photos and their row ids out for
  a chat pack** [detail](records/PHOTOS-TO-DESKTOP.md) (2026-08-30) —
  Built, gated and live — photos-pull reads (item_id, r2_key) pairs from
  D1 and fetches each object by name, writing data/label-photos plus a
  ground-truth starter taken from the values a person typed into capture;
  R2 is now attached and a photo has made the full round trip, so all that
  is left is photographs being taken.
- [~] **M2-FIRST-RUN Run the matcher over all 446 and clear the queue
  once** — The operation, not the code — deployed and run as of
  2026-08-31, every row carrying a match_run and 287 sitting in
  needs-review, so all that remains is a person clearing the queue by
  keyboard.
- [ ] **TRACKLIST-CAPTURE Capture tracklists — from Discogs first, from
  photographs only where that fails** (2026-08-31) — release_track has
  held zero rows since M1 because the Worker's getRelease is never called,
  so the tracklist Discogs already returns for every accepted match is
  fetched, scored and discarded — and a tracklist is the field that says
  what a pressing actually is when a catalogue number is shared, which is
  exactly the tie the corroboration gate cannot currently break.
- [~] **M2-DISCOGS-PACING Tune Discogs pacing — 7 of 12 queries still
  fail in the Worker** (2026-08-30) — Measured on 16 promoted photo
  readings — a richer reading costs 9.4-12 queries against capture-only's
  4.7, so 5 of 11 rows errored on Discogs throttling or Cloudflare's
  per-invocation subrequest cap, and one item collected two runs because a
  row outlasting the five-minute cron period is selected twice.

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
- [ ] **NAMES-CANONICAL One canonical form per composer and performer,
  resolved after capture** (2026-08-31) — A label prints TSCHAIKOWSKY,
  Tchaikovsky, P.I. Tschaikowsky and Pyotr Ilyich Tchaikovsky for one man,
  and clustering cannot group performances of a work until those resolve
  to one composer — so the raw string stays untouched and a resolution
  layer sits between it and every decision view.
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
