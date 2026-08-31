---
id: AI-ROUND-TRIP
name: Make the hand-carried reading loop fast, and make it say which photograph it read
summary: The maintainer kept the no-metered-services rule, so the answer is a better round trip rather than an API — and its biggest missing field is provenance, because a number off a disc label and one in sleeve small print arrive with identical standing.
status: open
date: 2026-08-31
milestone: next
order: 3
---
# The hand-carried loop

Maintainer ruling, 2026-08-31: **keep it manual, make it smooth.**

Worth writing down why, because it will be asked again. There is no
supported API behind a Claude or ChatGPT subscription — "use the
subscription I already pay for" is not available at any price. The real
options were a metered key (refused since 2026-08-30, and the premise
of OPS-SPEND-GUARD), Cloudflare's free Workers AI allocation, or a
local model. The maintainer took none of them: the loop stays a person
moving a pack into a chat they already have, and the investment goes
into the loop instead.

## 1. Which photograph each value came from — the strongest one

Today every field in a reply arrives with the same standing. But a
catalogue number read off a **disc label** is strong evidence, and the
same number read out of **sleeve small print** is weak — that is the
entire lesson of the 467-483 crate, and the model's answer format
cannot express it.

The evidence for how badly it is needed: **seventeen confident readings
with zero fields marked unreadable.** The refusal-versus-wrong
distinction `photo-score.mjs` was built around went completely unused,
which means the reply format is not asking a question the model can
answer honestly.

**The plumbing already exists.** Packs send per-record filenames, so a
reply can carry `source` per field with nothing new to build. Then
`raw_value` records it, the browse screen shows it, and 480, 481 and
473 would have sorted themselves out.

Cheapest first, and it is also the one that makes everything else
worth more.

## 2. `other_numbers`, into the matcher

Split into [[MATCH-OTHER-NUMBERS]] — it is a matcher change, not a
pack change, and it is ready to do now.

## 3. The loop itself

Bigger packs, so a sitting reads a crate rather than a handful. A
prompt that asks for the source photograph and for an explicit
"unreadable" rather than accepting a guess. Import that reports what
changed rather than only that it worked. And a screen that says which
photographs are still unread, so the next pack builds itself.

**Done when** a reading carries a source photograph per field, the
score separates refusals from errors on real data, and building the
next pack is one command with no arguments to remember.
