# Archived decision-log entries

<!-- Pruned from project/decision-log.md, VERBATIM, newest first.

     2026-08-31, fourth prune: a parallel session added five entries
     and this one added four, taking the live log to 23. The oldest
     nine move here — the M0/M1/M2 build decisions and the capture
     interface work of 2026-08-30. Their rules survive in AGENTS.md,
     in the schema comments and in tests.

     2026-08-30, third prune: a day of capture-interface decisions
     filled the log again. The seven oldest — M1 and M2 build decisions
     — moved here; the schema, the Worker's shape and the matcher's
     gate are all enforced by tests and by AGENTS.md, so the live log
     loses none of the rules they set.

     2026-08-30, second prune: the live log was full at 20 and
     CAPTURE-BULK-PHOTOS needed an entry, so the oldest six — the M0
     import and repair decisions — moved here. Their rules survive in
     code and tests (the split-label-catno rule is named in
     tools/lib/photo-fields.mjs and enforced by its tests), so leaving
     the live log costs working memory nothing.

     2026-08-30, first prune: the live log reached 19 of 20. The five
     founding decisions of 2026-08-28 moved here; their substance is
     restated in project/brief.md and AGENTS.md. -->

<!-- 2026-09-01, fifth prune: six entries, all 2026-08-30, moved
     when the interface stream took the log to its 20-entry
     ceiling. Verbatim, newest first, as the contract requires. -->

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

## 2026-08-30 — M1-WORKER: with no sign-in, the Worker's shape is the security

**Decision:** Named operations only — health, capture write, photo
upload, item reads, and a decision-eligible count that reads through
the views. Everything else returns 404 "no such operation". No route
takes a caller-supplied upstream query, and **M1 contains no outbound
request at all**.

**Rationale:** v1 has no sign-in, so nothing at the perimeter
distinguishes the maintainer from a stranger who finds the URL. What
does the work instead is the absence of anything worth aiming. The
strongest available form of "no proxy" is not a hard-coded upstream
but no outbound call to hard-code one into, and a test asserts exactly
that: zero bare `fetch(` in the Worker sources. A second test asserts
no route reads `DISCOGS_TOKEN` — the binding is declared so the types
know it exists, and dereferenced nowhere. The token is unreachable,
not merely unused.

This is what makes the no-sign-in decision cost nothing in M1: capture
is a person typing what is printed on a label, so there is no Discogs
path to protect yet. M2 changes that, and M2-MATCHER carries the gate.

**Capture writes are idempotent on a client-generated id.** The
offline queue retries, and a retry must not create a second physical
disc. A replay returns 200 rather than 201 so the client can drop the
queued entry either way without treating success as an error.

**Captured values are `shelf` and unconfirmed.** Reading a label is
not verifying a pressing — M2 confirms. So a freshly captured disc is
decision-ineligible exactly like an imported one, and a test asserts
it.

**A photo-only capture is valid.** Photo-first means walking a crate
photographing labels and typing nothing, so the API requires a crate
(a session card has to say where the disc is) plus either a photo or a
catalogue number — not a catalogue number.

**The rate limiter is built although nothing calls it**, so M2 cannot
skip it, with the shared budgets AGENTS.md fixes: Discogs 50/min,
MusicBrainz 1/sec. A test drives two limiter instances standing in for
two isolates and proves 50 total, not 50 each. The counter store is an
interface because KV is eventually consistent; when M2 needs
exactness, a Durable Object satisfies the same three methods.

**Testable with no Cloudflare account.** D1 is SQLite, so the bindings
are stubbed over `node:sqlite` and the Worker is exercised through
real HTTP requests against the real schema — no wrangler, no emulator.

**Alternatives:** A general `/api/discogs/*` proxy — rejected; with no
sign-in it hands a stranger the maintainer's rate limit and identity.
Per-caller rate limiting — rejected by AGENTS.md, and it cannot work
when callers are anonymous.

## 2026-08-30 — M1-SCHEMA: provenance decides where a value lands, and views decide what may read it

**Decision:** The four-entity schema from brief section 03, with two
enforcement mechanisms rather than conventions.

