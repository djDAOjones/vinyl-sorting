# Decision log

<!-- Append-only, newest first. -->

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

## 2026-08-31 — PHOTO-ROTATION: the stream does not turn with the phone

**Decision:** The camera stream is re-acquired whenever the phone
turns, the preview switches from `cover` to `contain`, the reading
reports `rotate_cw` in degrees rather than a word, and
`tools/photo-rotate.mjs` stands already-taken photographs upright from
that reading.

**Rationale:** Yesterday's measurement asked whether photographs arrive
rotated. Sixty real ones answered: yes, and intermittently, which is
the detail that identifies the cause. `451-1.jpg` arrived 90° out with
its catalogue number running vertically, while `449-1` and `452-1` from
the same session were upright.

**On iOS a track's dimensions are fixed when `getUserMedia` is called
and do not follow the device.** Open the camera in portrait, turn the
phone to frame a wide sleeve, and the frame stays portrait while it is
held sideways — so the label is stored rotated. Photographs taken
without turning the phone were fine, which is exactly the intermittency
observed. Restarting the stream on `orientationchange` renegotiates it
for the orientation now in use, and costs a black frame while turning.

**`contain` rather than `cover`, so the preview is what gets stored.**
Cover fills the screen by cropping, so the frame being composed was
never quite the frame being saved — and composing a catalogue number at
the edge of a sleeve is precisely what this is for. Letterbox bars cost
less than a cropped-off number.

**Degrees, not words.** The field was `orientation` with values like
`left`, which has to be interpreted before anything can act on it and
is ambiguous about whether it names the fault or the fix. `rotate_cw`
in degrees drives `sips -r` straight through. Verified against a real
photograph: 451-1 reported at 270° came back upright and legible, and
the 90° guess came back upside down — a direction convention that can
be checked is worth more than one that reads well.

**The sixty already taken are corrected, not re-shot.** The disc has
been handled once already, which the brief names as the expensive
resource. `photo-rotate.mjs` applies what a reading reported and is
idempotent by ledger rather than by inspection — a corrected photograph
is pixel-for-pixel indistinguishable from one that was always upright,
so re-running against the same reading would turn it twice.

Nothing detects an angle. A reading already reports one, and a
heuristic that disagreed would leave two answers and no way to choose.

## 2026-08-30 — PHOTO-ORIENTATION: ask before building a detector

**Decision:** The reading contract gains an `orientation` field —
`upright`, `left`, `right`, `upside-down` or `mixed` — reported by the
reader and shown in the score against how many values that photograph
got wrong. Nothing detects or corrects rotation. `orientation` is not a
scored field: it describes the photograph, not the record.

**Rationale:** Asked whether there could be "a viably light process to
identify the orientation of the writing". There could — a projection-
profile pass over the ink density is maybe sixty lines and no
dependency. But it would answer a question nobody has established is
being asked. No photograph has been read yet, so two things are unknown
and both are cheap to find out:

1. **Do photographs arrive rotated at all?** The live camera takes the
   frame as held, and a label is round, so the answer is not obvious in
   either direction.
2. **Does a rotated one read worse?** Vision models are largely robust
   to rotation. If a sideways label reads as well as an upright one,
   the whole question is moot however cheap the detector.

A detector is worth building only if both are true. One field in the
reply establishes both, costs nothing, and cannot be wrong in a way
that damages the data — it is never scored against a label.

**`mixed` is a correct answer, not a refusal.** A centre label with the
company name curved over the top and the title straight across the
middle genuinely has no single orientation, and forcing a choice would
manufacture a fact — the failure this project keeps returning to.

**If it turns out to matter, the cheap fix is not a detector.** The
phone knows how it is being held: `screen.orientation.angle` at shutter
time is deterministic where image analysis is a heuristic. That was not
built either, because whether the stream is already display-oriented
varies by browser and could not be tested on the maintainer's device
from here — building it blind risked rotating correct photographs into
wrong ones.

