# Photo batch — 14 September 2026

## Completed

97 photos of 29 uploaded entries were read directly without catalogue lookups. They describe 30 records. All 30 are populated in production D1 with 154 raw fields sourced `vision`, with no human confirmation asserted. Human capture text and original item metadata remain unchanged. Original matching history was retained through population; the explicitly approved empty-attempt cleanup is recorded below.

Item 499 was split after photo 4: Jill Jones remains 499; David Essex is new item 519, retaining the rock-and-pop-to-sell list. All 97 photo objects are retained. Original filenames stay stable locally; `row-ids.csv` maps the two David Essex photos to 519.

The image readings were checked against sleeves and disc labels, then validated with the existing importer (30/30 IDs), a rehearsal using the production schema, and exact production readback. This is operational extraction, not a measured accuracy benchmark or a confirmed release match.

## Matching handoff

On 14 September at approximately 12:06 BST, after the user's explicit approval, exactly 29 original empty zero-query attempts (IDs 522–550) were removed using the prepared guarded SQL. Every predicate still matched: no candidates, human decisions or chosen release. Readback confirmed all 97 photos, 154 vision fields and human capture rows remained intact. Before and response snapshots remain local.

The online queue contains the 29 entries 490–518, with no older unmatched items ahead. Item 519 has already completed a search and needs review: the top candidates tied (margin zero), and four queries errored. No review decision has been made.

The current scheduler is one record per five-minute tick (the subrequest/retry allowance is the limiting factor). Live manual and automatic Discogs spacing both read 3000 ms; the cooldown key is absent. From the next expected 12:10 BST tick, the final entry should start around 14:30 and finish by approximately 14:35 BST if ticks run normally. Throttling/cooldowns can extend that. This estimates completion of the first automated matching pass, not human confirmation of every pressing.

## Readings

| Item | Artist | Title | Catalogue | Printed date |
|---|---|---|---|---|
| 490 | Rainbow; Blackmore's Rainbow | Rising | 2490-137 A | ℗ 1976 |
| 491 | Thompson Twins | You Take Me Up | TWINS 124 | ℗ 1984; © 1984 |
| 492 | Thompson Twins | Into the Gap | 205 971 | — |
| 493 | Thompson Twins | Hold Me Now | TWINS 122 | ℗ 1983; © 1983 |
| 494 | Spandau Ballet | Communication (Club Mix) | CHS 12 2668 | ℗ 1983; © 1983 |
| 495 | Spandau Ballet | Instinction | CHS 12 2602 | ℗ 1982; © 1982 |
| 496 | Russ Ballard | Russ Ballard | S EPC 80341 | ℗ 1974 |
| 497 | Jack Jones | Best of Jack Jones | MCF 2704 | — |
| 498 | Bo Hansson | Lord of the Rings | 6369 924 | ℗ 1972 |
| 499 | Jill Jones | Jill Jones | WX 110 | — |
| 500 | Dire Straits | Love Over Gold | 6359 109 | ℗ 1982 |
| 501 | Billy Joel | Storm Front | 465658 1 | ℗ 1989 |
| 502 | The Moody Blues | This Is the Moody Blues | MB 1/2 | ℗ 1974 |
| 503 | 10 C.C. | How Dare You | 9102 501 | ℗ 1975 |
| 504 | U2 | The Joshua Tree | U26 | ℗ 1987 |
| 505 | Bryan Ferry | He'll Have to Go | EGOX 48 | ℗ 1988 (track 1); ℗ 1985 (track 2); © 1989 |
| 506 | Status Quo | Rock 'til You Drop | 510341-1 | ℗ 1991; © 1991 |
| 507 | Bay City Rollers | Rollin' | BELLS 244 | ℗ 1974 |
| 508 | 10 cc | The Original Soundtrack | 9102 500 | ℗ 1975 |
| 509 | Spear of Destiny | World Service | EPC 26514 | ℗ 1985 |
| 510 | Derek and the Dominoes; Eric Clapton | Layla (Full Version); Wonderful Tonight (Live) | RSOX 87-A | ℗ 1970 (side one); ℗ 1980 (side two) |
| 511 | Alan Price | Between Today and Yesterday | K 56032 | ℗ 1974; © 1974 |
| 512 | Salvation | Salvation | UAS 29062 | ℗ 1968 |
| 513 | Stevie Wonder | Hotter Than July | 1A 062-64121 | ℗ 1980 |
| 514 | Eagles | The Long Run | K 52181 | ℗ 1979 |
| 515 | ELO | Time | JETLP 236 | ℗ 1981 |
| 516 | Carly Simon | Hotcakes | K 52005 | ℗ 1974 |
| 517 | The Moody Blues | Seventh Sojourn | THS.7 | ℗ 1972 |
| 518 | The Police | Outlandos d'Amour | AMLH 68502 | ℗ 1978 |
| 519 | David Essex | All the Fun of the Fair | S 69160 | ℗ 1975 |

## Evidence and caveats

