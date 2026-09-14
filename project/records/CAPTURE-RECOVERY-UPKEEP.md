---
id: CAPTURE-RECOVERY-UPKEEP
name: Retire temporary capture diagnostics and review local retention
summary: After incident recovery is verified, remove temporary detailed tracing and agree when confirmed local copies may be pruned again.
status: todo
milestone: next
flags: blocked, sign-off
blocked-on: Verified incident recovery and maintainer approval of retention cleanup
date: 2026-09-14
order: 1
---
# Recovery upkeep

The user allows extensive diagnostics temporarily. After
CAPTURE-INCIDENT-DIAGNOSIS is resolved, remove temporary request tracing and
review whether detailed per-entry diagnostics remain useful. Keep the
portable backup facility and clear upload receipt status.

Browser sync currently retains all confirmed records/photos to preserve
recovery options. Do not restore pruning until recovery/backups are verified
and the maintainer authorises removal of those local copies. Explain the
storage cost of continued retention at that point; never delete unsent data.

The separate photo-addition queue also retains confirmed images. Apply the
same approval boundary to it; rescue exports include target item IDs and
use version 3 for mixed capture/addition backups. Restore additions to their
existing target rather than importing them as new captures.
