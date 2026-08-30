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
- M1-CAPTURE-UI — photo-first offline capture PWA; verified in-browser that a capture survives a hard refresh and syncs when the Worker appears, with the app measuring its own median entry time (2026-08-30) — see decision-log
- M2-MATCHER — corroboration gate ported and live-tested; 277 existing matches re-verified, 12 unsupported including 4 labelled "Exact" and several pointing at a different record entirely (2026-08-30) — see decision-log
- M2-REVIEW-QUEUE — keyboard-driven queue built and verified in-browser; a type-ahead race that silently mis-filed decisions found and fixed, and a cache-first service worker that would have blocked every future deploy (2026-08-30) — see decision-log
- M2-MATCHER (follow-up) — throttling fix measured: the same 60-row sample went from 53 false "nothing found" to 4 verified and 36 needing review, with 0 failed queries (2026-08-30) — see decision-log
- OPEN-SELL-THRESHOLD — value never earns a keep; sell only above £10, keep only for musical reasons (2026-08-30) — see decision-log
- OPS-SPEND-GUARD — Free plan confirmed, so D1's 100k/day refusal is the real wall; per-tick write budget and query accounting shipped as redundancy, and a cpu_ms limit that made the Worker undeployable was found and removed (2026-08-30) — see decision-log
- CAPTURE-BULK-PHOTOS — a crate photographs in one pass, one row per photo, nothing typed; bulk rows carry only crate, position and capturer, so no disc's catalogue number can reach another's row, and a rejected photo no longer blocks the crate behind it (2026-08-30) — see decision-log
- CAPTURE-LOCATION — crate no longer required, no longer sticky and folded into More, after the first real capture arrived as crate "1" position "1"; a downscale that ran only on the bulk path found and fixed, so one photo queues at 370 KB rather than 6.45 MB (2026-08-30) — see decision-log
- CAPTURE-MANY-PHOTOS — a capture takes several photographs, one per kind, because the catalogue number and the title are rarely in one frame; no schema or Worker change was needed, and photos-pull now states how many photographs it is not pulling (2026-08-30) — see decision-log
- CAPTURE-UNDESCRIBED — the app stops asking what a photograph shows and stores every capture as `other` (migration 003), because with no consistency to describe, any kind would be an invented fact; photo-pack now batches by record so a disc's shots stay together (2026-08-30) — see decision-log