**The query layer is real code.** Four views — `v_confirmed_field`,
`v_decision_eligible_item`, `v_decision_eligible_release`,
`v_eligible_work_coverage` — are the only route by which anything may
feed a cluster, coverage check, sell list or shortlist. A `guess` or
`legacy` value is unreachable through them *even when marked
confirmed*, and an unconfirmed `discogs` value likewise. Tests assert
both directions: that the loaded dataset yields nothing, and that
confirming one row makes exactly that row appear. A view that is
merely empty proves nothing; this one discriminates.

**A value's destination is decided by its provenance, not its name.**
`label_raw` sourced `legacy` is something a person typed and goes to
`capture`; the same column sourced `discogs` is something a matcher
wrote and goes to `release`. This is the AGENTS.md boundary — never
write back over capture — made structural. Of the 446 rows, 31 labels
reached `capture` (the ones M0 split out of the backlog) and 267
reached `release`.

**Nothing is dropped.** Values with no home in the model yet go to
`raw_value` with provenance intact: 1,248 `guess`, 554 `discogs`
(musicians and track listings on matched rows, homeless until M3
resolves tracks into works) and 528 `legacy`. A first attempt tallied
these by column name and was wrong twice — the 28 track listings M0
reclassified are named like legacy columns and are guessed in truth.
Counting by name would have reproduced, in the statistics, the exact
confusion the provenance rule exists to end.

**Load result:** 446 items, 446 captures, 267 releases across 277
links — 10 items share a pressing with another, which is two copies of
one release and not a duplicate — and 4,681 `field_source` rows. Zero
decision-eligible, which is the done-when.

**Testable without Cloudflare.** D1 is SQLite, so the schema and the
load run against Node's built-in `node:sqlite`: no emulator, no
account, no deploy. The same SQL is what `wrangler d1 execute` applies.

**Alternatives:** Enforce provenance in application code — rejected,
that is the convention the rule explicitly refuses. Drop the values
with no home — rejected, `musicians` and the track listings are M3's
input.

## 2026-08-30 — OPEN-USERS-ACCESS: no sign-in for v1, and the risk is deferred rather than accepted

**Decision:** No sign-in for v1. Two or more trusted people capture,
and the maintainer chose no authentication after being shown that
Cloudflare Access needs no password — an emailed code or a Google
sign-in — and that it is free to 50 users. That is the maintainer's
call and the build follows it. `brief.md` is updated so the identity
document stops claiming Access sign-in.

**The concern, recorded once:** an open URL means anyone who finds it
can read and edit the collection, and any public endpoint that reaches
Discogs does so with a token now confirmed live. The brief also says
"not public, ever". Per-person identity would additionally have told
`shelf`-sourced values who read them off the record.

**Why this costs nothing yet.** Capture does not call Discogs — it is
typing what is printed on a label, offline, into an IndexedDB queue. So
M1 needs no Discogs path reachable from the browser at all. The Worker
gets named operations only, capture-write and dataset-read, rather than
a general proxy; the token stays a Worker secret that no caller can
aim. Deployment goes to an unguessable Pages subdomain.

**Where it becomes live: M2.** The matcher is the first thing that
would let a caller drive Discogs queries. Noted on M2-MATCHER as a
gate: before shipping the matcher, either add Access then, or keep
matching strictly server-side as a queued job with no
caller-controlled query. The second option preserves "no sign-in" and
still closes the quota hole, so this may never need revisiting as an
auth question at all.

**Alternatives:** Cloudflare Access with an email allowlist —
recommended and declined. A shared passphrase — not offered seriously;
it is more friction than Access and weaker.

## 2026-08-30 — OPEN-SYSTEM-OF-RECORD: the app database is authoritative

**Decision:** Confirmed by the maintainer — the app database is the
system of record. Import is one-way: the frozen spreadsheets flow in
once and are never written back. The CSV export to OneDrive is a
readable backup, not a synchronisation contract.

**Rationale:** The alternative makes round-tripping a first-class
problem, and round-tripping between a database and a spreadsheet is
where the previous nine schema generations died. One-way import means
`data/deep-groove-v1.csv` is a handoff artefact rather than a live
mirror, and M1 can load it and forget it.

**Consequences to hold to:**

- Editing moves into the app. A spreadsheet edited after M1 loads is
  not a source of truth, and nothing will reconcile it.
- The export is written for a human to read and for disaster recovery.
  Nothing reads it back in.
- `Pre August 2026/` stays read-only, as it already is.

