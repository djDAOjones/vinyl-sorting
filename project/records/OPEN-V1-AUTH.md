---
id: OPEN-V1-AUTH
name: Does v1 get sign-in, now that the token is behind a public endpoint?
summary: The brief defers auth but commits to revisiting it before M2 puts the Discogs token behind a public endpoint — which has now happened, so the revisit is due on the brief's own terms.
status: open
date: 2026-08-31
milestone: icebox
order: 3
flags: sign-off
---
# Does v1 get sign-in?

No sign-in was decided deliberately on 2026-08-30, and the brief adds a
condition: auth "is revisited before M2 puts the Discogs token behind a
public endpoint". M2 is deployed and the cron matcher is spending that
token, so the condition has been met and the revisit is owed.

What is actually exposed today: `POST /api/captures` and the photo
upload accept anonymous writes, and the repo is public with the live
URL in the README's first ten lines. The Worker exposes named
operations rather than an open proxy, and nothing returns the token —
so the exposure is junk rows and R2 objects, not a leaked credential.

DATASET-EDIT bolts a shared passphrase onto the edit endpoints, because
rewriting 465 catalogued records is a different risk from adding one.
It is deliberately not an answer to this: capture stays open, so the
offline queue on a phone never acquires a way to fail.

The options, roughly: leave it, on the grounds that a household tool
behind an obscure URL is adequately private; extend the shared secret
to every write; or put Cloudflare Access in front of the whole thing
and accept that captures then need a signed-in phone.

Trigger: met already. Take it whenever the passphrase in DATASET-EDIT
starts feeling like the wrong shape.

**Maintainer decision required.**
