---
id: AUTO-SOURCE-PREPARATION
name: Automatic source preparation for unresolved records
summary: Prepare MusicBrainz evidence in the background and retry changed Discogs inputs, retaining source distinctions and bounded failure states for review.
status: in-progress
flags: blocked, maintainer
blocked-on: Explicit payload and destination approval requested by automatic deployment review
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

## Implementation ready; deployment pending

Code commit `2dc0563` passes 385 tests, typecheck, build and desktop/mobile
fixtures. Automatic approval review rejected `wrangler deploy` on 2026-09-15:
it acknowledged approval of automatic source preparation but required explicit
approval of the saved metadata payload and external destinations. No deployment
ran. Keep the existing live manual preview unchanged until this is resolved.

Concrete approval scope: automatic searches using saved catalogue numbers and
aliases, label, title, artist/performer names and year, with unconfirmed photo
readings filling missing human readings. Destinations: Discogs database search
and MusicBrainz release search. No photographs, edit passphrase, tokens, capturer
names, storage locations or personal notes are sent as search metadata. Provider
results persist in the existing private R2 bucket as unconfirmed review evidence.
No schema changes or automatic human confirmation.

Evidence: ignored `project/reports/auto-source-preparation-2026-09-15/`.