## 2026-08-30 — CAPTURE-VIEWFINDER: the camera takes the whole screen

**Decision:** While the camera is open it is fullscreen — fixed to the
viewport, page scroll locked, controls floating over the preview. In
landscape on a short screen they move to the right-hand edge. The torch
button is now always offered and tried, rather than gated on a
capability report, and explains itself when the browser refuses.

**Rationale:** Maintainer, on an iPhone SE mk2: landscape was unusable
because Safari's chrome took the room and the preview was capped at
`60vh` of what was left. On that device landscape is 375 px tall before
the browser takes its share — a preview too small to frame a label in.

Competing with the page for space was the mistake. Nothing else on that
screen matters while you are shooting, so nothing else is shown.
Measured at 667×375: the preview is now the full viewport in both
orientations, where it was a strip.

**Landscape moves the controls sideways.** At the bottom they cost the
height that is already scarce; on the right they cost width, which on a
667 px-wide viewport there is plenty of. 104 px of it, against 375 px of
height saved.

**The torch is offered, then tried.** It was gated on
`getCapabilities().torch`, which under-reports on some browsers and does
not exist on others — so the control was hidden from devices where it
would have worked. Now it is always shown, the first tap tries it, and
a refusal hides the button and says what does work: the system torch,
from Control Centre, stays lit while the camera runs. That is a real
answer for iOS rather than an apology. One wasted tap on a device that
cannot do it, against a feature that is not silently withheld from one
that can.

`100dvh` rather than `100vh`, so a collapsing URL bar cannot crop the
preview mid-shoot.

## 2026-08-30 — CAPTURE-LIVE-CAMERA: a viewfinder that stays open

**Decision:** Capture opens a live camera in the page. One tap per
photograph, no confirmation, no closing; a torch toggle where the
device has one; **Done** ends the viewfinder and **Queue it** uploads
the lot. `<input capture>` stays on the page as the fallback.

**Rationale:** Maintainer: "the flow should be camera on (flash on if
possible) and then store each shutter action, then click to upload
all." The file input cannot do that. iOS always shows Retake / Use
Photo and then closes the camera, so ten photographs is thirty taps and
ten context switches — and that friction lands on the one activity the
brief names as the thing that must not be slow.

`getUserMedia` gives a viewfinder that never goes away. It needs HTTPS,
which the live site has.

**Two costs, both real, both stated rather than discovered later.**

A video frame is a weaker image than the same phone's still: no HDR, no
multi-frame stacking. That matters here more than usual, because the
field this exists to read is a catalogue number printed smaller than
everything else on the label. So the constraints ask for 3840×2160
`ideal` — far above the 1568 px the photo is stored at — and the file
input stays on the page for a label the stream cannot resolve.

**Torch will almost certainly not appear on the iPhone.** It is a real
constraint that Chrome implements and Safari does not expose at all.
The button is capability-gated on `getCapabilities().torch` and stays
hidden otherwise, because a dead control reads as a broken app rather
than a platform limit. "Flash if possible" turns out to mean "not on
iOS", and saying so is better than shipping a button that does nothing.

**Frames are grabbed at the stored size, not at full resolution.** The
first version drew the 4K frame, encoded it, and let `downscale` encode
it again at save — two encodes, the first at six times the pixels. Now
`drawImage` scales in one step. Nothing is lost: the full-resolution
frame was being discarded at save anyway.

Shutter feedback fires before the encode rather than after, because the
encode is long enough to notice and a shutter that responds afterwards
feels broken.

**What is not verified:** shutter latency on a real phone. It was
measured only in a headless browser pane, where the renderer is
throttled and every timing came back pinned to a ~1 s tick — a
measurement of the harness, not the code. The structural gain is
certain; the number is not, and no number is claimed.

## 2026-08-30 — CAPTURE-UNDESCRIBED: the app stops asking what a photograph shows

