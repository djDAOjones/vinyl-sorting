---
id: MUSICBRAINZ-RECOVERY
name: Recover unresolved records with MusicBrainz candidate evidence
summary: Deploy recovery, queue the fourteen zero-query pilot records with newer readings, and add a guarded MusicBrainz preview that keeps source evidence separate from confirmed catalogue data.
status: in-progress
milestone: current
date: 2026-09-15
---
# Recovery and second-source candidates

Joe accepted the source pilot recommendation: retry usable inputs first, then
add MusicBrainz candidates. Preserve old attempts and all capture provenance.

The preview uses stored fields, bounded searches, shared pacing, source links,
format/coupling differences and explicit request failure/truncation. It never
links a release, confirms a field, or feeds clusters or sale decisions.
No new dependency or schema change. Use the existing R2 binding for one
conditional shared search lease under a separate system prefix, and KV for
short-lived evidence caching. Require the existing edit token and known caller
before spending upstream requests.

Done when recovery is deployed and the fourteen retries are queued or explained,
preview tests and build pass, and deployed source queries and record UI are
verified. Retried matches still require review where automatic corroboration
cannot establish a release.