**Alternatives:** OneDrive stays authoritative — rejected by the
maintainer. It would have required two-way sync, conflict resolution
and a merge story for per-field provenance, none of which a private
household tool should be carrying.

## 2026-08-30 — OPEN-DISCOGS-TOKEN: valid, not a seller, and that costs less than assumed

**Decision:** Keep the existing token. The account will not be made a
seller. Valuation uses lowest asking price, number for sale and the
have/want ratio; condition-graded price suggestions are out of scope.

**Verified, not assumed.** The token authenticates — HTTP 200 on
`/oauth/identity`, account `walter_odington` (id 1149676), 40-char key.
`num_for_sale` is 0 and `/marketplace/price_suggestions` returns 404
"You must fill out your seller settings first", so the account is
definitively not a seller.

**What that actually costs.** Tested against release 7387168, the first
row of the M0 dataset:

- `/marketplace/stats` — HTTP 200. `num_for_sale: 21`,
  `lowest_price: GBP 1.59`.
- `/releases/{id}` — HTTP 200. `community.have: 70`, `community.want:
  13`, `lowest_price: 2.15`.
- `/marketplace/price_suggestions` — 404, seller-only.

So the only loss is "what should a VG+ copy fetch". Lowest current
price, supply and the have/want ratio are all reachable, and have/want
is a better scarcity signal than a price suggestion anyway. An earlier
note in this session claimed a non-seller account could not value a
record at all; that was wrong, and it changes OPEN-SELL-THRESHOLD from
a question about whether valuation is possible into a question about
what to do with the number.

**Handling:** the token was read inside a script and never echoed. It
stays out of the repo, enters the Worker via `wrangler secret`, and the
archived copy remains listed in the manifest without a digest.

**Alternatives:** Fill out seller settings to unlock price suggestions
— rejected by the maintainer, who has never sold and does not intend
to. Mint a fresh token — unnecessary, this one works.

## 2026-08-30 — M0-RECONCILIATION-REPORT: the report is generated from the build it describes

**Decision:** `tools/build-report.mjs` writes both artefacts —
`data/deep-groove-v1.csv` and `data/reconciliation-report.md` — from a
single `buildDataset()` call, and embeds a machine-readable summary
block. The gate asserts those numbers still equal a fresh build, that
the digests the report quotes match `data/archive-manifest.json`, and
that every source row is either imported, dropped or explained.

**Rationale:** A hand-written report is out of date the moment an
import changes, and a report that disagrees with its dataset is worse
than none — it is the artefact that is supposed to make the import
trustworthy. Generating both from the same in-memory rows makes
disagreement impossible rather than unlikely. The summary block exists
so the gate can check the claim rather than the prose.

The report states rules, not just counts: the placeholder rule, the
multiplicity rule for de-duplication, why a wrong label is worse than
an absent one, and that there are no AI ratings. Tests assert those
sentences are present, because a count without its rule cannot be
disputed later.

**M0 is complete.** 446 rows: 305 enriched, 141 backlog, 0 merged from
the load files because all 83 were already present. 210 placeholders
dropped with every ID listed. 0 rows decision-eligible. Verified: the
frozen archive is byte-for-byte unchanged after the whole milestone
(87 files, 143,245,336 bytes), the rebuild is byte-identical, and git
records no write inside `Pre August 2026/`.

**Expect the totals to move.** The report says so in its own text. It
is a record of this pass, not a permanent truth; what should survive is
the rule each count came from.

**Milestone state:** Current is now empty. M1 is ready to promote but
carries three `sign-off` questions — OPEN-USERS-ACCESS,
OPEN-SYSTEM-OF-RECORD and OPEN-DISCOGS-TOKEN — and promoting it is a
maintainer call, not a self-approval. `_meta.md` says so rather than
leaving an unexplained empty milestone.

**Alternatives:** Write the report by hand — rejected, it would drift
from the data on the first re-import. Emit only the summary JSON —
rejected, the report has to be readable by a person deciding whether
to trust the import.

## 2026-08-30 — M0-IMPORT-AI-WORKS: the ratings do not exist, and the track listings had already leaked

**Decision:** Attach the AI columns to the 305 enriched rows tagged
`source: guess` — track listing, track-listing confidence, remarks and
sources. Keep the rating columns in the schema and let them arrive
empty. Reclassify the 28 enriched-sheet track listings that are
byte-identical to the AI output from `legacy` to `guess`.

