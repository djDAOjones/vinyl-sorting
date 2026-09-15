---
id: AUTO-SOURCE-PREPARATION
name: Automatic source preparation for unresolved records
summary: Prepare MusicBrainz evidence in the background and retry changed Discogs inputs, retaining source distinctions and bounded failure states for review.
status: in-progress
milestone: current
date: 2026-09-15
---
# Automatic source preparation

User approved default multi-source preparation for the unresolved queue.
Use existing cron and bindings, save source evidence outside catalogue tables,
skip human-confirmed and auto-accepted records, and expose saved results without
requests to providers from page loads. Changed inputs invalidate evidence.
Failures retry at bounded intervals before asking for manual attention.

Validate selection, concurrency, failure bounds, changed evidence, provenance,
read-only browsing and responsive rendering. Deploy after the full gate/build.
No new dependency or schema; work/performance linking remains M3.
