# Decision log

<!-- Append-only, newest first. -->

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

## 2026-08-30 — CAPTURE-LOCATION: a required location gets answered with filler

**Decision:** Crate stops being required, and both crate and position
move into the collapsed "More" section. Crate also stops being sticky.
Nothing is removed from the schema, and the review queue still shows a
location when one exists.

**Rationale:** Maintainer, on the evidence of the first real capture
through the photo path. Item 448 arrived as crate "1", position "1" —
placeholders, because the storage is neither permanent nor organised
and there was no honest answer to give. The reasoning for requiring it
("a session card has to say where to find the disc") assumed a stable
shelf order that does not exist; the maintainer would rather look for a
disc than maintain a map of where it was last seen.

A required field answered with filler is the worst of the three
options. The database then asserts a location that is untrue, and
nothing downstream can distinguish it from a real one — the same shape
as the M0 failure, where a catalogue number was recorded as a verdict
and 16 wrong matches were labelled "Exact". Absent is honest; typed is
useful; invented is expensive. This project's rule has been consistent
about which to prefer, and it applies to its own form.

**Stickiness had to go with it.** Crate persisted between discs, which
was right while the field was required and visible. Folded into "More"
it becomes an invisible field that fills itself in, so one placeholder
typed once would attach itself to every future capture unseen — the
same fault by a quieter route. The remembered value is now cleared on
load, so the "1" already stored stops propagating. `capturedBy` stays
sticky: it is a fact about who is holding the phone, not a claim about
the disc.

**A bug found while verifying this.** The downscale shipped with
CAPTURE-BULK-PHOTOS ran only on the bulk path, so a single capture
still queued a full phone frame — which is how item 448 reached R2 at
4.4 MB. Twenty spike photographs taken the way they were about to be
taken would have been ~130 MB in IndexedDB, on a phone, which is the
exact failure the downscale existed to prevent. It now runs on both
paths: a 6.45 MB frame queues at 370 KB.

## 2026-08-30 — CAPTURE-BULK-PHOTOS: a bulk row carries the crate and nothing else

**Decision:** Bulk capture writes one row per photo and carries exactly
three fields to every row — crate, position and who is capturing.
Everything else on the form is dropped. Position auto-increments only
from a number the person typed; blank stays blank. Photos are
downscaled to 1568 px on the long edge before they are queued. And the
drain now continues past a row the server rejects, stopping only when
the failure is shared.

**Rationale:** Promoted out of the icebox ahead of its stated trigger,
on maintainer instruction to bring the photo path forward. That was the
right call on the evidence: M2's remaining work is a deploy and 286
keyboard decisions, both maintainer work, so this was the buildable
item — and the brief names "building the app instead of cataloguing the
records" as the risk that actually matters.

Three sub-decisions carried real weight.

**What carries over is the whole design.** The obvious implementation
copies the form to every row, and that would put one disc's catalogue
number on twenty — nineteen invented values, indistinguishable from
typed ones, which is precisely the M0 error manufactured wholesale
rather than inherited. Crate is where you are standing, position is
countable, and who is capturing does not change between shots. A
catalogue number, a label, a condition grade are each a claim about one
disc. `BULK_CARRIED` is three entries long and a test asserts the other
eight are dropped.

**Position auto-increments only from a typed start.** Photographing in
shelf order genuinely does make positions sequential, so incrementing
is not a guess — but choosing the starting point would be. Type 12
before a crate of twenty and get 12–31; leave it blank and every row
has no position at all. The record asked for a decision rather than a
silent null, and this is one in both directions.

**A bad row must not hold a crate hostage.** The drain used to `break`
on any failure, which is right for one entry and wrong for twenty: a
photo the server refuses would sit at the head of the queue for ever
with the good ones stuck behind it. The split is now by cause — no
status means the fetch never completed (offline, everything behind
fails alike), 5xx is the server or a missing binding (equally shared),
4xx is about that entry alone. Verified in a browser against the real
Worker: a deliberately oversized photo in the middle of a batch of four
came back 413 and stayed `failed` and retrying, while the other three
synced, and the badge read "3 sent · 1 retrying" — a half-uploaded
crate that looks half-uploaded.

Downscaling was the cheap part but not optional: the queue stores raw
Blobs, so a crate of twenty phone frames is ~80 MB in IndexedDB, on a
phone, in a loft, where iOS evicts under storage pressure. 1568 px is
what the chat pack sends anyway, so nothing downstream loses anything.
If the browser lacks the canvas APIs the original is queued unchanged —
losing a capture to a resize is not a trade this app should make.