**Finding 1 — there are no AI ratings.** `Critical Rating` is empty in
all six AI Works files that carry the column, including
`AI_Vinyl_Works_Stage_7 Rating Qualifiers etc.xlsx`. The
AI-invented ratings the brief warns about were never written. This
narrows the item rather than blocking it: what does exist is 305 AI
track listings, their confidence (High/Medium/Low), remarks and
sources. The rating columns stay in the schema and arrive blank, which
is the honest result and leaves M5's valuation pass somewhere to land.

**Finding 2 — the AI track listings had already leaked into the
sourced data.** On all 28 rows where Discogs found nothing, `Track
listing` in `Classical Master` is byte-identical to the AI file's
value; on none of the 277 matched rows is it. That is precisely the
"AI-invented data sits indistinguishably beside sourced data" problem
the brief describes, and it is now measured rather than feared. Those
28 values are reclassified to `guess` — identity with the AI output is
evidence, not inference. Their tell-tale is visible in the prose:
"exact symphony numbers not verified from accessible sources", sitting
in a data column.

**On the v2 override:** v2 `classical Track listings 01.xlsx` was
chosen to win over v1 Stage 8 for track listings. It agrees with Stage
8 on all 305 rows, so the override changed nothing. Recorded because
"we checked and they agree" is a different fact from "we did not
check", and `ai_track_listing_origin` says so per row.

**Rationale for the guess tag:** enforcement is by computation, not
convention. `decision_eligible` is recomputed after the AI pass so a
guessed value cannot make a row eligible by arriving late, and a test
asserts that a guessed value stays ineligible even when the row is
marked confirmed.

**Alternatives:** Discard the AI columns — rejected, the track listings
are a usable starting point and the provenance rule is what makes
keeping them safe. Leave the 28 as `legacy` — rejected, that labels AI
prose as a human entry, which is the exact confusion this item exists
to end.

## 2026-08-30 — M0-MERGE-LOAD-FILES: the 83 rows were already merged, so 0 are new

**Decision:** Merge 0 new rows and record 83 duplicate decisions. The
83 usable rows in `1st load to add.xlsx` and `2nd load to add.xlsx` are
already present in `Classical Remedial`. The reconciled dataset stays
at 446 rows, not 529.

**Rationale:** Two independent methods agree. Positionally, the 83 rows
map in order onto Remedial rows 59-141 — all 83 catalogue strings and
all 46 titles match exactly, with only the IDs differing because the
Remedial sheet renumbered them to 1058+. Separately, the merge's own
key-based de-duplication, which knows nothing about row order, matched
all 83 and merged none. 2nd load occupies Remedial 59-104 and 1st load
105-141.

446 is also what the brief already says: "446 already catalogued". The
~300 new records are the physical backlog that has never been entered,
not these files.

**De-duplication is by key with multiplicity.** Four rows read
`RTL2075 MCPS`, and they are four physical copies rather than one row
counted four times, so a key already present four times absorbs four
incoming rows and no more. A test asserts each of the four matched a
different existing copy. Key matches with disagreeing titles are
treated as ambiguous and kept, per the record — carrying a duplicate a
person can resolve while holding the disc beats merging on a guess.
None occurred.

The key folds case, spacing and the Unicode dashes so `TWO-269` and
`TWO‑269` compare equal. That folding is for comparison only; stored
values stay faithful, because normalising the data itself is M2's job.

**Consequence for M2:** the re-verification run is 446 rows, and the
load files need never be read again.

**Alternatives:** Merge all 83 and de-duplicate later — rejected, it
would put 83 known duplicates into the dataset that M2 would then
re-verify against Discogs at real cost. Match on catalogue number
alone — rejected, it cannot distinguish a genuine second copy from a
re-import, which is exactly what multiplicity handles.

## 2026-08-30 — M0-IMPORT-REMEDIAL: the placeholder rule is mechanical, and every drop is named

**Decision:** A `Classical Remedial` row is a placeholder when it
carries no value in any column other than ID. That rule partitions the
sheet exactly 210 placeholders / 141 real records. The 141 import as
`needs-capture`; the 210 are dropped, and every dropped ID is returned
so the reconciliation report can list them.

