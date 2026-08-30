---
id: M0-REPAIR-ENCODING
name: Repair MacRoman mojibake and invisible whitespace
summary: Text corruption in the source data is MacRoman mis-decoding, not cp1252; repair it and strip U+00A0 and zero-width characters before any field is parsed.
status: todo
milestone: current
order: 2
---
# Repair MacRoman mojibake and invisible whitespace

Diagnosed against the real data: the corruption is **MacRoman**
mis-decoding. Applying a cp1252 repair — the obvious guess — produces
different wrong answers, so this is worth a test with fixture strings
taken from the actual sheet.

Also strip U+00A0 (non-breaking space) and zero-width characters,
which otherwise survive into catalogue numbers and defeat exact match.

**Done when** repaired strings round-trip a fixture set drawn from the
frozen inputs.