Nothing in the Worker or the schema changed; `parseCapture` already
accepted a capture with a photo and no catalogue number, and a test
already said so in those words.

## 2026-08-30 — SPIKE-PHOTO-TO-FIELDS: no API keys; the label reading goes through a chat window

**Decision:** No API keys, anywhere in this project. Reading a label
photograph happens by uploading a zip of images to a chat the
maintainer already pays for, and importing the reply. The metered path
— a vision API called from `tools/`, then perhaps from the Worker — is
ruled out, and the tool that implemented it is deleted rather than
parked.

**Rationale:** Maintainer's ruling, given as "no API keys to be used"
alongside the observation that a zip export of images with row ids
would be useful. It is a better fit than the design it replaced, on
three counts the spike had already flagged as costs:

- **OPS-SPEND-GUARD stays intact.** That decision rests on the
  Cloudflare Free plan being a hard wall — D1 refuses writes past
  100k/day rather than charging. A metered API key has no wall, and
  adding one would have reopened a question that is currently closed.
- **The Worker's one-outbound-file invariant survives.** A vision
  client would have been the second file in `worker/` making an
  outbound `fetch(`, against an exact-equality assertion in
  `worker.test.mjs`. Nothing now needs that test generalised.
- **No second secret**, in a v1 that has no sign-in.

**The cost it carries, recorded:** a hand-run round trip has a failure
mode an API call does not. Twenty images go up and eighteen objects
come back, and without ids every row after the gap is attributed to its
neighbour — nineteen plausible readings, all shifted by one, and
indistinguishable from good data. That is why every image is named
after its row id, why the id is repeated in the prompt text, why the
importer refuses an id it never sent, and why it exits non-zero when a
reply names one. The mitigation is not incidental to the design; it is
most of it.

Also uncosted but real: a person now does the uploading, 750 records at
20 per batch. If the readings turn out good, whether that is tolerable
is the next question — and it is the one thing that could argue for
revisiting the metered path.

**Trigger to revisit:** a scored run that passes the bar, plus the
maintainer finding the manual loop tedious enough to price again.

## 2026-08-30 — OPEN-SELL-THRESHOLD: value is never a reason to keep

**Decision:** A copy is kept for musical reasons only. Market value
does not earn a keep, however high. Selling is only attempted above
**£10**; below that the effort is not worth it.

**Rationale:** Maintainer's ruling, asked as "a losing copy turns out
to be worth £80 — sell or keep as an asset?" The answer separates the
two questions the shootout kept entangling: whether the music is worth
having, and whether the object is worth money. Only the first can keep
a record. Deciding it once removes a per-record hesitation from every
session, which is an R5 mitigation — the shootout dies around session
six when each decision reopens the same argument.

The £10 floor is about effort, not worth: listing, packing and posting
a £4 record costs more than it returns.

**Follow-on, unresolved:** what happens to a sub-£10 loser. It is not
sold and not kept, and nothing in the design says where it goes —
donate, charity shop, or a "not worth selling" pile. Small, but it will
come up the first session that produces one, so it is in the wish-list
rather than invented here.

## 2026-08-30 — OPS-SPEND-GUARD: the Free plan is the wall; the write budget is belt-and-braces

**Decision:** Ship the per-tick write budget and ship no CPU limit. The
account is on the **Free plan** (confirmed from the dashboard: 113 of
100,000 requests today, with an Upgrade button), so runaway billing is
not possible — D1 refuses writes past 100k/day rather than charging for
them. `WRITE_BUDGET_PER_TICK` stays at a provisional 200.

**Rationale:** This item was written on the premise that "Cloudflare
sells no hard spend cap", which is true on Workers Paid and moot on
Free. Its own scope note said to settle the plan question first because
it decides how much the rest matters. It did: the wall already exists,
the budget alert is set, and the per-tick budget is now redundancy
rather than the only defence.

The ceiling stays provisional deliberately. The item asked for it to be
measured, and it still should be — but a guessed number costing nothing
while billing is impossible is not worth blocking the item for. A test
asserts its headroom, so it cannot be tightened into a throttle by
accident.