**Rationale:** The record allows dropping but not dropping silently.
A rule that needs no judgement can be re-run and disputed later — if
the numbers ever look wrong, the report names the rule and the 210 IDs
it applied to, and anyone can check it against the frozen sheet. The
rule was not chosen to fit a target: it was applied first and produced
210/141, which is what the brief already claimed.

**On provenance:** every value here is `legacy`. None of these rows was
ever matched against Discogs, so no Discogs field exists to carry over,
and a test asserts none appears. `Label` is empty on all 141 — the
"label captured on 0% of the backlog" finding — so the combined string
in `Catalogue #` goes through the splitter: 31 split, 73 bare catalogue
numbers, 37 refused and left with their combined string intact.

**On item ids:** allocation moved out of the importers into
`build-dataset.mjs`, so numbering runs unbroken across batches. Ids are
stable as long as the import order is, and that order is fixed by the
M0 sequence. The composed dataset is DG-0001 to DG-0446 — 305 enriched
plus 141 backlog, which is exactly the brief's "446 already
catalogued".

**Alternatives:** Drop rows lacking a title or catalogue number —
rejected, it would have discarded the 58 rows that carry only a
composer, which are real records. Keep the placeholders as empty rows
to be filled later — rejected, they are 210 unallocated ID slots, not
records; the physical backlog is counted by handling discs, not by
counting blank spreadsheet rows.

## 2026-08-30 — M0-IMPORT-ENRICHED: which columns Discogs wrote, established from the data

**Decision:** Import all 305 rows with per-field `<field>_source`
columns. `Label`, `Discogs ID`, `Discogs URL` and `Discogs ID Score`
are `discogs`; `Musicians` and `Track listing` are `discogs` on the 277
matched rows and `legacy` on the other 28; everything else is `legacy`.
Confirmation is `no` on every row. The existing confidence labels ride
along as `discogs_confidence_legacy` and `discogs_score_legacy` — data
to audit, never provenance.

**Rationale:** Which columns the enrichment actually wrote was measured
rather than assumed. `Label`, `Discogs ID`, `Discogs URL` and
`Discogs ID Score` are populated on exactly the 277 rows where
`Discogs record found?` is Yes and on none of the other 28 — a perfect
correlation, so they are Discogs output. `Musicians` and `Track
listing` are filled on all 305, but 166 of the 277 matched rows carry
Discogs credit-role markers such as "(Orchestra)" and artist
disambiguation such as "(6)", and none of the 28 unmatched rows do, so
that column was overwritten by the same pass. The remaining columns
are filled uniformly across all 305 and therefore predate it.

The legacy confidence labels are carried but never trusted: 236 rows
say "Exact", and 16 of the known-wrong matches are among them. A test
asserts that no confidence label can make a row decision-eligible.

**On `decision_eligible`:** the provenance rule is emitted as a
computed column rather than left to convention, so it can be tested.
It reads `no` on all 305 rows, which is the correct end state for a
pure import — nothing has been confirmed by a person and nothing was
captured off the shelf.

Per-field confirmation state is deliberately not emitted as thirty more
columns all reading `no`. M0 confirms nothing, so one row-level
`confirmed` column states the invariant; M1's D1 schema materialises
real per-value `field_source` rows.

**Alternatives:** Treat every column in the sheet as `discogs` —
rejected, it would misattribute the composer and title a person typed
years ago. Treat the whole sheet as `legacy` — rejected, it would lose
the record of what to re-verify in M2. Trust the confidence labels —
rejected, that is the defect the project exists to fix.

## 2026-08-30 — M0-SPLIT-LABEL-CATNO: labels are recognised, never inferred

