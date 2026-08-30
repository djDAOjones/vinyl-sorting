# Label photographs for SPIKE-PHOTO-TO-FIELDS

Drop ~20 photographed centre labels in here, type what they say into
`ground-truth.csv`, and the spike runs in three commands.

Twenty is not arbitrary. Below about fifteen a single awkward label
moves the headline enough to mean nothing; above about thirty you are
paying attention to a question two dozen photos already answered.

## Photograph them the way capture will

The point is to measure the photos the app will actually get, not the
best photos a person can take. So: phone in hand, label filling most of
the frame, whatever light the crate is in. Do not clean the disc, do
not straighten it, do not retake a slightly skewed one.

Include the awkward ones deliberately — a worn Decca with the ink gone,
a boxed-set label where four works share the space, a label whose
catalogue number is printed smaller than the matrix number. Those are
the rows the spike exists to find.

## Row ids

Each photo needs an id, and it becomes the image's filename inside the
pack. By default it is the filename without its extension, so
`DG-0001.jpg` is row `DG-0001`. To tie photos to records already in the
store, put a `row-ids.csv` here with columns `file,row_id`. Two photos
resolving to the same id is refused rather than merged.

## Type the truth

One row per photo in `ground-truth.csv`, keyed by row id:

| column | what goes in it |
| --- | --- |
| `row_id` | the id, matching the photo |
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
node tools/photo-pack.mjs
```

Packs of 10. Each pack is written **twice** — as a directory
`data/photo-packs/pack-NN/` and as `pack-NN.zip` beside it — because
there are two ways to get the reading done and they want different
things. Both hold the images named after their row ids, a `PROMPT.txt`,
a `READ-THIS-FIRST.md` and a manifest.

### The cheap path — no upload

Point a session on this machine at the pack directory:

> Read `data/photo-packs/pack-01/READ-THIS-FIRST.md` and do what it says.

That file carries the whole task and says where to write the answer, so
there is nothing to paste alongside it. No upload, no dragging, and no
per-message image cap — the batch size only ever costs a browser
upload.

**It must be a session that has never seen `ground-truth.csv`.** That
file is two directories away on the same disk, and it is the answer
sheet. A reading produced with it in context measures nothing — the
same fault as verifying Discogs with Discogs, which this project has
already made twice and caught twice. `READ-THIS-FIRST.md` says so in
its own words, and a test asserts those words survive editing, but
nothing mechanical can prove a context never opened a file. Starting a
fresh session is the guard.

### The browser path

Unzip a pack, drag its images into the chat, paste `PROMPT.txt` above
them, and save the reply to a text file. Prose and code fences around
the JSON are fine — the importer digs it out.

Do not upload the zip itself expecting it to be unpacked: claude.ai
does not pass a zip's contents to the vision path, and whether
ChatGPT's code interpreter hands extracted images to vision is
documented nowhere. The zip is transport, not a shortcut.

```bash
node tools/photo-import.mjs data/photo-packs/reply-01.txt
```

```bash
node tools/photo-score.mjs
```

Replies live in `data/photo-packs/` alongside the packs, and re-running
`photo-pack.mjs` rebuilds the packs while leaving them alone — the cost
of a reading was never the upload, it was doing the reading.

Import is additive and repeatable: a reply covering rows you already
imported overwrites just those, and anything still missing is named so
you can re-upload only what is outstanding. An id that was never sent
is refused and the import exits non-zero — a reply that lost alignment
must not be scored as though it were data.

The browser path sends those photographs to whichever chat provider you
use, which is the one place this project's data leaves the household.
The pack directory path sends them nowhere.
The photos here are gitignored; `ground-truth.csv` is committed, because
it is the evidence and it is what makes a re-run a comparison rather
than a fresh guess.