**Decision:** Capture takes as many photographs of a record as you tap
for, and asks nothing about any of them. Every app-captured photograph
is stored as a new kind, `other`, meaning "a photograph of this item,
not described". Migration 003 rebuilds `item_photo` to allow it. The
five specific kinds stay valid for anything that can honestly claim
one; nothing captured in the app claims one, including the first shot.

**Rationale:** Maintainer, rejecting the kind-picker shipped hours
earlier: *"there will be no consistency, so any attempt to ascribe
information is dishonest and a waste of time."* That is this project's
own rule aimed at its own interface, and it is correct. `label_a`,
`front` and `runout` each assert something. With nobody asserting it,
writing one would invent a fact — and nothing downstream could
distinguish an assumed `label_a` from a confirmed one, which is the
failure the provenance rule exists to prevent.

The two cheaper options were both rejected on that reasoning.
Positional assignment (photo 3 is the sleeve front) asserts something
specific and wrong. Reusing `label_b` for extras asserts something the
schema does not mean. Only a new value ascribes nothing.

**A schema change, so it was a stop-and-ask**, per AGENTS.md. Taken now
rather than later because production held exactly one photo row: the
`item_photo` rebuild is as cheap as it will ever be, and the same
change in six months would carry hundreds of rows across a DROP TABLE.
Existing rows keep the kinds they were given — those were asserted by
an interface that asked, so they are evidence rather than guesses.

**Order is kept, because order is a fact.** The R2 key is
`clientId-<n>.jpg`. The index says when the photograph was taken and
nothing about what is in it, and it keeps the key stable so a retried
upload lands on the same object instead of making a second one.

**This forced the grouping work that was deferred this morning**, and
the deferral turned out to be right for the wrong reason: it was
waiting on a measurement, and what actually settled it was a product
decision. `photos-pull` now takes every photograph and names them
`<item_id>-<n>.jpg`; `photo-pack` batches by RECORD rather than by
image, so a record's shots can never be split across two packs; and the
prompt tells the reader that several images may be one record and asks
for one object per record. Without that last part a record photographed
three times comes back as three records — the same misattribution the
row ids exist to prevent, arriving from the other direction.

## 2026-08-30 — CAPTURE-MANY-PHOTOS: one frame is not one record

**Decision:** A capture carries several photographs, at most one of
each kind. The big button is always the centre label; add-buttons offer
only the kinds not yet taken — Label B, Sleeve front, Sleeve back,
Runout — and each extra appears as a removable thumbnail.

**Rationale:** Maintainer, from the shelf: "the catalogue and title
sometimes aren't in the same frame". That is true of most classical
LPs — the catalogue number is on the centre label, the title and
performers are often only complete on the sleeve, and on a boxed set
they can be three surfaces apart. A form that allowed one photograph
was quietly forcing a choice between them.

**Nothing below the form had to change.** `item_photo` has always been
a table rather than a column, `parseCapture` has always taken an array,
and the Worker has always written one row per photo. The constraint was
entirely in the capture screen. That is worth recording as a mark in
favour of the M1 schema: the first real product request arrived and the
data model already answered it.

**Only free kinds are offered.** A sleeve back filed as `label_b` would
assert something untrue, which is the fault crate and position were
fixed for hours earlier. Offering only the kinds not yet used makes the
wrong answer unreachable rather than merely discouraged, and it keeps
one photo per kind — which is what lets the R2 key be
`clientId-kind.jpg` without inventing a counter that a retry could
disagree with.

**The consequence lands downstream, and is stated rather than fixed.**
`photo-pack.mjs` treats one image as one row id, which no longer
matches a record that has three. `photos-pull.mjs` now counts what is
in the store by kind and says plainly how many photographs it is NOT
pulling, so a record whose title is on its sleeve cannot be read from
its label alone without someone being told. Making the pack carry
several images per row is the real fix and is deliberately not done
here — the spike has never been run, and changing what it sends before
it has a baseline would be tuning a measurement nobody has taken.
