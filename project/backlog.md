# Backlog

<!-- GENERATED between markers: edit project/records/, run tools/gen-backlog.mjs. -->

## Active

<!-- generated:records:start (edit records/, run gen-backlog) -->

### Current milestone

<!-- Intent: M0 — reconcile the existing spreadsheets into one clean, provenance-tagged dataset. No app required; can start now. -->

- [ ] **M0-MERGE-LOAD-FILES Merge 83 usable rows from the load-to-add
  files** — Merge the 83 usable rows out of 1st and 2nd load to add.xlsx
  into the single dataset, de-duplicating against rows already imported.
- [ ] **M0-IMPORT-AI-WORKS Import AI Works columns as guess provenance
  only** — Import the AI-generated ratings and track listings tagged
  source=guess so they can be displayed but can never feed a cluster,
  coverage check, sell list or shortlist.
- [ ] **M0-RECONCILIATION-REPORT One clean CSV plus a reconciliation
  report** — Produce the single reconciled CSV and a report stating what
  came from where and what was dropped — the M0 done-when, and the gate on
  starting M1.

### Next milestone

<!-- Intent: M1 — schema, Worker skeleton and the offline capture screen, so a disc can be captured in a loft with no signal. Plus the open questions that gate it. -->

- [ ] **M1-CAPTURE Schema, Worker skeleton and the capture screen** — D1
  schema per the brief section 03, Hono Worker with Access sign-in and the
  Discogs token as a secret, and the photo-first offline capture form;
  then import M0's dataset.
- [ ] **OPEN-DISCOGS-TOKEN Is the existing Discogs token live, and is
  the account a seller?** [sign-off] [security] (2026-08-30) — The token
  in Pre August 2026/Windsurf Projects/ has not been opened; seller status
  affects which price data is reachable and therefore what the sell list
  and shortlist ranking can use.
- [ ] **OPEN-USERS-ACCESS Who else is capturing — Access or a shared
  passphrase?** [sign-off] (2026-08-30) — Determines whether Cloudflare
  Access is worth configuring or a shared passphrase suffices, which
  changes the M1 sign-in build.
- [ ] **OPEN-SYSTEM-OF-RECORD Is the app database the system of record,
  or does OneDrive stay authoritative?** [sign-off] (2026-08-30) — The
  brief assumes the app database is authoritative with a nightly CSV
  export to OneDrive; confirming this decides whether import is one-way
  and whether CSV export is a convenience or a contract.

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