Dates are transcribed as printed, including track-specific dates; they are not assumed release years. Jill Jones (499) and Into the Gap (492) have unreadable dates; Jack Jones (497) has track dates rather than one clear album year.

Only plausible alternate catalogue identifiers enter `other_numbers`. Clearly identified cassette/CD numbers, matrix codes, barcode and price/label codes remain in the notes where relevant, rather than feeding a vinyl search.

| Item | Reading note |
|---|---|
| 490 | Disc photo 2 is turned 90 degrees clockwise and needs 270 clockwise to read upright. Catalogue carries side suffix A; title Rainbow Rising on disc, Rising on sleeve. |
| 491 | Catalogue on sleeve and disc photo 3. Label additionally prints Machines Take Me Over and Down Tools. |
| 492 | Catalogue and title clear on sleeve; disc photo 3 blurred, so year left blank. Sleeve 405 971 is cassette format, excluded; 620/650 and AE 260/AE 480 are distribution/price codes. |
| 493 | Title from sleeve photo 1. Side B photo 3 reads Let Loving Start; same band and TWINS 122, not evidence of a second record. |
| 494 | Sleeve title photo 1; catalogue on disc photo 3. Photographed side B is Communication (3:36); club mix title belongs to sleeve/main side. |
| 495 | Title from sleeve photo 1; matching catalogue on sleeve and disc. Side B photographed: Chant No. 1 (Remix); Gently. |
| 496 | Disc label photo 3; sleeve prints EPC 80341. |
| 497 | Disc catalogue photo 3. Sleeve photo 2 supplies alternate identifiers. Label lists individual track years; no single album year assigned. |
| 498 | Disc label photo 3; sleeve agrees. 5016 is an unexplained sleeve code, not promoted for matching. AA 6369 924.1 Y is side/matrix text. |
| 499 | Photos 1–4 ONLY. Sleeve and disc have WX 110 and 925 575-1. 925 575-4 carries cassette icon; exclude. Photos 5–6 belong to David Essex and are assigned to new item 519. Year obscured by glare, left blank. |
| 500 | Disc label photo 3; sleeve agrees. 7150 109 carries cassette icon and is excluded from matcher identifiers. |
| 501 | Disc label photo 3; sleeve agrees. Barcode 5099746565817; LC 0149 not a catalogue number. |
| 502 | One double album. Sleeve set number MB 1/2; photographed disc MB 1 explicitly says DOUBLE ALBUM. XZAL 13343P is a matrix, not catalogue. Photos 3–5 show same label; second disc not shown. |
| 503 | Disc label photo 3; sleeve agrees. Date transcribed as printed, not inferred release date. |
| 504 | Catalogue U26 and ℗ 1987 confirmed from full-size disc photo 3; barcode 5014474100062. |
| 505 | Sleeve and disc photo 3 agree. Full-size label supplies track-specific dates and copyright; these are not asserted release dates. Windswept also printed as track 2; barcode 5012985004862. |
| 506 | Same disc label repeated in photos 3–4. Sleeve photo 2 also advertises MC 510 341-4 and CD 510 341-2; exclude these other formats from matcher identifiers. Barcode 731451034114, PG 281 and LC 1633 retained here only. |
| 507 | Disc label photo 3; sleeve gives alternate 2308 101. |
| 508 | Disc label photo 3; sleeve agrees. |
| 509 | Catalogue from sleeve photo 3 and disc photo 4; date confirmed at full size. CB 281 and LC 0199 are not catalogue numbers. |
| 510 | One record, two sides: photos 1/4 show side one RSOX 87-A, photos 2/3 show side two RSOX 87-B. Both explicitly numbered sides of this single; do not split. Referenced source albums RSDX 3 and RSD 1 are not this record's catalogue number. |
| 511 | Disc label photo 4; sleeve copyright photo 3. |
| 512 | Disc label photo 3; sleeve prints UAS. 29062. |
| 513 | Disc label photo 3; sleeve agrees. |
| 514 | Disc label photo 3; alternate number 5E-508 also on sleeve photo 2. |
| 515 | Disc label photos 3–4; repeated shots of same side. FZ 37371 is the parenthesised alternate printed code; LC 3455 excluded as label code. |
| 516 | Disc label photo 1; sleeve agrees. |
| 517 | Disc label photo 3; sleeve prints THS 7. |
| 518 | Catalogue and year from disc label photo 4; title and artist also on sleeve. |
| 519 | Photos 499-5.jpg and 499-6.jpg ONLY. Disc label confirms artist, title, catalogue and date; populated as separate item 519. |

One non-destructive display rotation is recorded for `490-2.jpg` (270 degrees clockwise). Original images are preserved.

Private originals, R2-key manifest, checksums, before/after database snapshots and SQL are held locally in this folder and excluded from Git. `validation.json` records the mechanical checks.

Repository checks: `npm run gate` passed (typecheck and 300 tests); memory validation has zero structural failures and five budget warnings; generated backlog matches records.
