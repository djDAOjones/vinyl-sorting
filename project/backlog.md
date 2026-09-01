# Backlog

<!-- GENERATED between markers: edit project/records/, run tools/gen-backlog.mjs. -->

## Active

<!-- generated:records:start (edit records/, run gen-backlog) -->

### Current milestone

<!-- Intent: M2 plus the interface brief of 2026-08-31. M2's own remainder is maintainer work — clearing 287 needs-review by keyboard — and the app moves to its real URL, gains a home page and a settings screen, and is rebuilt on one visual language. The two meet at the review queue: REVIEW-CARD and MATCH-OTHER-NUMBERS exist to make clearing it cheaper, not prettier. -->

- [ ] **APP-RENAME Set EDIT_TOKEN on the renamed Worker** (2026-09-01) —
  The move to vinyl-sorter is done and the old script is deleted, but
  Worker secrets are per-script and EDIT_TOKEN did not come across — so
  correcting a reading and downloading an export both answer 503 until one
  command is run.
- [~] **SPIKE-PHOTO-TO-FIELDS Can a label photograph populate the
  capture fields?** [spike] [blocked: ground truth typed to the scorer's
  columns — `decoy_numbers` above all] (2026-08-30) — The round trip has
  now run end to end — crate 3, six records read blind and scored — and it
  fails, but on schema rather than on reading: ten of fourteen wrong
  values are two documents answering different questions, and the decoy
  check that the whole spike exists for never ran at all, because
  `decoy_numbers` was not a column the typed sheet had. Photographs are no
  longer the blocker; ground truth typed to the scorer's own columns is.
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
  fail in the Worker** (2026-08-30) — A richer reading costs 9.4-12
  queries against capture-only's 4.7, which broke the matcher three ways —
  Discogs throttling, Cloudflare's per-invocation subrequest cap and a row
  selected twice; all three are fixed and the interval now learns its own
  level from the refusal rate rather than being tuned by hand, backing off
  entirely when a tick reaches nothing.
- [ ] **OPEN-RECATALOGUE Photograph the 446 imported rows rather than
  review them by keyboard?** [sign-off] (2026-08-31) — Every one of the
  293 items in the review queue is a legacy spreadsheet row and 267 of
  them have no label, which is exactly why the corroboration gate refuses
  them — so photographing those discs would supply the missing signal
  family and shrink the queue, and the question is whether handling 267
  discs costs less than deciding 293 blind.

### Next milestone

<!-- Intent: The half of the interface brief needing data the database does not hold — value and genre, a re-verification sweep for when the backlog empties, and readings that name their source photograph. Each blocked on a migration, a backfill or a pack-format change rather than on M2. -->

- [~] **CATALOGUE-CONTROLS Sort, filter and choose columns on the
  collection screen** (2026-08-31) — The interface half is done — every
  column sortable and choosable, five named views including the mop-up
  crate, and the whole view in the URL — so what remains is the two sorts
  that need data the database does not hold: value, which needs a price
  backfill, and genre, which needs a migration.
- [ ] **AI-ROUND-TRIP Make the hand-carried reading loop fast, and make
  it say which photograph it read** (2026-08-31) — The maintainer kept the
  no-metered-services rule, so the answer is a better round trip rather
  than an API — and its biggest missing field is provenance, because a
  number off a disc label and one in sleeve small print arrive with
  identical standing.
- [ ] **NAV-HOME Every screen needs a visible way back to the hub**
  [detail](records/NAV-HOME.md) (2026-09-01) — The keyboard already goes
  home — `g` then `h` — but a phone has no keyboard, and capture opens
  full-screen into the camera by design, so on the device the app is
  actually used on there is no way back to the menu except the browser's
  own chrome, which a home-screen PWA does not show.
- [ ] **RECORD-EDIT-PHOTOS Edit a record's photographs — delete, add,
  and split by selection** [blocked: whether a photo-reading route can
  exist without a sign-in] (2026-09-01) — Browse can already correct every
  field, but its photographs are listed by key and never shown, because
  serving one needs a Worker GET that a sign-in-free v1 deliberately does
  not have; so deleting a bad shot, adding a missing disc label, or
  splitting a record by picking which photos go where is desk work through
  split-item.mjs, blind, and only reachable by whoever has the
  credentials.
- [ ] **PHOTO-CULL Cull photographs that carry no text no other shot
  carries** [detail](records/PHOTO-CULL.md) (2026-09-01) — Crate 3 took 34
  photographs of 6 records and roughly a fifth were re-shoots of the same
  corner, which cost pack space and reading attention and bought nothing;
  a proposed rule set keeps one whole-sleeve view for identification plus
  every shot that is the sole source of some value, and proposes the rest
  for deletion rather than deleting them, because a cull driven by an
  extraction lets a bad reading destroy its own evidence.

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
