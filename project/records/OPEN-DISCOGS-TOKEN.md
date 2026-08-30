---
id: OPEN-DISCOGS-TOKEN
name: Is the existing Discogs token live, and is the account a seller?
summary: The token in Pre August 2026/Windsurf Projects/ has not been opened; seller status affects which price data is reachable and therefore what the sell list and shortlist ranking can use.
status: open
date: 2026-08-30
milestone: next
order: 2
flags: sign-off, security
---
# Is the existing Discogs token live, and is the account a seller?

Two questions, one file. Whether the token still authenticates, and
whether the account carries seller status — the latter decides which
price data is reachable, which feeds `pressing_score`'s value
percentile and the sell list.

Handling note: the token is a secret. It goes into the Worker via
`wrangler secret`, never into the repo, and never gets pasted into a
prompt or echoed to a terminal.

**Maintainer decision required.**