**Cost of getting this wrong, recorded:** `[limits] cpu_ms` was added
here as prudence and made the Worker undeployable on Free — every
deploy failed with code 100328 until it was removed. The lesson is
narrower than "test your config": a guard that blocks shipping is worse
than the risk it guards. The test is inverted to hold that.

**Trigger to revisit:** upgrading to a paid plan. Then the wall
disappears, cpu_ms becomes settable, and the ceiling wants its
measurement.

## 2026-08-30 — DEPLOY: six faults only the real platform could show, and one wrong conclusion

**Decision:** Ship to a Worker serving its own static assets. The
matcher runs from cron, pacing Discogs requests at least 2 s apart.

Live at `deep-groove.joe-2d2.workers.dev` with 446 items, 446 match
runs and 2,045 candidates. Every fault below passed locally:

1. **Remote D1 rejects explicit transactions.** The seed wrapped itself
   in `BEGIN`/`COMMIT`; miniflare accepted it, D1 refused.
2. **`d1 info <name>` resolves through wrangler.toml**, which holds a
   placeholder on a first run — which is why the maintainer's first
   deploy appeared to do nothing. Ids now come from `d1 list --json`.
3. **D1 caps a query at 100 bound parameters.** The review queue bound
   one per run id, so a 200-row page returned 500 in production.
4. **A stored global `fetch` is detached in Workers**, raising "Illegal
   invocation". Node tolerates it; the default is now a wrapper.
5. **KV refuses a TTL below 60 s.** The spacing key wanted 8. The fake
   KV ignored TTLs entirely, so it shipped — a double more permissive
   than the real thing is worse than none, and it now enforces the floor.
6. **The rate limiter had no minimum spacing.** A per-minute budget is
   spent as an instantaneous burst, and Discogs enforces a lower rate
   than it publishes while caring about burstiness.

**A wrong conclusion, corrected.** On seeing 429s from the Worker while
the same token returned 200 from a laptop with 59 requests remaining, I
concluded Discogs was throttling Cloudflare's shared egress IPs and
that no amount of rate limiting could help. The maintainer said the
real limit is lower than published and needs about one request every
two seconds. That was right, and it was my bug: the fixed-window
counter permitted the entire budget instantly. The laptop looked
healthy precisely because its round-trip time paced it.

Both factors are real — the shared IP does make Discogs stricter, since
7 of 12 queries still fail at 2 s where the laptop managed 446 rows
with zero failures — but the dominant cause was mine. Tuning continues
in M2-DISCOGS-PACING.

**The pattern worth keeping:** a suite of 167 tests and a local
emulator caught none of these. Faults 4, 5 and 6 would each have
silently mis-reported records as unmatchable, had the error state built
in M2-MATCHER not refused to call a failed search a negative result.

**R2 stays off.** Enabling it needs a dashboard action the API refuses
and which may ask for payment details, so the binding is optional:
photo uploads answer a retryable 503 and the phone keeps them queued.

## 2026-08-30 — M2-REVIEW-QUEUE: two bugs that only a real browser was going to find

**Decision:** Ship the keyboard-driven queue — 1–5 choose, N none, S
skip, B back, M manual id — with each candidate showing which families
of evidence agreed rather than only a score. Resolving is the ONLY
route to decision-eligibility: the matcher writes `discogs` unconfirmed,
and a person's answer is what adds `confirmed_by`.

**A type-ahead race was mis-filing decisions.** `resolve()` read
`queue[cursor]` and advanced the cursor only after awaiting the write,
so a second keypress during the in-flight request answered the SAME
item twice — and because the write upserts on run id, the second answer
silently overwrote the first while the next item was skipped entirely.
Driving it in a browser produced `POST /review/1`, `/review/2`,
`/review/2`: three keystrokes, two items, one wrong answer recorded and
one item never seen. Someone clearing hundreds of items types ahead, so
this was the normal case. Fixed by capturing the run id before the
await and advancing optimistically, with a rollback that puts the item
back rather than losing it.

**The service worker would have blocked every future deployment.** It
was cache-first for everything same-origin, so once `index.html` was
cached a new build never reached anyone — the stale HTML kept pointing
at the old hashed assets. It was caught because the browser kept
serving a fixed module's old copy back during testing. Now navigations
and HTML are network-first with cache as the offline fallback, and only
content-hashed `/assets/*` are cache-first.

Neither bug was reachable from the test suite as written: one needed
real event timing, the other a real cache. That is the argument for
driving the thing rather than only asserting about it.

