---
id: M1-CAPTURE-UI
name: Photo-first offline capture screen
summary: The PWA capture form that works with no signal in a loft — photo first, six fields, queued in IndexedDB, surviving a hard refresh.
status: todo
milestone: current
order: 3
---
# Photo-first offline capture screen

Build **photo-first** before type-at-shelf: walk a crate
photographing labels, type nothing, transcribe later at a desk. It is
faster per disc and it is delegable.

Six fields per brief section 04 — label photo, catalogue number,
label, one name, crate + position, condition ×2 — with matrix/runout
optional. **Label and catalogue number are separate inputs, never one
combined field**; merging them is what caused the 9% error rate M0
just measured.

Offline is a hard requirement, not a nicety. Entries queue in
IndexedDB, the UI never blocks on the network, and a queued entry
survives a hard refresh.

**Done when** a record can be captured on a phone with no signal and
appears in the collection afterwards, with median entry under 30
seconds — measured, not estimated.
