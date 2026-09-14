import { allEntries, getEntry } from './queue.ts';
import { backupParts, buildQueueBackupReport, queueMetadata } from './queue-backup.ts';
import { queueHealth, type QueuedCapture } from './queue-logic.ts';
import { drain, syncError } from './sync.ts';
import { readTrace, RECOVERY_BUILD, trace } from './sync-debug.ts';
import { esc } from './chrome.ts';
import { readStoredPhoto } from './photo-read.ts';
const app = document.getElementById('app')!;
let snapshot: QueuedCapture[] = [], parts: QueuedCapture[][] = [], smallParts: QueuedCapture[][] = [];
let prepared: File | null = null, objectUrl: string | null = null;
let exporting = false, uploadStarted = false, uploadBusy = false;
let connection = 'Not checked. This test reads the server; only upload receipts prove that records were written.';
let storage = 'Not checked';
let backupReport = 'No backup prepared in this session.';
let artifactDescription = '';
let artifactSequence = 0;
const mb = (bytes: number) => bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const message = (text: string) => { document.getElementById('message')!.textContent = text; };
function saveLink() {
  if (!prepared || !objectUrl) return;
  const a = document.createElement('a'); a.href = objectUrl; a.download = prepared.name;
  document.body.appendChild(a); a.click(); a.remove();
  message(`${artifactDescription} Download requested. Check the file in Files / Downloads. The phone queue is unchanged.`);
}
async function refresh() {
  if (exporting) return;
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
      `Queue error: ${syncError() ?? h.lastError ?? 'none'}`, `BACKUP REPORT: ${backupReport}`, '', 'ENTRIES (local metadata; no photo content)',
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
  snapshot = await allEntries(); parts = backupParts(snapshot); smallParts = backupParts(snapshot, 8 * 1024 * 1024);
  app.innerHTML = `<a href="/">← Home</a><h1>Save queued work</h1>
    <div class="notice"><strong id="queueSummary">Reading saved entries…</strong>
    <p>This screen does not start uploads until you ask. Save a backup first. Keep this same app open and do not clear website data or reinstall it.</p></div>
    <h2>1. Save all record details first</h2>
    <p>This small JSON file saves every record’s fields, IDs and photo references. It does not contain the photos and does not need to read them.</p>
    <button class="btn btn-primary" id="metadata">Prepare all record details</button>
    <h2>2. Rescue the photos</h2>
    <p>The main parts keep the original grouping while this queue is unchanged. Retry the parts that failed and keep your earlier ZIP files. Each photo is checked; unreadable photos are listed in an INCOMPLETE backup.</p>
    <p>Prepare each part, then save it to Files / Downloads or share it to your computer. Keep every part. Nothing is removed from this device.</p>
    <div id="parts">${parts.map((group, i) => `<div class="backup-part"><span>Part ${i + 1} of ${parts.length}: ${group.length} entries, ${group.reduce((n, e) => n + e.photos.length, 0)} photos, ${mb(group.reduce((n, e) => n + e.photos.reduce((s, p) => s + p.blob.size, 0), 0))}</span><button class="btn btn-ghost" data-part="${i}">Prepare part ${i + 1}</button></div>`).join('') || '<p>No saved entries were found in this browser. If another app shows a queue, return to that app; this is not proof that its work is lost.</p>'}</div>
    <details><summary>Try smaller rescue parts</summary><p>These have separate numbering and target 8 MB each.</p>${smallParts.map((group, i) => `<div class="backup-part"><span>Small part ${i + 1} of ${smallParts.length}: ${group.length} entries</span><button class="btn btn-ghost" data-small="${i}">Prepare small part ${i + 1}</button></div>`).join('')}</details>
    <details><summary>Rescue one record at a time</summary><p>Use these if a part still cannot be prepared.</p>${snapshot.map((e, i) => `<div class="backup-part"><span>Record ${i + 1}: ${esc(e.clientId)} · ${e.photos.length} photos</span><button class="btn btn-ghost" data-record="${i}">Prepare record ${i + 1}</button></div>`).join('')}</details>
    <div id="prepared" hidden><strong id="filename"></strong><p id="artifactSummary"></p><p>Save this file and check it exists before preparing the next one.</p><button class="btn btn-primary" id="share">Save / share file</button> <button class="btn btn-ghost" id="download">Download file</button><p><button class="btn btn-ghost" id="finish">I’ve saved this file</button></p></div>
    <p id="message" role="status" aria-live="polite"></p>
    <h2>3. Diagnose and resume uploads</h2><p>Keep the app visible and the phone online while uploading. The count falls only after server confirmation. Confirmed entries are temporarily retained locally.</p>
    <button class="btn btn-ghost" id="check">Check connection</button> <button class="btn btn-primary" id="upload">Start / resume uploads</button>
    <h2>Temporary diagnostics</h2><p>This includes local entry IDs, photo sizes and upload errors. It contains no photo content. Copy it here when troubleshooting.</p>
    <button class="btn btn-ghost" id="copy">Copy diagnostics</button> <button class="btn btn-ghost" id="refresh">Refresh diagnostics</button>
    <textarea id="diagnostics" readonly aria-label="Upload diagnostics"></textarea><p>Build: ${esc(RECOVERY_BUILD)}</p>`;
  app.addEventListener('click', async (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!target) return;
    let stage = `control ${target.id || target.textContent}`;
    try {
      if (target.dataset.part !== undefined || target.dataset.small !== undefined || target.dataset.record !== undefined || target.id === 'metadata') {
        if (exporting || prepared) return; exporting = true;
        app.querySelectorAll<HTMLButtonElement>('[data-part], [data-small], [data-record], #metadata').forEach(b => { b.disabled = true; });
        document.getElementById('prepared')!.hidden = true;
        stage = 'position backup controls';
        const row = target.closest('.backup-part') ?? target, panel = document.getElementById('prepared')!;
        if (row.parentNode) {
          row.parentNode.insertBefore(panel, row.nextSibling);
          row.parentNode.insertBefore(document.getElementById('message')!, panel.nextSibling);
        }
        // Only the explicit saved-file acknowledgement releases a prior URL.
        // Keep one independent prepared file at a time to bound phone memory.
        prepared = null; objectUrl = null;
        const single = target.dataset.record !== undefined, small = target.dataset.small !== undefined;
        const groups = small ? smallParts : parts;
        const index = Number(single ? target.dataset.record : small ? target.dataset.small : target.dataset.part);
        message('Reading saved record details…');
        try {
          stage = 'read fresh record metadata';
          let bytes: Blob, suffix: string;
          if (target.id === 'metadata') {
            const rows = await allEntries();
            bytes = new Blob([queueMetadata(rows, location.origin)], { type: 'application/json' });
            suffix = 'ALL-RECORD-DETAILS.json';
            artifactDescription = `${rows.length} record details prepared. METADATA ONLY — photo bytes are not included.`;
            backupReport = artifactDescription;
          } else {
            const originals = single ? [snapshot[index]!] : groups[index]!;
            // Fresh reads avoid keeping every photo handle from page load through share-sheet trips.
            const group = await Promise.all(originals.map(async e => await getEntry(e.clientId) ?? e));
            stage = 'read and verify photos';
            const result = await buildQueueBackupReport(group, {
              part: single ? 1 : index + 1, totalParts: single ? 1 : groups.length,
              origin: location.origin, allowPartial: true, readPhoto: readStoredPhoto,
              progress: (done, total) => message(`Checked ${done} of ${total} photos. Keep this screen open…`),
              onIssue: issue => { trace(`BACKUP MISSING ${JSON.stringify(issue)}`); },
            });
            bytes = result.blob;
            const status = result.issues.length ? 'INCOMPLETE' : 'COMPLETE';
            suffix = `${single ? `record-${index + 1}` : `${small ? 'small-' : ''}part-${index + 1}-of-${groups.length}`}-${status}.zip`;
            artifactDescription = `${status}: ${group.length} record details, ${result.includedPhotoCount} of ${result.sourcePhotoCount} photos included.${result.issues.length ? ` ${result.issues.length} photos could not be read. Keep this rescue file; it is not a complete backup.` : ''}`;
            backupReport = `${artifactDescription}\n${result.issues.map(i => `Record ${i.clientId}, photo ${i.photoIndex}, key ${i.key}: ${i.error}`).join('\n')}`;
          }
          stage = 'create independent download file';
          prepared = new File([bytes], `vinyl-rescue-v2-${new Date().toISOString().replace(/[:.]/g, '-')}-${++artifactSequence}-${suffix}`, { type: bytes.type });
          objectUrl = URL.createObjectURL(prepared);
          document.getElementById('filename')!.textContent = `${prepared.name} (${mb(prepared.size)})`;
          document.getElementById('artifactSummary')!.textContent = artifactDescription;
          document.getElementById('prepared')!.hidden = false;
          message(`${artifactDescription} Now save the file and check it exists in Files / Downloads.`);
          panel.scrollIntoView({ block: 'nearest' });
          trace(artifactDescription); await refresh();
        } finally { exporting = false; app.querySelectorAll<HTMLButtonElement>('[data-part], [data-small], [data-record], #metadata').forEach(b => { b.disabled = prepared !== null; }); await refresh(); }
      }
      if (target.id === 'finish' && prepared) {
        trace(`User acknowledged saving ${prepared.name}`);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null; prepared = null; document.getElementById('prepared')!.hidden = true;
        app.querySelectorAll<HTMLButtonElement>('[data-part], [data-small], [data-record], #metadata').forEach(b => { b.disabled = false; });
        message('Keep the saved file. You can now prepare the next one.');
      }
      if (target.id === 'share' && prepared) {
        if (navigator.canShare?.({ files: [prepared] })) {
          await navigator.share({ files: [prepared], title: 'Vinyl queue backup' });
          message(`${artifactDescription} Share sheet completed; check the file in Files or on the receiving computer.`);
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
    } catch (err) {
      exporting = false;
      if (document.getElementById('prepared')!.hidden || !objectUrl) { prepared = null; objectUrl = null; }
      app.querySelectorAll<HTMLButtonElement>('[data-part], [data-small], [data-record], #metadata').forEach(b => { b.disabled = prepared !== null; });
      const failure = `FAILED at ${stage}: ${String(err)}`; backupReport += `\n${failure}`;
      message(`${failure}. No source records were deleted. Try saving all record details, or one record at a time.`);
      trace(backupReport); await refresh();
    }
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
