# Project Brief — Vinyl Sorting

<!-- What, for whom, out of scope. Identity document: import into the rules position where supported. -->

**Product name:** Vinyl sorter. Full development brief (v1, classical,
28 August 2026): <https://claude.ai/code/artifact/f1939d24-b221-4ed9-8948-8b193bd64e35>
— that artifact is the spec; this file is the identity summary.

## What we are building

A web app for cataloguing a classical vinyl collection, verifying each
record against Discogs and MusicBrainz, and organising the overlapping
copies into a finite queue of listening decisions — keep, contrast, or
let go.

Three jobs, in order, each useless on its own: **catalogue** (every
record into one structured store, captured once, with a photo of the
label so no disc is handled twice for data reasons), **verify**
(resolve each record to a real Discogs release and MusicBrainz work,
under a corroboration rule that refuses to accept a catalogue number
on its own), **organise** (group overlapping copies by work, strip the
compilations, rank each cluster, hand back a queue sized to a sitting).

## Who it is for

A private household tool for a handful of trusted people. Joe
captures and decides; at least one other person may capture. Not
public, ever.

## Scale

~750 records in scope for v1: 446 already catalogued and needing
re-verification, ~300 new. Of 305 enriched records, 110 are the only
copy of their work, 132 are compilations resolved on data, and 63 fall
into 15 clusters that reach a listening decision. 2,000–6,000 more
varied records are deferred to a later phase, so the schema stays
genre-neutral throughout.

## Why it exists

Nine schema generations and five restarts. The existing spreadsheets
cannot answer "how many copies of this symphony do I own, and which is
best?" because a flat row conflates a physical disc, a pressing, a
piece of music and a performance. 9% of existing Discogs matches are
provably wrong — 26 of 277 point at a different record, 16 of them
labelled "Exact" — because a catalogue number was treated as a verdict
rather than a lead.

## Platform

Cloudflare Pages static SPA (Vite + TypeScript, PWA, IndexedDB offline
queue) building from this GitHub repo on push; a Cloudflare Worker
(Hono) holding the Discogs token, proxying and rate-limiting Discogs
and MusicBrainz, and running matching, clustering and coverage as
queued jobs; D1 for the schema, KV for the API cache, R2 for label
photos. No sign-in for v1 by maintainer decision (2026-08-30) — see
the decision log; the Worker exposes named operations rather than an
open proxy, and auth is revisited before M2 puts the Discogs token
behind a public endpoint.

A Worker is not optional: the Discogs API sends no CORS headers, and a
static site cannot hold a secret. Live at
`vinyl-sorter.joe-2d2.workers.dev` since 2026-08-31.

## Constraints

- Offline capture is a hard requirement — crates live in lofts and
  garages. Entries queue in IndexedDB and survive a hard refresh.
- The expensive resource is handling the record, not API calls.
  Design so each disc is picked up exactly once.
- Existing data dictates behaviour: text corruption is MacRoman
  mis-decoding (not cp1252); label is captured on 0% of the backlog
  and mashed into free text with the catalogue number; AI-invented
  ratings sit indistinguishably beside sourced data.
- Port the proven normalisation ladder, query permutations, rate
  limiting and resumable output from the existing Windsurf Python CLI
  rather than rewriting.

## Out of scope for v1

- Non-classical crates — the schema must permit them, the interface
  will not show them.
- Selling, listing or pricing workflow beyond a static sell list with
  values attached.
- Audio playback, ripping, or any handling of the music itself.
- Public sharing.

## The risk that actually matters

Building the app instead of cataloguing the records. M1 exists to make
capture possible before anything else is built, and a phone camera
plus a shared album is a legitimate fallback from day one. If in three
months there are 300 photographed labels and a half-finished app, that
is a win.