**Decision:** Split against a gazetteer of the 98 distinct labels
attested in this collection's own data — the 277 rows of `Classical
Master` where Discogs already supplied a separate Label. A label is
emitted only when an attested name matches and the remainder is a
well-formed catalogue number. Everything else is refused with a named
reason, and refusals route to capture. Three outcomes, not two:
`split`, `bare-catno` (no label present, which is complete rather than
failed) and `refused`.

**Rationale:** The record's rule is that a wrong label is worse than an
absent one, because a wrong label corroborates a wrong match — the
exact failure that put 26 of 277 existing matches on the wrong record.
A pattern-based splitter would have to decide whether `Harmony` in
`CBS Harmony 30001` is a sub-label or part of the catalogue number, and
it would be guessing. Deriving the vocabulary from the data replaces
that guess with evidence, and makes the refusals principled: `Decca Ace
of Diamonds SDD 538` is refused because this collection has never
attested `Ace of Diamonds`, not because a regex failed.

Two-character labels are excluded from the gazetteer. `PS` is an
attested label and also the prefix of `PS 287` and `PS5032`; keeping it
would split real catalogue numbers in half.

**Result on the 141 backlog rows:** 31 split, 73 bare catalogue numbers
with no label present, 37 refused — 18 unattested sub-labels, 11
unattested label prefixes, 7 cells holding two pressings, 1 unrecognised
parenthetical. All 31 splits were checked by eye and are correct,
including `EMI Eminence` beating `EMI` on longest match. Label casing
is normalised to the attested form, so `Vox` becomes `VOX`.

Nothing is discarded: every result keeps `combinedRaw`, so a refusal
loses no data and a later pass with a larger gazetteer can re-split it.

**Alternatives:** Pattern-only splitting — rejected, it cannot tell a
sub-label from a catalogue prefix, and would emit exactly the confident
wrong labels this project exists to stop. Accepting a parent label when
the sub-label is unattested — rejected for the same reason: `Decca` is
a label that pressing does not carry. Compound matching of two adjacent
attested labels — rejected, it would gain 2 rows and would also merge
`Columbia/CBS`, which is genuinely two labels.

## 2026-08-30 — M0-REPAIR-ENCODING: two corruptions, one confirmed as MacRoman

**Decision:** Repair in two separate passes. Byte-level: decode
`classical vinyl list in progress.csv` with MacRoman rather than
UTF-8. String-level: undo "UTF-8 bytes decoded as MacRoman" inside the
workbooks by re-encoding to MacRoman and decoding as strict UTF-8,
accepting the result only when the whole string decodes cleanly.
U+00A0 folds to a space rather than being deleted; zero-width
characters are deleted; newlines survive.

**Rationale:** The byte histogram settles the diagnosis rather than
assuming it — 0xCA x68, 0xD0 x57, 0x8E x19 read as NBSP, en dash and
e-acute under MacRoman, and as unassigned, Eth and E-circumflex under
cp1252. The record predicted cp1252 would produce different wrong
answers; it does, and there is now a test asserting it.

Strictness is the safety property. A repair that accepts partial
decodes would rewrite legitimate text: `Side A • Side B` and
`√2 is irrational` contain the exact characters MacRoman mojibake
produces. Requiring that the entire string decode as valid UTF-8, and
that it contain a UTF-8 lead byte at all, leaves both untouched — both
are negative controls in the suite.

U+00A0 folds to a space because in `CBS Harmony 30001` it separates
the label from the catalogue number. Deleting it welds two tokens
together and defeats the exact match this whole item exists to enable.
Newlines survive because track listings are multi-line and M3 reads
them per track.

**Scale:** 331 distinct strings repaired across the frozen inputs —
324 invisible-character fixes and 7 mojibake fixes. All 7 are in the
`Label (and Catalog #)` column of the load files, which is the field
the corroboration gate depends on.

**Alternatives:** cp1252 — rejected on the evidence above. A
character-by-character substitution table — rejected, it cannot tell
a real bullet from half a mojibake pair, which is precisely the
distinction that matters. Normalising U+2011 to ASCII hyphen here —
rejected as out of scope: M0 repairs faithfully, M2 normalises, and
conflating the two hides the original bytes. Noted on M2-MATCHER
instead.

## 2026-08-30 — M0-ARCHIVE-FREEZE: freeze 87 sources, not 9,285 files

**Decision:** The frozen manifest covers the 87 files that are
actually source data. `.venv/`, `__pycache__/` and nested `.git/`
are excluded by declared pattern, each with its reason recorded in
the manifest itself. Digests are sha256 over bytes; mtime is
deliberately not recorded. The archived Discogs token is listed by
path and size with its digest written as `REDACTED-SECRET`.

**Rationale:** `Pre August 2026/` holds 9,285 files, of which 9,106
are a Python virtualenv belonging to the old Windsurf CLI. Hashing
them exceeded two minutes and froze nothing of value — a venv is
reproducible from `pyproject.toml` and is not an input to any
import. Scoped to real sources the manifest builds in 0.5 s, which
makes `--check` cheap enough to run as a gate rather than a ritual.
mtime is omitted because this tree lives on OneDrive and sync
rewrites timestamps, so recording them would make `--check` fail for
reasons unrelated to the bytes. The token digest is redacted because
the manifest is committed, and a hash of a live credential does not
belong in git history.

**Alternatives:** Hash everything — rejected, minutes of work to
freeze artefacts that no import reads. Exclude silently — rejected,
an undeclared exclusion is indistinguishable from a bug; the
manifest carries `excluded` and `redacted` lists so what is absent
is auditable.

## 2026-08-28 — DATA-MODEL: four linked records, not a flat row

**Decision:** Model `item` (a disc you own), `release` (a Discogs
pressing), `performance` (a reading) and `work` (the music) as four
linked entities rather than one row per record.

**Rationale:** The existing spreadsheets cannot answer "how many
copies of this symphony do I own, and which is best?" because a flat
row conflates all four. The keep/sell decision belongs to the item;
identity belongs to the release; `work` is what you group by to find
clusters; `performance` is what you compare and what a verdict
attaches to. A conductor field on a flat row does the first two badly
and the last not at all. This conflation is the direct cause of nine
schema generations and five restarts.

**Alternatives:** Keep a flat row with more columns — rejected, it is
the thing that failed. Group by conductor string — rejected, it cannot
distinguish two recordings by the same conductor.

## 2026-08-28 — PROVENANCE: every sourced value carries its origin

**Decision:** Every sourced value carries a `field_source` row naming
its origin (shelf, discogs, musicbrainz, legacy, guess) and its
confirmation state. Values sourced `guess` or `legacy`, and
unconfirmed `discogs` values, may be displayed anywhere but may never
feed a cluster, a coverage check, a sell list or a shortlist until a
person confirms them. Enforced in the query layer, not by convention.

**Rationale:** AI-invented ratings and track listings currently sit in
the same cells as sourced data, indistinguishable. This is the single
rule that lets the AI Works columns be imported safely instead of
discarded, and the rule that stops the current mess recurring.
Convention will not hold it — the query layer will.

**Alternatives:** Discard the AI columns entirely — rejected, some of
it is useful as a starting point. Trust-by-column — rejected, the
corruption is per-cell.

## 2026-08-28 — MATCH-GATE: a catalogue number is a lead, never a verdict

**Decision:** Auto-accept a Discogs match only when score >= 80, at
least two independent signal families agree, and the margin over the
runner-up is >= 25. Reject junk catalogue input before any API call.
Persist the top five candidates and the exact queries used.

**Rationale:** 26 of 277 existing matches point at a different record
and 16 of those are labelled "Exact", because today's rule is `catno
exact → accept`. Catalogue numbers are unique per label, not globally.
The margin test kills the collisions where four records all matched
one release with nothing to separate them.

**Alternatives:** Raise the string-similarity threshold — rejected,
confidence must derive from evidence, not string equality.

## 2026-08-28 — STACK: Cloudflare Pages plus one Worker

**Decision:** Static SPA on Cloudflare Pages building from the GitHub
repo, with a Hono Worker holding the Discogs token, proxying and
rate-limiting both APIs, and running jobs. D1 for data, KV for cache,
R2 for photos, Access for sign-in.

**Rationale:** Two constraints rule out a pure static site: the
Discogs API sends no CORS headers, and a static site cannot hold a
secret. One small server-side component solves both and additionally
enforces one shared rate limit, so two people cataloguing at once
cannot throttle the account.

**Alternatives:** Supabase — reasonable, but free projects pause after
about a week of inactivity, which is wrong for a stop-start project.
Pure static site — impossible, see above.

## 2026-08-28 — REUSE-CLI: port the Windsurf Python matcher, don't rewrite

**Decision:** Port the existing CLI's normalisation ladder, query
permutations, rate limiting and resumable output into the Worker.
Three changes only: MacRoman instead of cp1252, the input sanity
check, and the corroboration gate.

**Rationale:** That logic is already proven against this exact data.
Rewriting it would discard the one component with a track record and
reintroduce bugs already found.

**Alternatives:** Fresh implementation — rejected, no upside.
