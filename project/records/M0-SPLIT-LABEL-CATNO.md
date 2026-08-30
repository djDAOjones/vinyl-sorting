---
id: M0-SPLIT-LABEL-CATNO
name: Split combined label and catalogue strings
summary: Label is captured on 0% of the backlog because it was mashed into one free-text field with the catalogue number; split them into first-class separate fields.
status: todo
milestone: current
order: 3
---
# Split combined label and catalogue strings

The missing label is the direct cause of the 9% error rate — it is the
corroborating signal that would have refused the bad matches. Splitting
it out of the combined string is what makes M2's corroboration gate
possible at all.

Where a string cannot be split confidently, leave label empty and
route the row to capture rather than guessing. A wrong label is worse
than an absent one: it corroborates a wrong match.

**Done when** every imported row has `catno_raw` and `label_raw` as
separate values, and unsplittable rows are counted in the report.