**On the done-when.** "The queue can be cleared by keyboard" is met and
was demonstrated. "The 446 have been through it" is not — that is an
operation needing a deployment and about an hour of API time, split out
as M2-FIRST-RUN rather than quietly counted as done.

## 2026-08-30 — M2-MATCHER: the gate works, and the audit nearly marked its own homework

**Decision:** Ship the ported ladder with the three intended changes —
MacRoman repair upstream, an input sanity check before any API call,
and the corroboration gate (score >= 80, families >= 2, margin >= 25).
Matching runs from a **cron trigger, not a route**, which is how "no
sign-in" survives the arrival of a live token: there is no HTTP entry
point to aim, and the query set is a pure function of stored capture
values.

**The audit had to be corrected before it measured anything.** The
first run scored each claimed release against the captured `label` —
but on those 277 rows the label came FROM Discogs, so the label family
always fired and 276 of 277 looked corroborated. That is Discogs
agreeing with itself. Re-run using only values whose recorded
provenance is `legacy` or `shelf`, it reports **12 unsupported**, 4 of
them labelled "Exact". The AGENTS.md rule — verification runs on what a
human read, not on what a bad match wrote — turns out to apply to the
verifier as much as to the data.

**What the gate caught.** A conductor captured as "Kletski" matched to
King Diamond's *Abigail II* on a colliding `2241-2`. `CFP 4016`, a
Classics for Pleasure number, matched to a Fontana pop single and
labelled "Exact". A 1938 Carnatic 78. A 2014 dance compilation. These
are precisely the collisions the margin and family tests exist to
refuse, and the old rule accepted them.

**The brief's figure of 26 cannot be reproduced, and is not claimed.**
It does not say which rows it meant or how they were identified, so
there is nothing to compare against. 12 is what the gate measures on
the evidence available. Reporting 26 would be fitting the number to the
story.

**Where risk remains:** 102 of the 265 supported rows carry no people
evidence at all — catalogue number, title and format only — and 29 of
those have no year either. A generic compilation title plus a colliding
catalogue number clears 80 unaided, so that is where a wrong match is
likeliest to be hiding.

**Alternatives:** Weight the catalogue number higher so more rows
auto-accept — rejected, that is the defect. Keep the label in the
audit — rejected, it is circular and produced a flattering, meaningless
result.

## 2026-08-30 — M1-CAPTURE-UI: the queue is the product, and it was verified in a browser

**Decision:** A single-screen PWA. Every capture is written to
IndexedDB before anything else happens, and the UI never awaits the
network. Sync is a background drain with capped exponential backoff
that never drops an entry. Label and catalogue number are separate
inputs, with the reason printed under them.

**Verified end to end in a real browser, not asserted.** A capture was
entered with no backend running; it queued, was marked for retry
rather than lost, survived a hard refresh with every field intact,
retried four times under backoff, and then synced the moment the
Worker appeared — arriving in the database as crate B4, position 12,
`SXL 6113`, Decca, Solti, VG+, with `shelf` provenance, unconfirmed,
and `decision_eligible` still zero. That sequence is the done-when:
captured with no signal, appears in the collection afterwards.

**Photo-first, so a photo-only capture is valid.** The requirement is
a crate — a session card has to say where the disc is — plus either a
photo or a catalogue number. Walking a crate photographing labels and
typing nothing is the fast, delegable path, and the API and the client
agree on it; a shared test feeds the client's request body to the
Worker's validator.

**Crate and captured-by are sticky.** You work through one crate at a
time, so re-typing it per disc is the single largest avoidable cost.
With no sign-in there is no identity to read, so `captured_by` is a
remembered free-text field — a partial recovery of the "who captured
this" the provenance model wants.

**The app measures itself.** Each entry records milliseconds from
starting the disc to queueing it, and the header shows a running
median. The done-when asks for a measured median under 30 s; the
instrument now exists and reports honestly, but the number will only
mean anything once real discs are captured. Nothing here claims that
threshold has been met.

**Local development needs no Cloudflare account.** `tools/dev-api.mjs`
serves the real Worker over the node:sqlite bindings, so the whole app
runs on a machine with no wrangler login. Deployment does need one and
is a maintainer step; README carries the runbook.

**Alternatives:** Post directly and queue only on failure — rejected,
it makes the offline path the exceptional one and therefore the broken
one. A combined label/catalogue field — rejected, that is the defect
M0 measured at 9%.
