---
id: OPEN-SYSTEM-OF-RECORD
name: Is the app database the system of record, or does OneDrive stay authoritative?
summary: The brief assumes the app database is authoritative with a nightly CSV export to OneDrive; confirming this decides whether import is one-way and whether CSV export is a convenience or a contract.
status: open
date: 2026-08-30
milestone: next
order: 4
flags: sign-off
---
# Is the app database the system of record?

The brief assumes: **app database authoritative, nightly CSV export to
OneDrive.** Worth confirming explicitly, because the alternative
changes the shape of the build — if OneDrive stays authoritative, the
import is no longer one-way and round-tripping becomes a first-class
problem.

Given the history of nine schema generations across spreadsheets, the
assumed answer looks right. Confirm it rather than inherit it.

**Maintainer decision required.**
