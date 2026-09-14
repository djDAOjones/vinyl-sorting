import { allEntries } from './queue.ts';
import { backupParts, buildQueueBackup } from './queue-backup.ts';
import { queueHealth, type QueuedCapture } from './queue-logic.ts';
import { drain, syncError } from './sync.ts';
import { readTrace, RECOVERY_BUILD, trace } from './sync-debug.ts';
import { esc } from './chrome.ts';
const app = document.getElementById('app')!;
let snapshot: QueuedCapture[] = [], parts: QueuedCapture[][] = [];
let prepared: File | null = null, objectUrl: string | null = null;
let exporting = false, uploadStarted = false, uploadBusy = false;
let connection = 'Not checked. This test reads the server; only upload receipts prove that records were written.';
let storage = 'Not checked';
const mb = (bytes: number) => bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const message = (text: string) => { document.getElementById('message')!.textContent = text; };
function saveLink() {
  if (!prepared || !objectUrl) return;
  const a = document.createElement('a'); a.href = objectUrl; a.download = prepared.name;
  document.body.appendChild(a); a.click(); a.remove();
  message('Backup download requested. Check Files / Downloads and confirm the ZIP is there before moving on. The phone queue is unchanged.');
}
async function refresh() {
  try {
    const entries = await allEntries(), h = queueHealth(entries, Date.now(), navigator.onLine);
    const photos = entries.reduce((n, e) => n + e.photos.length, 0);
    const bytes = entries.reduce((n, e) => n + e.photos.reduce((s, p) => s + p.blob.size, 0), 0);
    document.getElementById('queueSummary')!.textContent = `${entries.length} saved entries · ${photos} photos · ${mb(bytes)}. ${h.title}.`;
    const locks = await navigator.locks?.query().catch(() => undefined);
    const details = [
      `Build: ${RECOVERY_BUILD}`, `App: ${location.href}`, `Checked: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`, `Online: ${navigator.onLine}; visible: ${!document.hidden}; standalone: ${matchMedia('(display-mode: standalone)').matches}`,
      `Service worker: ${navigator.serviceWorker?.controller?.scriptURL ?? 'none'}`,
      `Storage: ${storage}`, `Upload mode on this screen: ${uploadStarted ? 'started by user' : 'not started'}`,
      `Web locks: ${JSON.stringify(locks ?? 'not available')}`, `Connection: ${connection}`,
      `Queue: ${entries.length} entries, ${h.outstanding} unconfirmed, ${photos} photos, ${bytes} bytes`,
      `Last confirmed: ${h.lastConfirmed ? new Date(h.lastConfirmed).toISOString() : 'not available'}`,
      `Queue error: ${syncError() ?? h.lastError ?? 'none'}`, '', 'ENTRIES (local metadata; no photo content)',
      ...entries.map(e => JSON.stringify({ clientId: e.clientId, state: e.state, createdAt: e.createdAt,
        attempts: e.attempts, nextAttemptAt: e.nextAttemptAt, lastError: e.lastError,
        serverItemId: e.serverItemId, syncedAt: e.syncedAt,
        photos: e.photos.map(p => ({ key: p.key, kind: p.kind, bytes: p.blob.size, type: p.blob.type })) })),
      '', 'RECENT REQUEST EVENTS', ...readTrace(),
    ].join('\n');
    const field = document.getElementById('diagnostics') as HTMLTextAreaElement;
    if (document.activeElement !== field) field.value = details;
  } catch (err) { message(`Could not read the saved queue: ${String(err)}. Keep this app and its website data. Do not reinstall.`); }
}
async function upload(forceRetry = false) {
  if (uploadBusy || exporting) return;
  uploadBusy = true; trace('Recovery upload requested by user');
  try { const result = await drain(Date.now(), forceRetry); message(`Upload pass: ${result.sent} confirmed, ${result.failed} failed. ${syncError() ?? 'See diagnostics for details. Confirmed entries are retained on this device.'}`); }
  catch (err) { trace(`Recovery upload could not start: ${String(err)}`); message(String(err)); }
  finally { uploadBusy = false; await refresh(); }
}
async function boot() {
  snapshot = await allEntries(); parts = backupParts(snapshot);
  app.innerHTML = `<a href="/">← Home</a><h1>Save queued work</h1>
    <div class="notice"><strong id="queueSummary">Reading saved entries…</strong>
    <p>This screen does not start uploads until you ask. Save a backup first. Keep this same app open and do not clear website data or reinstall it.</p></div>
    <h2>1. Save the records and photos</h2>
    <p>Prepare each part, then save it to Files / Downloads or share it to your computer. Keep every part. Nothing is removed from this device.</p>
    <div id="parts">${parts.map((group, i) => `<div class="backup-part"><span>Part ${i + 1} of ${parts.length}: ${group.length} entries, ${group.reduce((n, e) => n + e.photos.length, 0)} photos, ${mb(group.reduce((n, e) => n + e.photos.reduce((s, p) => s + p.blob.size, 0), 0))}</span><button class="btn btn-ghost" data-part="${i}">Prepare part ${i + 1}</button></div>`).join('') || '<p>No saved entries were found in this browser. If another app shows a queue, return to that app; this is not proof that its work is lost.</p>'}</div>
    <div id="prepared" hidden><strong id="filename"></strong><p>Prepared on this device. Save this file and check it exists before preparing the next part.</p><button class="btn btn-primary" id="share">Save / share ZIP</button> <button class="btn btn-ghost" id="download">Download ZIP</button></div>
    <p id="message" role="status" aria-live="polite"></p>
    <h2>2. Diagnose and resume uploads</h2><p>Keep the app visible and the phone online while uploading. The count falls only after server confirmation. Confirmed entries are temporarily retained locally.</p>
    <button class="btn btn-ghost" id="check">Check connection</button> <button class="btn btn-primary" id="upload">Start / resume uploads</button>
    <h2>Temporary diagnostics</h2><p>This includes local entry IDs, photo sizes and upload errors. It contains no photo content. Copy it here when troubleshooting.</p>
    <button class="btn btn-ghost" id="copy">Copy diagnostics</button> <button class="btn btn-ghost" id="refresh">Refresh diagnostics</button>
    <textarea id="diagnostics" readonly aria-label="Upload diagnostics"></textarea><p>Build: ${esc(RECOVERY_BUILD)}</p>`;
  app.addEventListener('click', async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!target) return;
    try {
      if (target.dataset.part !== undefined) {
        if (exporting) return; exporting = true;
        app.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(b => { b.disabled = true; });
        document.getElementById('prepared')!.hidden = true;
        const row = target.closest('.backup-part'), panel = document.getElementById('prepared')!;
        if (row?.parentNode) {
          row.parentNode.insertBefore(panel, row.nextSibling);
          row.parentNode.insertBefore(document.getElementById('message')!, panel.nextSibling);
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl); prepared = null; objectUrl = null;
        const index = Number(target.dataset.part), group = parts[index]!;
        message(`Preparing part ${index + 1}. Keep this screen open…`);
        try {
          const zip = await buildQueueBackup(group, { part: index + 1, totalParts: parts.length, origin: location.origin,
            progress: (done, total) => message(`Preparing part ${index + 1}: checked ${done} of ${total} photos…`) });
          prepared = new File([zip], `vinyl-queue-${new Date().toISOString().slice(0, 10)}-part-${index + 1}-of-${parts.length}.zip`, { type: 'application/zip' });
          objectUrl = URL.createObjectURL(prepared); document.getElementById('filename')!.textContent = `${prepared.name} (${mb(prepared.size)})`;
          document.getElementById('prepared')!.hidden = false; message('Backup prepared. Now save the ZIP and check it exists in Files / Downloads.');
          panel.scrollIntoView({ block: 'nearest' });
          trace(`Backup part ${index + 1}/${parts.length} prepared: ${group.length} records, ${zip.size} bytes`);
        } finally { exporting = false; app.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(b => { b.disabled = false; }); }
      }
      if (target.id === 'share' && prepared) {
        if (navigator.canShare?.({ files: [prepared] })) {
          await navigator.share({ files: [prepared], title: 'Vinyl queue backup' });
          message('Share sheet completed. Check the saved ZIP in Files or on the receiving computer before continuing.');
        } else saveLink();
      }
      if (target.id === 'download') saveLink();
      if (target.id === 'copy') {
        const field = document.getElementById('diagnostics') as HTMLTextAreaElement;
        try { await navigator.clipboard.writeText(field.value); message('Diagnostics copied.'); }
        catch { field.focus(); field.select(); message('Select and copy the diagnostics below.'); }
      }
      if (target.id === 'refresh') await refresh();
      if (target.id === 'check') {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
        try { const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
          const body = await response.text(); let valid = false;
          try { valid = JSON.parse(body)?.ok === true; } catch { /* report malformed response */ }
          connection = `HTTP ${response.status}; valid health reply: ${valid}; ${body.slice(0, 200)}. Read check only.`;
        } catch (err) { connection = `Read check failed: ${String(err)}`; }
        finally { clearTimeout(timer); trace(connection); message(connection); await refresh(); }
      }
      if (target.id === 'upload') {
        if (exporting) return message('Finish preparing this backup part first.');
        if (!uploadStarted) { uploadStarted = true; setInterval(() => { void upload(); }, 30000); }
        await upload(true);
      }
    } catch (err) { message(`Action did not complete: ${String(err)}. The source queue has not been deleted.`); trace(String(err)); }
  });
  try { const estimate = await navigator.storage?.estimate(); const persistent = await navigator.storage?.persisted?.();
    storage = `${JSON.stringify(estimate ?? 'unavailable')}; persistent: ${persistent ?? 'unavailable'}`;
  } catch (err) { storage = String(err); }
  addEventListener('online', () => { trace('Browser online'); void refresh(); });
  addEventListener('offline', () => { trace('Browser offline'); void refresh(); });
  trace('Recovery screen opened; uploads not started'); await refresh();
  setInterval(() => { void refresh(); }, 5000);
}
void boot().catch(err => { app.textContent = `Cannot read this device queue: ${String(err)}. Keep website data intact and return to the app that shows the waiting entries.`; });
