# Decision log

<!-- Append-only, newest first. -->

## 2026-09-01 — MATCH-OTHER-NUMBERS: try the rest of the label

**Decision:** `other_numbers` — extracted into
`data/photo-extract.json` since the spike and consumed by absolutely
nothing — is promoted into `raw_value`, read by `pendingRows`, and
builds a SECOND query ladder that is spent only when the first one
places nothing.

The maintainer's two worked examples: item **480** carries `SUA 10639
Mono` behind the stereo number the reading chose as primary; item
**469** carries `642 273 GL` behind `GL5840`. The right answer was
sitting in the same JSON as the wrong one.

**It is not in `PHOTO_FIELDS`, deliberately.** That list is the SCORED
set — what `photo-score.mjs` grades a reading against — and a reading
cannot be right or wrong about which numbers a label happens to print.
It is evidence, not an answer, so it is promoted alongside rather than
added to the graded set.

**The trigger counts FAMILIES, not points, and the first draft got this
wrong.** A candidate collects 5 points merely for being a vinyl LP, so
gating on `score > 0` let a field of a dozen unrelated records read as
"scored something" while having placed nothing at all — a test caught
it on exactly that row. Families are what the corroboration gate
spends; a field where not one candidate carries a single family is a
field the primary number failed to place, which is the population that
ends as "not found" today. That is what makes the extra rungs free:
they fall on rows already lost and on no others, and a test asserts a
row the primary number DID place never pays for them.

**One family, not two.** The alternatives join the scoring variants
unconditionally — a candidate the first ladder already found may match
on an alternative number, and refusing to notice would throw away a hit
already paid for. But they are VARIANTS rather than a new family: two
numbers printed on one label are one label, and counting them
separately would let a row satisfy the corroboration gate against
itself, which is the precise fault the gate exists to prevent.

**And it decides mop-up cases by itself.** For a sleeve-only row with
two candidate numbers: one matching and the other not is a finished
row, the tie broken by elimination; neither matching has earned its
place in the re-shoot crate. Those two outcomes are currently
indistinguishable — both are "needs review" — and telling them apart is
worth more than either.

A match found this way says so in its verdict, because it is a fact
about the READING as much as about the match: the reading picked the
wrong number as primary.

**Verify:** npm run gate 271+4 passing; four new tests covering the
held-back ladder, the split on newlines and pipes, the row that must
not pay, and the row that must.

## 2026-09-01 — CAPTURE-GUIDANCE: say what to shoot, and let the number survive

**Decision:** three things, and they are one failure seen from three
sides.

**A ranked sheet, once per device, recallable from the header.** Fill
the frame with the disc label; then the sleeve back for the tracklist;
then the runout angled to the light; then anything that disagrees.
Order is the whole message — a crate is walked at speed and nobody
reads four paragraphs in a loft. The seventeen sleeve-only rows of
items 467-483 are the argument, and the ruling that produced them was
written into the README, which is exactly where the person holding the
camera is not looking.

**The stored long edge goes 1568 → 2048.** Item 481's catalogue number
is printed on the Ace of Clubs badge, in the right place, and is not in
the file: the downscale took it. `PHOTO_LONG_EDGE`'s own comment
claimed "nothing downstream loses anything", and that is now known to
be false.

**Framing is the dominant fix, not pixels, and that is why the number
moved one step rather than four.** A whole 12″ disc at 1568 px puts the
4″ label across ~520 px — about sixteen pixels per character of a
catalogue number, which JPEG then finishes off. The same label filling
the frame gives ~fifty and is never in doubt. So the sheet buys more
than any resolution can, and costs nothing. 2048 px is ~1.3 MB against
800 KB, ~70% more in a queue that must survive a loft with no signal,
bought to restore the margin for a shot framed in a hurry. **Keeping a
full-resolution original was refused**: roughly five times the storage
to buy less than the guidance gives away free.

**The camera ask rose with it, 3840 → 4096.** A test asserts the ask is
at least twice what is stored, and at 2048 a 3840 ask stopped being
that. The invariant is the right one — "far more than is stored" is
what keeps small print legible — so the number that moved was the ask,
not the assertion. `ideal` costs nothing to raise: a phone whose best
mode is 3840 still hands back 3840. The test now also pins
`PHOTO_LONG_EDGE` itself, which it did not before, so this is a
strictly stronger suite rather than an adjusted one.

**And a tap opens any photograph full size.** Nobody could have caught
481 until the disc was back in the crate and the pack reached a desk. A
thumbnail 88 px wide cannot answer "is that number legible?"; the full
frame can, and now does, at the one moment when re-shooting is free.

None of this helps the 483 rows already photographed. Those are the
mop-up crate, and CATALOGUE-CONTROLS is where they get listed.

**Verify:** npm run gate 271 passing; the sheet rendered on first
launch, dismissed to `vs.guide=seen`, and reopened from the header;
capture stayed dark under a light system preference, so `data-force-dark`
holds.

## 2026-09-01 — REVIEW-CARD: the sleeve, and five states instead of two

**Decision:** `SearchResult` now declares `thumb` and `cover_image`,
which Discogs has been sending on every search all along and this
project parsed away. The small one is stored in the candidate's
`signals_json` and rendered beside the photographs of the actual disc.
**No new request buys it** — it is in the response the ladder already
pays for.

**Hotlinking was checked rather than assumed.** One search against the
live API returned `i.discogs.com` URLs; loaded in the browser with
`referrerpolicy="no-referrer"` the image decoded at its natural
150 px. The `onerror` fallback stays anyway, and so does the drawn
placeholder, because the 296 runs already in the queue were scored
before this existed and will carry no image until they are re-run.

**The second half is the comparison, and the state count is the whole
argument.** Every candidate showed its families as identical grey
chips, so `catno` and `year` read the same. It now says field by
field how the reading stands against the candidate, in FIVE states:

- `agrees`, `partly`, `differs` — the ordinary three;
- `unread` — never read off the disc. 267 queued rows have no label,
  and rendering that as a disagreement blames the candidate for the
  reading's silence;
- `unknown` — read, and Discogs returned nothing to compare it with. A
  gap on the other side is not a mismatch either.

A reviewer who cannot tell those two absences from a real conflict
learns to ignore the red mark entirely, which costs more than the
chips are worth.

**The verdict comes from the scorer's own `families`, never re-derived
here.** Re-deriving would let the screen and the gate disagree about
the same candidate. The candidate's value appears only in the tooltip,
which is what makes a disagreement arguable — a red `label` beside a
release plainly labelled the same thing is then visibly a scorer bug
rather than a mystery. The demo seed was made self-consistent for
exactly this reason, and says so.

**Verify:** npm run gate 271 passing; the queue rendered in both themes
at 1280 px; `naturalWidth: 150` on the hotlinked thumbnail and the
drawn placeholder on the candidate without one.

## 2026-09-01 — APP-KEYS: one scheme, and a card that cannot go stale

**Decision:** `g` then a letter goes — `h` home, `a` add, `r` resolve,
`c` collection, `s` settings. `/` focuses search, `?` opens the card,
`Escape` closes what is open or leaves the field. The review queue's
`1`–`5`, `N`, `S`, `B`, `M` are unchanged.

**`g` is a prefix rather than a modifier** because every single-letter
global steals that letter from a screen that might want it — and the
review queue, the screen with the most keys, wants nearly all of them.
It times out after 1.4 s so a stray `g` cannot silently swallow a
keystroke a minute later.

**The card is generated from the same table that binds the keys**, so a
shortcut cannot exist without being documented. That is not tidiness:
the review queue's five were real, good, and a secret for a month
because nothing on any screen said they existed.

**The typing guard is shared rather than remembered.** A key pressed
inside a text field is text — the review queue had to learn this when
typing a Discogs id fired four shortcuts, and it is exactly the kind of
rule each new screen would otherwise re-learn by breaking. It lives in
`chrome.ts` and every screen defers to it.

**Verify:** npm run gate 271 passing; `?` opened the card from a real
keydown; `g c` navigated from settings to the collection; capture takes
the go-keys and nothing else, because there is no keyboard in a loft.

## 2026-09-01 — APP-HOME-HUB: a front door, and capture keeps its own

**Decision:** `/` is a hub of four tiles — Add vinyl, Resolve entries,
The collection, Settings — each carrying the number of things waiting
behind it. Capture moved to `/capture.html`. Every screen wears the
same header with the same way home in the same place.

**The manifest's `start_url` moved to `/capture.html` with it, and that
is the load-bearing part.** The brief's stated risk is building the app
instead of cataloguing the records, and capture is tuned around it:
nothing between the shutter and Queue it. A menu in front of the camera
is exactly the tax that principle refuses. So the two audiences get
different front doors — a phone with the app installed still opens
straight into the camera, and the hub is for the desk and for anyone
arriving at the bare URL. Neither pays for the other.

**The service worker's offline fallback had to change or the move would
have broken the one promise that matters.** It answered every
uncached navigation with `/index.html`, which was correct while the
root WAS capture. Unchanged, it would have met "open the camera, I have
no signal" with a menu. It now falls back on the requested path, and
the shell caches all five pages.

**Verify:** npm run gate 271 passing; all five screens rendered at
1100 px and at 375 px in both themes; `g c` navigated from settings to
the collection; the shortcut card opens on `?`.

## 2026-09-01 — DESIGN-SYSTEM: one language, and dark is the base

**Decision:** `tokens.css` holds every colour, size and duration;
`app.css` holds every component more than one screen uses; `chrome.ts`
holds the header, the theme, the toast and the keyboard. The three
dialects in `style.css`, `browse.css` and `review.css` are gone, and
what is left in each is only what that screen alone has — the
viewfinder, the detail panel, the candidate row.

**Dark is the base and light is an override**, rather than the other
way round. If the theme script never runs — JavaScript blocked, an
error before paint — the app falls back to the palette the hardest
environment needs rather than to a white page held over a crate.
Capture opts out of light entirely with `data-force-dark`: dim light
and gloves are constraints it was measured against, not a preference.

**Light is a class on `<html>`, set by an inline script before paint.**
`light-dark()` would have been cleaner and needs Safari 17.5, which is
not a promise this app can make about whatever phone is to hand; a
duplicated `prefers-color-scheme` block would have meant writing the
palette twice and letting the copies drift. Three lines of duplicated
script is the smaller cost, and `tokens.css` says so where they live.

**The accent is brass, and it marks only what is interactive.** That
is why `needs-review` stopped being amber and became blue: 296 rows
sit in that state and every one of them is the app working correctly —
the corroboration gate refusing to guess. Colouring the most common
state in the database as a warning said something false about it. An
accent that also means "careful" stops meaning either.

**Verify:** npm run gate 271 passing; five screens at 1100 px and
375 px, both themes; the narrow-screen header drops the word "Home"
and keeps the mark, because at 375 px it was clipping the queue status
— the one thing on that bar that changes.

## 2026-08-31 — CAPTURE-BULK-REMNANT: they stay, and the file says so

**Decision:** `bulkFields` and `BULK_CARRIED` stay in
`src/queue-logic.ts` with their two tests. Both now carry a comment
saying, in the first line, that nothing calls them and why — so the next
reader does not spend five minutes working out whether something is
broken. Deleting them remains the maintainer's to take.

**Rationale:** The record offered two honest endings and one of them is
not this session's to choose. Deleting the exports deletes their
assertions in `queue-logic.test.mjs`, and "no weakening or deleting
tests" is a stop-and-ask boundary in AGENTS.md — which an autonomous
session may not cross on its own judgement, however safe the deletion
looks. Nothing is left untested by removing a test with the code it
covers, and that argument is exactly the kind a person should make
rather than an agent.

**So the other ending was taken, and it is a real one.** The cost of the
remnant was never the bytes; it was the next reader finding tested,
exported logic with no caller and having to reconstruct whether that was
a bug. A comment that opens "NOTHING CALLS THESE TWO. Read this before
you go looking." costs nothing and removes the whole cost.

**What the comment says, so the decision is not lost with it.** The mode
is retired on a reason that will not reverse — more than one photograph
of a disc is always wanted, so one row per photograph manufactured three
discs where one stood. The logic is not half-wired and not waiting on
anything. And the test comment says the two bulk tests go WITH the
exports and not before them, so a future tidy-up cannot delete the
coverage and leave the code.

Note for whoever takes it: `scaleTo`, in the same test section, is very
much live — the downscale runs on every photograph — so the section
header is misleading about its own contents. Only the two bulk tests
cover retired code.

**Verify:** npm run gate — comments only, 258 tests with the same 222
passing.

## 2026-08-31 — DATASET-EDIT: a person may correct their own reading

**Decision:** Built as signed off. Two routes, `POST
/api/items/:id/field` and `.../promote`, behind a shared `EDIT_TOKEN`
header; four operations on the browse detail — correct a capture field,
correct a physical item field, confirm a value unchanged, promote a
photo reading. AGENTS.md and `001-init.sql` are reworded in the same
commit: **machine writes over `capture` stay barred**, human correction
is permitted.

**The amendment is the load-bearing part, and it is narrow.** The bar
exists so duplicate detection runs on what a person read rather than on
what a bad match wrote — a bar on machine writes, which is what it
always meant. Nothing in `match/` or `review.ts` may reach `edit.ts`,
and `review.ts` still says `capture` is never touched. The accepted
cost, taken with the sign-off: the previous reading is gone, surviving
in `data/deep-groove-v1.csv` for the 446 imported rows and nowhere for
app captures.

**What a write actually lands.** The value, and a `field_source` row
with source `shelf`, `confirmed_by` and `confirmed_at` set — upserted
on `UNIQUE (entity, entity_id, field)`, in the shape `resolveRun`
already uses, so confirming twice re-stamps rather than duplicating.
`insertCapture` deliberately writes `shelf` UNCONFIRMED, because typing
at a crate is not verifying a pressing; saying at a screen that a value
is right is the different act `confirmed_by` was added for.

**It makes nothing decision-eligible**, and a test asserts it.
`v_decision_eligible_item` needs a confirmed `release_id` on the ITEM,
which only the review queue writes — so `release_id` is the one field
the panel shows and will not edit. Correcting capture text improves what
the matcher searches with; it is not a verdict about a pressing.

**Promotion writes a new row rather than laundering the old one.** The
`raw_value` row keeps its `vision` provenance untouched, so what the
model read stays on record and stays outside `v_confirmed_field`.
Re-labelling the reading as confirmed would erase the difference between
a machine's answer and a person's, which is the difference this project
exists to keep.

**Three things the build found.** An unset `EDIT_TOKEN` answers 503, not
200: an absent secret must never read as an unlocked door. The guard is
attached per route rather than as a mounted sub-app — a wildcard
middleware answered before the 404 fallthrough, so every unnamed path
started replying 401 and advertising that a passphrase exists. And a
401 clears the stored passphrase instead of retrying with it, or a
secret rotated on the Worker fails every edit for the rest of the
session in the same silent way.

**Field names come from allow-lists, never from the request** — they
reach a column position in the SQL, where values are bound. `release_id`
and `decision` are absent on purpose; a grade outside the Goldmine set
is refused before the CHECK constraint sees it.

**Verify:** typecheck clean; 258 tests, 222 pass, the same 10
pre-existing environmental failures as the parent. Eleven new Worker
tests, including the four the record named. Driven against the real
Worker over node:sqlite: a locked screen refuses, a wrong passphrase is
cleared with the reason, correcting a crate updates the row in the table
above it, Escape puts a value back untouched, an emptied field is
removed and provenance recorded, unchanged text is filed as a
confirmation rather than a correction, and promoting a `vision` reading
fills the label while leaving the reading unconfirmed.

## 2026-08-31 — DATASET-VIEWER: a third screen, minus the photographs

**Decision:** `/browse` ships — a filterable list of the whole
collection, an item detail, the match history behind every row, and a
provenance mark on every field. The photographs are LISTED, not shown.
The route that would render them is split out as BROWSE-PHOTOS, flagged
`sign-off`, because two live records disagree about whether it may
exist and that is not this session's call.

**Rationale:** 465 rows were in D1 and the only way to see one was
`GET /api/items` in a browser tab. The larger cost was that nothing
showed *why* a row looked the way it did — 287 sit in needs-review and
nobody could see whether the capture text behind one was a clean reading
or the label mashed into the catalogue number.

**Provenance is the screen, not a column on it.** Every field carries
its `field_source` in words — read at the shelf, from Discogs, read off
a photograph (`vision`), legacy import, guess — and separately whether a
person confirmed it. A field with NO provenance row says so out loud
rather than rendering blank: "nothing recorded" and "read at the shelf"
are exactly the two things a spreadsheet cannot tell apart. Unconfirmed
values are shown, which the rule permits, and shown as unconfirmed.

**The latent bug the record predicted was real.** `/api/items` LEFT
JOINed `capture` unaggregated, so an item with two capture rows returned
twice — a screen that miscounts its own collection. It now takes the
newest capture explicitly rather than relying on one-per-item holding,
with a test that inserts a second and asserts one row back.

**Why the photographs are only listed.** Rendering one needs
`GET /api/photos/:key`. `photos-pull.test.mjs` asserts no such route
exists, in those words: "with no sign-in that is the household's
photographs behind a URL". That test belongs to PHOTOS-TO-DESKTOP, and
the pull tool exists *because* the Worker has a PUT and no GET. The
route was built, tested and then withdrawn rather than shipped, because
shipping it meant editing another record's security test — a
stop-and-ask boundary twice over.

The detail that settles it, written down where the decision gets taken:
`/api/items/:id` is already open and already returns every `r2_key`, so
a photo GET is not one unguessable URL per photograph but an enumerable
archive. Any answer resting on key randomness has the surface wrong.

What ships instead is what can be said honestly — how many photographs
exist, when each was taken, and its key, which is what `photos-pull`
fetches by. That the screen is worth having without the images is itself
evidence for one of BROWSE-PHOTOS' options.

**The screens link to each other**, `.html` and all, because Vite's dev
server does not serve the extensionless path Pages also accepts. Capture
is left out of the nav on purpose: every element between the shutter and
Queue it is a reason to stop cataloguing.

**Verify:** typecheck clean; 247 tests, 211 pass, the same 10
pre-existing environmental failures as the parent commit. Four new
Worker tests: one item per row with two captures, the list columns the
filters need, the newest run winning the state column, and a detail
payload carrying candidates, a decision and a `vision` reading that is
still absent from `v_confirmed_field`. Driven at 1200x900 and 375x812
against the real Worker over node:sqlite: filters by state, by
photograph and by free text, the search box keeps focus while typing,
the detail opens with provenance on every field, and the page no longer
scrolls sideways on a phone — the table scrolls inside its own box.

## 2026-08-31 — CAPTURE-WHO: a name typed once, checked against a roster

**Decision:** A first-run screen asks for a first name and refuses one
that is not on a six-name roster — Joe, Jen, Ro, Ivy, Jojo, Sue. The
accepted name is stored canonically in `dg.who` and stamped on every
capture made on that phone. The review queue's own "who is reviewing"
screen now uses the same roster. `who.ts` holds all of it.

**Rationale:** `capturedBy` lost its box when CAPTURE-ONE-SCREEN parked
the More block, so a phone that had never had a name typed into it sent
nothing — absent rather than guessed, which is right, but it left a row
saying who read its label only by accident. The maintainer's design does
two jobs with one screen: a crude password, and the logger.

**Typed, not picked.** Six buttons print the six valid answers, so a
picker cannot gate anything, and it costs a tap on every device for
ever. Typing costs one screen, once, and asks you to know something not
on the page. The refusal does not list the roster.

**Spelling is the roster's problem, not the typist's.** `jojo`, `JOJO`,
`JoJo` and `  jOJo  ` all land as `Jojo`, so the free-text spelling
problem NAMES-CANONICAL exists to clean up on the composer side never
reaches `captured_by` at all. Near misses are refused rather than
guessed at: `Jon`, `Jenn` and `Joseph` are all no. A fuzzy match would
put one person's name on another person's row — the same class of fault
as an invented rating, and just as invisible a month later.

**The stored value is re-checked on every read.** The review queue used
to take whatever was typed, so `dg.who` may already hold free text on a
real device; a value that is not on the roster is treated as no value
and asked for once more. Verified: a stored `"jo "` puts the review
screen back on its gate rather than signing decisions with it.

**It does not gate the queue.** `startSync` runs whatever the screen
shows, so a phone back from a loft with twenty captures uploads them
while somebody works out how to spell Jojo — which is why the status
line is on the gate. The offline guarantee does not get a caveat.

**Say what it is not, again.** Six household first names are guessable
and the roster ships in the bundle. This says who is holding the phone;
it does not say who may write at all. OPEN-V1-AUTH answered that second
question "no sign-in for v1" the same day, and shipping this neither
re-opens nor answers it.

**Hand-over is explicit and lossless where it matters.** The name shows
in the header and tapping it confirms before clearing. Captures already
queued keep the name they were made under — that is the point of writing
it down — and the photographs in hand survive the switch; only typing in
the boxes is cleared, which the confirmation says.

**Verify:** typecheck clean; 243 tests, 207 pass, the same 10
pre-existing environmental failures as the parent commit. Four new tests
cover the resolver. Driven at 375x812: `Joseph` refused with nothing
stored and no roster on screen, `  jOJo  ` accepted and stored as
`Jojo`, the capture screen fits without scrolling, a queued row carries
`capturedBy: "Jojo"` with no box on the page, a cancelled hand-over
changes nothing, a confirmed one returns to the gate with the queue
still draining behind it, and `sue` then arrives at a capture screen
still holding the two photographs and showing "Queue it · 2 photos".

## 2026-08-31 — CAPTURE-NEXT-DISC: the crate never leaves the camera

**Decision:** A third control, **Next disc · N**, goes in the camera
bar. One tap files the disc in hand, zeroes the count and leaves the
viewfinder open. Done keeps its meaning exactly — leave the camera for
the form, photographs intact. The torch moves out of the bar to the
top-left corner of the viewfinder to make room.

**Rationale:** Photographing one disc cost N shutter taps plus three
that were not — Photograph, Done, Queue it — and restarted the camera,
black frame and fresh `getUserMedia`, every disc. It is now N + 1, and
after the first the camera never closes. Typing moved behind Done, which
makes typing the exception rather than the default: what photo-first has
meant all along.

**Done still does not queue.** Done is what you press to check a frame,
to type a catalogue number, because somebody spoke to you. A premature
one would file a disc with two of its four photographs and turn the
other two into a SECOND disc — the fault CAPTURE-ONE-SCREEN deleted the
crate mode for, arriving one tap at a time.

**The undo is the drain's own backoff field, not new machinery.** A
filed entry is written to IndexedDB immediately, as always, but with
`nextAttemptAt` five seconds out. `selectDrainable` already refuses an
entry whose attempt time has not arrived, so the hold cannot leak and
nothing new had to learn about undo. The offline guarantee is untouched:
the WRITE never waits, only the send. A tab closed inside the window
leaves an ordinary pending entry that goes out on the next tick.

Undo puts the disc's photographs back in FRONT of anything shot since,
so a tap between two frames of one disc loses neither, and it restores
typed values only into boxes still empty — it must never delete
something typed in the seconds after the mis-tap. It covers Queue it
too: one code path rather than two, and the double-tap fault the last
pass found lives on both.

**Geometry, measured rather than asserted.** Next disc sits bottom-LEFT,
Done bottom-right. A phone is held in one hand and shot with that thumb,
so the near corner is reached without thinking and the far one needs a
stretch: Done costs a tap when mis-hit, Next disc files a disc, so Next
disc is the one put out of reach — 44 px clear of the shutter at 375 px
wide. In landscape the bar runs down the right edge, where end-aligning
put Next disc 8 px from the shutter; centred in its row it is 49 px away
and Done is left where it was.

**Costs, stated.** A viewfinder open across a crate costs battery and
keeps the camera indicator lit; Done is still there for a pause. Every
capture's first send is five seconds later than it was.

**Verify:** typecheck clean; 239 tests, 203 pass. The 10 failures are
pre-existing and environmental — `matcher.test.mjs` and
`photo-extract.test.mjs` read `Pre August 2026/`, gitignored and so
absent from any worktree; the identical 10 fail on this commit's parent.
Driven at 375x812, 667x375 and 375x667 against a canvas-backed fake
camera with `/api` failing the way a loft fails: one tap files the disc
and the viewfinder stays open, the count zeroes, the entry lands with a
5,003 ms hold, Undo deletes it and returns three photographs and the
typed label, the toast passes taps to the shutter while its own button
takes them, the offer goes when the window closes, and Done still
reaches the form with the photographs intact.

## 2026-08-31 — CAPTURE-ONE-SCREEN: one disc, one screen

**Decision:** "Photograph a whole crate" is removed. Condition grading
and the "More" block are commented out of the page rather than deleted.
What is left is the shutter, three boxes and Queue it, which fits an
iPhone SE in portrait with nothing below the fold.

**Rationale:** One sentence from the maintainer retires the bulk mode
outright — more than one photograph is always needed. CAPTURE-BULK-PHOTOS
wrote one row per photograph, so a crate walked that way manufactured
three discs where one stood: the same fault as a required field answered
with filler, arriving faster and indistinguishable afterwards. The speed
it bought is bought instead by there being almost nothing on the page.

**Parked, not deleted.** The condition and More markup stays in `main.ts`
inside HTML comments. The Worker still accepts every one of those fields,
`readFields` still looks for every id, and removing two comment markers
restores the page exactly. Nothing is lost by leaving them off: condition
and matrix/runout are legible on the photograph afterwards, which is a
better reading than one typed one-handed in a loft.

**What it costs, stated rather than solved.** `capturedBy` has no box now,
so a second capturer cannot name themselves. The value is read from
storage alone and a device that never had one sends nothing — absent
rather than guessed, per the rule everywhere else here. On the wish-list.

**`bulkFields` and `BULK_CARRIED` stay in `queue-logic.ts`** with their
tests. The UI path is gone; deleting tested logic to tidy up after it is
not the same decision and was not asked for.

**Five faults the pass found, all of them mobile-only.** A flash message
was written into the page flow, so every camera error — including the
torch refusal iOS always gives — was painted behind the fullscreen
viewfinder where nobody could read it; it is now a fixed toast above both
the bar and the camera. A double tap on Queue it wrote two discs, because
each pass mints its own clientId and the Worker's idempotency cannot see
past that. Autofocus after a save threw the keyboard over the shutter,
which is the next thing anyone touches. The photo-delete target was 24 px
next to another 24 px target, and losing that coin toss deletes a
photograph of a disc already back in the crate — 34 px now, and inside
the frame rather than overhanging the next photograph. Landscape put the
three boxes below the fold; they now run across, where the width is.

**Verify:** npm run gate green (238 tests), and the page driven in a
375x812, a 375x667 and a 667x375 viewport: fits without scrolling in all
three, Enter walks the three boxes and releases the keyboard, the queue
button counts the photographs it is about to send, a queued capture
resets the form, and the parked ids resolve to null without throwing.

## 2026-08-31 — OPEN-V1-AUTH, DATASET-EDIT: no sign-in, one bolted drawer

**Decision:** Maintainer signed off both on 2026-08-31.

- **v1 gets no sign-in.** Capture and photo upload stay anonymous.
- **DATASET-EDIT proceeds as written**: a shared `EDIT_TOKEN` on the
  edit endpoints only, and — in the same commit — the AGENTS.md hard
  rule reworded from "never write back over `capture`" to bar *machine*
  writes while permitting human correction.
- **CAPTURE-WHO is promoted to the current milestone**, on the
  maintainer's instruction not to lose it. A typed name is the third
  piece: it gates the app crudely and stamps who captured each row.

Both were signed off with an explicit instruction to leave notes for
rethinking later, so the revisit triggers below are part of the
decision rather than a hedge against it.

**Rationale:** The brief defers auth but conditions it — revisit
"before M2 puts the Discogs token behind a public endpoint". That
happened, so the revisit was owed and has now been taken rather than
allowed to lapse quietly, which is the whole value of having written
the condition down.

What is actually exposed is junk rows and R2 objects, not a credential:
the Worker exposes named operations, nothing returns the token, and the
matcher runs from cron with no HTTP entry point. Against that, sign-in
on capture would put a way to fail into an offline queue on a phone in
a loft — which is the one place this app must not acquire one.

The asymmetry is the reasoning: **adding a row is not the risk that
rewriting 465 is.** So the bolt goes on the drawer worth bolting and
nowhere else. It is not sign-in and the record is explicit that it does
not pretend to be.

**The hard-rule amendment is the load-bearing part**, and it is narrow.
The bar exists so duplicate detection runs on what a person read rather
than on what a bad match wrote — a bar on machine writes. A person
fixing their own typo is the opposite case, and the sentence as written
forbade it, so an autonomous session would correctly have stopped.
Machine writes stay barred. The accepted cost: the previous reading is
gone, surviving in `data/deep-groove-v1.csv` for the 446 imported rows
and nowhere for app captures.

**Rethink when any of these:** the passphrase starts feeling like the
wrong shape; anyone outside the household needs to capture; a junk-row
flood arrives through the open capture endpoint; or the collection
becomes worth more than the inconvenience of signing in. Cloudflare
Access in front of everything is the known next step and was not chosen
now, not ruled out.

## 2026-08-31 — CAPTURE-MERGED-ROWS: one merge, and one false positive

**Decision:** Item 453 was two discs and is split at photograph 7,
giving item 466. Items 455, 453 and 466 are each **one disc**, on the
maintainer's inspection. `tools/split-item.mjs` exists for the next
one.

**Rationale:** The first full reading of the photographed set found two
rows carrying more than one catalogue number, and both were the rows
with the most photographs — twelve and eight against a median of five.
That looked like a clean signature and it was half right.

**453 really was two records.** `453-6` is Ace of Clubs ballet notes
under Fistoulari; `453-7` is the Music for Pleasure sleeve front for
Tchaikovsky's *Romeo & Juliet* and *Francesca da Rimini*. The
maintainer put the boundary at 7 and the photographs agree.

**455 was not.** `M-2314; AM 2314` is one disc printing two numbers — a
double header. So **two catalogue numbers is not evidence of a merged
row**, and the count of photographs is not either: a record with
several pieces earns several photographs honestly. The heuristic that
found 453 would have destroyed 455, and only a person looking at the
discs could tell them apart. That is worth remembering the next time a
tidy signal appears in this data.

**The reader was right both times.** Given twelve photographs of two
records it reported two catalogue numbers rather than choosing one, and
given a double header it did the same. Refusing to choose is correct in
both cases; what the answer means is a fact about the disc, not about
the reading.

**And the ladder already handles a double header.**
`normaliseCatno('M-2314; AM 2314')` yields both `M-2314` and `AM 2314`
as separate search variants, so the matcher tries each. Nothing needed
building — it was worth checking before promoting rather than
discovering through a row that matched nothing.

**The prevention shipped separately.** Filing a disc used to mean
leaving the viewfinder, so a second disc joined the first;
CAPTURE-NEXT-DISC put that control in the camera bar. This record was
the repair.

## 2026-08-31 — BROWSE-PHOTOS: serve the photographs, behind the typed name

**Decision:** `GET /api/photos/:key` exists and requires an
`x-capturer` header naming someone on the roster. The `r2_key` fields
in `/api/items/:id` and the review queue move behind the same header.
Browse and the review queue both show the photographs.

**Rationale:** Maintainer, 2026-08-31: "yes, show. use the name sign
in." The prompting failure was concrete — two items were confirmed in
the review queue against an empty panel, and the maintainer reported
having "no idea how I was supposed to cross check". A match cannot be
judged against a disc nobody can see.

**Say what this gate is, because the code does.** The roster is six
household first names and it SHIPS IN THE CLIENT BUNDLE; `src/who.ts`
calls the name "a speed bump and an honest label on a row, not access
control". Anyone who opens the JavaScript can read the six valid
answers. So this stops a crawler and a stranger guessing a URL, and
stops nobody who looks. That trade was taken knowingly, by the same
person who had already settled OPEN-V1-AUTH as no sign-in for v1.

**What stopped it being theatre.** `/api/items/:id` returns every
`r2_key`, and the key IS the photograph's address — gating the route
while handing keys out anonymously would have protected nothing at all.
Both moved together. That an item HAS photographs, and when, stays
public: it is the count the browse filter reads and it says nothing
about a record.

**A path the caller controls, closed on the way.** `parseCapture` only
trims `r2Key`, so a stored key can be any string a capture chose. The
route matches the key against `item_photo` before R2 sees it, so an
invented key is a 404 rather than a lookup.

**The test that said no such route may exist was updated, not
deleted.** It was right when written, while the question was open. The
property it protects — photographs are not anonymously enumerable — is
unchanged, so the assertion moved to the form that still protects it,
now covering the key as well as the route.

**And a lie in the test double was found by this.** `makeR2` recorded a
byte COUNT and returned it, so `get(...).body` was undefined: a photo
route could serve nothing and every local check would still pass. Found
by fetching a real photograph through the real Worker and getting 200
with zero bytes. The double now keeps the bytes and returns a stream,
and the test asserts the image itself comes back — 21,848 bytes in,
21,848 out.

## 2026-08-31 — PHOTO-PROMOTE: a reading becomes a lead, never a fact

**Decision:** A photo reading is written into `raw_value` with a new
provenance source, `vision` (migration 004), and the matcher may read
it where `capture` is empty. `capture` is never written. The matcher's
output goes to the review queue, where a person accepts or rejects it.

**Rationale:** The maintainer asked for every photographed record to be
attempted, matched against Discogs, and then confirmed by hand. That is
the decision SPIKE-PHOTO-TO-FIELDS was built to inform, and it was
taken deliberately rather than drifted into: everything before this
measured, and this one writes.

**`vision` rather than `guess`.** The legacy AI values M0 imported were
fabricated outright — invented ratings sitting indistinguishably beside
sourced data, which is most of why this project exists. A reading taken
off a photograph of the actual disc is evidence of a different kind.
Filing both as `guess` would hide that difference exactly where it
matters: deciding whether a value is worth showing someone to confirm.

**The provenance rule holds by construction, not by care.**
`v_confirmed_field` allow-lists `('shelf','discogs','musicbrainz')`, so
a new source is unreachable through every decision view the moment it
exists. Adding a value cannot open a hole; only editing that view
could, and 004 recreates it verbatim. A test asserts a `vision` row
stays out of the view even when confirmed.

**Why the matcher may use it.** The provenance rule governs clusters,
coverage checks, sell lists and shortlists — none of which this feeds.
Matching produces candidates for a human to rule on, and the
corroboration gate still refuses a verdict on one signal family, so a
reading cannot verify a release by itself. It has exactly the standing
a catalogue number has always had here: a lead. `capture` wins wherever
it holds a value, and a test asserts the COALESCE cannot be inverted.

**It re-queues, carefully.** The cron matcher already swept all 18 rows
and rejected them, having had nothing to search — 17 rejected, 1 error,
zero candidates, zero human decisions. Those verdicts are removed so
the rows are matched again. A run carrying a candidate or a decision is
never touched, because that is somebody's work rather than a machine's
answer to an empty question.
