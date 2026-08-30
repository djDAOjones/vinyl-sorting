# Label photographs for SPIKE-PHOTO-TO-FIELDS

Drop ~20 photographed centre labels in here, type what they say into
`ground-truth.csv`, and the spike runs in two commands.

Twenty is not arbitrary. Below about fifteen a single awkward label
moves the headline enough to mean nothing; above about thirty you are
paying attention to a question two dozen photos already answered.

## Photograph them the way capture will

The point is to measure the photos the app will actually get, not the
best photos a person can take. So: phone in hand, label filling most of
the frame, whatever light the crate is in. Do not clean the disc, do
not straighten it, do not retake a slightly skewed one. A garage, a
loft and a lamp-lit front room between them are worth more than twenty
clean shots.

Include the awkward ones deliberately — a worn Decca with the ink gone,
a boxed-set label where four works share the space, a label whose
catalogue number is printed smaller than the matrix number. Those are
the rows the spike exists to find.

## Type the truth

One row per photo in `ground-truth.csv`:

| column | what goes in it |
| --- | --- |
| `file` | the filename exactly, e.g. `IMG_0231.jpeg` |
| `catno_raw` | the catalogue number, as printed |
| `label_raw` | the label or company, as printed |
| `name_raw` | composer and performers, as printed, `;` between them |
| `title_raw` | the work or works, as printed |
| `year_raw` | a year, as printed, with its (P) or (C) marker |
| `decoy_numbers` | `;`-separated — **every other number on the label** |

Leave a cell empty when the label genuinely does not carry it. Empty
means absent, and the scorer treats "correctly left blank" as a right
answer rather than a miss.

`decoy_numbers` is the column that does the work. Matrix and stamper
codes, side numbers, opus and K. numbers, timings, plate numbers, the
(P) year printed as a bare number — all of them. If the model reports
one of these as the catalogue number, that is not a near miss, it is
the M0 failure recreated: 26 of 277 rows pointing at a different
record, 16 of them labelled "Exact", because a number was treated as a
verdict rather than a lead. The scorer counts it separately and fails
the run on a single occurrence.

## Run it

```bash
ANTHROPIC_API_KEY=... node tools/photo-extract.mjs
```

```bash
node tools/photo-score.mjs
```

The extractor is resumable — a photo already read is skipped, so a run
that dies costs the photo it was on. Changing `--model` or `--effort`
starts a fresh run rather than mixing two into one score.

Sweep the tradeoff the record leaves open:

```bash
node tools/photo-extract.mjs --model claude-haiku-4-5 --out data/photo-extract-haiku.json
```

The photos themselves are gitignored; `ground-truth.csv` is committed,
because it is the evidence and it is what makes a re-run a comparison
rather than a fresh guess.
