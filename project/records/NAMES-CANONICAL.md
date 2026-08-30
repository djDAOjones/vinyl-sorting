---
id: NAMES-CANONICAL
name: One canonical form per composer and performer, resolved after capture
summary: A label prints TSCHAIKOWSKY, Tchaikovsky, P.I. Tschaikowsky and Pyotr Ilyich Tchaikovsky for one man, and clustering cannot group performances of a work until those resolve to one composer — so the raw string stays untouched and a resolution layer sits between it and every decision view.
status: open
date: 2026-08-31
milestone: icebox
order: 6
---
# One canonical form per composer and performer

A classical label is not consistent about names, and neither are two
labels about the same man. `TSCHAIKOWSKY`, `Tchaikowsky`,
`P. I. Tchaikovsky` and `Pyotr Ilyich Tchaikovsky` are one composer;
`Beethoven, Ludwig van` and `Ludwig van Beethoven` differ only in sort
order; `The Philharmonia` and `Philharmonia Orchestra` are one
ensemble. Clustering groups performances **by work**, and a work is
identified partly by its composer, so unresolved names split a cluster
that should have been one and hide exactly the overlap this project
exists to find.

## Why this is NOT prompt guidance

The obvious place to fix it is the extraction prompt — tell the reader
how to format a composer. That would be wrong, and it is worth writing
down why, because the suggestion will recur.

The contract's governing rule is **report only what is printed**. A
reader that turns `TSCHAIKOWSKY` into `Tchaikovsky` has stopped
reading and started inferring, which is the one thing the prompt exists
to prevent — and the same clause is what stops it supplying a
catalogue number from memory. Weakening it for names weakens it for
everything.

It also destroys evidence. `capture` holds what a human read and
`name_raw` is raw on purpose; `Tchaikovsky` cannot be turned back into
`TSCHAIKOWSKY`, so a normalised reading loses the ability to say which
pressing it came from. And it would make the spike unmeasurable: the
ground truth is what the label says, so a reader normalising its answer
scores as wrong against a correct transcription.

**So the raw string is never touched.** Resolution happens between the
raw value and anything that decides, which is where `normaliseCatno`
and `compactText` already sit for catalogue numbers.

## What it has to do

- **Fold the obvious variants**: case, diacritics, initials against
  full forenames, and `Surname, Forename` against `Forename Surname`.
  The `composer` table already carries `name` and `sort_name`, so the
  schema anticipated this.
- **Handle the leading article** in ensemble names — `The Philharmonia`
  and `Philharmonia` — without mangling names where the article is
  load-bearing.
- **Refuse rather than merge on a guess.** Two names that merely look
  similar are not one person: `Kleiber, Carlos` and `Kleiber, Erich`
  are father and son and conducted the same repertoire. A wrong merge
  silently deletes a contrast the collection exists to compare, and is
  far more expensive than two clusters that should have been one.
- **Resolve against MusicBrainz where possible**, which is M3's job
  anyway and gives an external identity rather than a local guess.

Transliteration is where this gets hard and where the refuse-rather-
than-guess rule earns its keep: Russian, Czech and Polish names arrive
through German, French and English conventions on the same shelf.

Trigger: M3, which resolves composers for the 131 Various/Unknown rows
and needs a canonical form to resolve them to. Also needed the first
time a photo reading is promoted into the store, since that is a second
route by which name variants arrive.
