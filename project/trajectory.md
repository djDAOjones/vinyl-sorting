# Trajectory

<!-- One line per shipped item. -->
- M0-ARCHIVE-FREEZE — 87 source files frozen with sha256; venv/cache artefacts excluded by declaration, token digest redacted (2026-08-30) — see decision-log
- M0-REPAIR-ENCODING — MacRoman confirmed by byte histogram; two corruptions repaired under 14 fixture tests drawn from the frozen inputs (2026-08-30) — see decision-log
- M0-SPLIT-LABEL-CATNO — 141 backlog rows split against a 98-label gazetteer attested in the data: 31 split, 73 bare catno, 37 refused with reasons (2026-08-30) — see decision-log
- M0-IMPORT-ENRICHED — 305 rows imported with per-field provenance; 277 Discogs-derived and unconfirmed, 0 decision-eligible (2026-08-30) — see decision-log
- M0-IMPORT-REMEDIAL — 141 rows imported needing capture, 210 placeholders dropped with every ID named; dataset now 446 rows (2026-08-30) — see decision-log
- M0-MERGE-LOAD-FILES — all 83 usable rows already present in Remedial: 0 merged, 83 duplicate decisions recorded; dataset stays 446 (2026-08-30) — see decision-log
- M0-IMPORT-AI-WORKS — AI track listings, confidence, remarks and sources attached to 305 rows as guess; no AI ratings exist; 28 AI track listings found hiding in the enriched sheet and reclassified (2026-08-30) — see decision-log
- M0-RECONCILIATION-REPORT — 446-row CSV plus a report naming every source, rule and drop; archive verified unchanged, rebuild byte-identical. M0 complete (2026-08-30) — see decision-log
- OPEN-DISCOGS-TOKEN — token valid (walter_odington); not a seller, which costs only condition-graded price suggestions — lowest price, count for sale and have/want all reachable (2026-08-30) — see decision-log
- OPEN-SYSTEM-OF-RECORD — app database is authoritative; import is one-way and the OneDrive CSV export is a backup, not a round-trip (2026-08-30) — see decision-log
- OPEN-USERS-ACCESS — no sign-in for v1 by maintainer decision; Worker exposes named operations only and capture never calls Discogs, so auth is revisited at M2 (2026-08-30) — see decision-log
- M1-SCHEMA — four-entity D1 schema with the provenance rule enforced by views; 446 rows loaded with 4,681 provenance records and nothing decision-eligible (2026-08-30) — see decision-log
- M1-WORKER — Hono Worker with named operations only; no outbound request exists in M1, so the Discogs token is unreachable rather than merely unused; central rate limiter built and tested ahead of M2 (2026-08-30) — see decision-log
