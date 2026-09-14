---
id: CAPTURE-PHOTO-VERIFY
name: Verify saved photo bytes and complete server photo receipts
summary: Check stored photos before clearing capture, isolate unreadable queued images, and require all expected server attachments before confirming upload.
status: in-progress
milestone: current
flags:
blocked-on:
date: 2026-09-14
order: 1
---
# Capture photo verification

User asks to harden capture and make issues clear. Preserve the existing
queue identity and payload format; no store/schema changes or dependencies.
New photos are copied into independent bytes, hashed, stored and read back
before current camera images are cleared. Retry the same unsafely saved
draft with the same client ID. Failed writes/checks keep photos on screen.

Upload preflight checks photo bytes before rewriting any queued entry;
unreadable entries remain untouched and visible while healthy entries can
continue. A valid item-number receipt is insufficient: verify the server
record and all expected photo attachments, keeping partial receipts retryable.
Do not change server records to repair an incomplete receipt automatically.

Check corrupt/missing read-back, stable draft retries, old queue compatibility,
later corruption, healthy-entry progress, partial receipts and failure UI.
Actual archive imports are owned by the other task; no import writes here.
