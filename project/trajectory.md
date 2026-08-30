# Trajectory

<!-- One line per shipped item. -->
- M0-ARCHIVE-FREEZE — 87 source files frozen with sha256; venv/cache artefacts excluded by declaration, token digest redacted (2026-08-30) — see decision-log
- M0-REPAIR-ENCODING — MacRoman confirmed by byte histogram; two corruptions repaired under 14 fixture tests drawn from the frozen inputs (2026-08-30) — see decision-log
- M0-SPLIT-LABEL-CATNO — 141 backlog rows split against a 98-label gazetteer attested in the data: 31 split, 73 bare catno, 37 refused with reasons (2026-08-30) — see decision-log
- M0-IMPORT-ENRICHED — 305 rows imported with per-field provenance; 277 Discogs-derived and unconfirmed, 0 decision-eligible (2026-08-30) — see decision-log
- M0-IMPORT-REMEDIAL — 141 rows imported needing capture, 210 placeholders dropped with every ID named; dataset now 446 rows (2026-08-30) — see decision-log
- M0-MERGE-LOAD-FILES — all 83 usable rows already present in Remedial: 0 merged, 83 duplicate decisions recorded; dataset stays 446 (2026-08-30) — see decision-log
- M0-IMPORT-AI-WORKS — AI track listings, confidence, remarks and sources attached to 305 rows as guess; no AI ratings exist; 28 AI track listings found hiding in the enriched sheet and reclassified (2026-08-30) — see decision-log
