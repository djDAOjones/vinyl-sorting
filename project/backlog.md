# Backlog

<!-- GENERATED between markers: edit project/records/, run tools/gen-backlog.mjs. -->

## Active

<!-- generated:records:start (edit records/, run gen-backlog) -->

### Current milestone

<!-- Intent: M2 — the matcher and the review queue. Re-verify all 446 under a corroboration gate that treats a catalogue number as a lead, then clear the queue by keyboard. Promoted 2026-08-30 after M1 shipped. -->

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

<!-- Intent: M2–M5 — verify, resolve works, cluster and decide. Committed and sequenced behind capture; trigger is the milestone before it going green. -->

- [ ] **OPEN-SELL-THRESHOLD Sell threshold — what happens to a valuable
  losing copy?** [sign-off] (2026-08-30) — A copy that loses its shootout
  but turns out to be worth £80: sell it, or keep it as an asset? Worth
  deciding once rather than per record.
- [ ] **OPEN-PASSAGE-SELECTION Should the app propose the comparison
  passage?** [sign-off] (2026-08-30) — Whether the app proposes the
  two-to-three-minute comparison passage from the track listing, or the
  listener always chooses it themselves.
- [~] **OPS-SPEND-GUARD Spend guard — cap what a runaway cron can cost**
  [maintainer] (2026-08-30) — Cloudflare has no hard dollar cap, so the
  ceiling has to be built; the code half is in — cpu_ms is capped and the
  matcher stops at a per-tick write budget and says so — leaving the $10
  budget alert and a ceiling set from the first full run's measured
  volume.
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
