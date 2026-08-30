---
id: M3-WORKS-PERFORMANCES
name: MusicBrainz works, performances and per-track completeness
summary: Resolve work and recording identity from MusicBrainz, resolve composers for the 131 Various/Unknown rows, and attach real per-track completeness so clustering stops relying on the track-count heuristic.
status: todo
milestone: icebox
order: 5
---
# Works, performances, completeness

Discogs identifies the object; MusicBrainz identifies the music.
Trying to make Discogs do both is why the classical side stalled
before. Separate bucket, 1/sec, proper user-agent.

Completeness is the load-bearing output: a `release_track` joins a
work's cluster only if `completeness = 'complete'`. Until this
milestone lands, that comes from the track-count heuristic (<= 8 →
headline record, > 8 → compilation), which will misfile a two-LP opera
and a single-movement filler — see R3. The clusters screen must show
which classification came from the heuristic so a wrong cluster is
explicable rather than mysterious.

**Done when** a compilation's tracks resolve to individual works and a
headline LP resolves to a complete performance. ~3 days.
