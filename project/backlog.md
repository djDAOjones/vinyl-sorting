# Backlog

<!-- GENERATED between markers: edit project/records/, run tools/gen-backlog.mjs. -->

## Active

<!-- generated:records:start (edit records/, run gen-backlog) -->

### Current milestone

<!-- Intent: M1 — schema, Worker skeleton and the offline capture screen, so a disc can be captured in a loft with no signal. Promoted 2026-08-30 once its three sign-off questions were answered: no sign-in, app database authoritative, token valid and not a seller. -->

- [ ] **M1-WORKER Hono Worker with named operations and the token as a
  secret** — A Hono Worker exposing only the operations capture needs,
  holding DISCOGS_TOKEN as a secret it never proxies openly, with central
  rate limiting ready for M2.
- [ ] **M1-CAPTURE-UI Photo-first offline capture screen** — The PWA
  capture form that works with no signal in a loft — photo first, six
  fields, queued in IndexedDB, surviving a hard refresh.

### Next milestone

<!-- Intent: Empty — M2 is the next committed milestone but stays in the icebox until capture is real. Promoting it is the trigger to revisit auth, per OPEN-USERS-ACCESS. -->

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
- [ ] **M2-MATCHER Normalisation, sanity check, query ladder, scoring
  and the corroboration gate** — The matcher that treats a catalogue
  number as a lead rather than a verdict — two independent signal families
  must agree with a clear margin over the runner-up before anything is
  auto-accepted.
- [ ] **M2-REVIEW-QUEUE Keyboard-driven review queue, and re-verify all
  446** — The screen that decides the project — one item at a time,
  capture on the left, top five scored candidates on the right, cleared
  entirely by keyboard; first job is re-verifying all 446 existing rows.
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
