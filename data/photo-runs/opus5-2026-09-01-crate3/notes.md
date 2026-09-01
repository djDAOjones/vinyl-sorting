# Crate 3, 2026-09-01 — what the run actually measured

Six records (484–489), 34 photographs, read blind by Claude Opus 5 and
imported before any answer existed; `truthPreexisting` false on all six.
Scored against a sheet the maintainer typed at the crate in its own
schema. `score.md` is generated; this is the reading of it.

**7 exact, 1 refused, 14 wrong — fails.** Honest, and it measures almost
nothing. Where the fourteen come from:

| kind | n | example |
| --- | ---: | --- |
| `name_raw` asked for transcription, sheet gave a summary | 5 | 485: `Various` against the five orchestras printed |
| punctuation and orthography | 3 | `His Master's Voice` / `His Masters Voice`; `ß` as `ss` against `b` |
| `year_raw` is not a column the sheet has | 2 | 486, 487: disc says *Recording first published 1964* |
| genuine disagreement about what the label says | 4 | below |

Ten of fourteen are two documents answering different questions. Only
the last four test reading, and on three of them the reading was right:

- **487 — the case in miniature.** Cover wreath `M. 2316`, disc
  `AM-2316`, sheet took the sleeve. Only the disc says which record is
  in the hand, so the scorer counted the disc against the decoy.
- **488** — `Heliodor` typed as `Meliodor`; stylised H in the cherub
  logo, and `2578 008` is a Heliodor catalogue format.
- **489** — `name_raw` took `Weitere Schallplatten mit Karl Heinrich
  Waggerl`, the back-sleeve heading over the adverts.
- **486** — `MONO AN 133-4` against the reading's `AN 133-4`. The sheet
  is the better transcription here; the reading dropped a printed
  prefix.

## What did not happen

**The decoy check never ran.** No `decoy_numbers` column, so nothing
could spring the trap — and `score.md` still printed "decoy numbers
reported as catalogue numbers: 0 — must be 0", which reads as a pass on
the one condition the spike exists to test.

**Half the sample was sleeve-only** — 484, 485 and 488 carry no disc
label across any of their shots, repeating the crate-2 condition rather
than testing the fix for it. 484 has no typed row at all.

## Caveats on this run's standing

- The reading and the scoring were done by the same session. The
  independence stamp is real and mechanical, but a fresh reader is
  better evidence.
- The typed sheet is itself a reading of the same objects, and on this
  sample it was wrong at least as often as the machine. The scorer
  treats it as fact by construction.
- Six records is noise. Nothing here is a rate.

## Fixed as a result

- `parseChatReply` extracted the JSON array only when the reply did not
  *start* with `[`. Both replies here led with their array and were
  rejected as malformed.
- A blank skeleton row scored as five wrong answers instead of reading
  as untyped, costing 484 four correct readings.

## Redundant photographs

Seven of 34 repeated a corner already captured: `484-4`, `484-5`,
`485-6`, `486-2`, `488-6`, `489-4`, `489-5`. See [[PHOTO-CULL]].
