import type { SourcePreparation } from '../worker/source-preparation.ts';
import type { MBPreview, MBCandidate } from '../worker/musicbrainz.ts';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function musicbrainzPanelHtml(preparation?: SourcePreparation | null): string {
  return `<section class="match-preparation musicbrainz-panel" aria-label="MusicBrainz evidence">
    <h2>MusicBrainz evidence</h2>
    <p>Find another route to identifying this record. Results are unconfirmed leads: a CD or another coupling may help identify the music without identifying your vinyl edition.</p>
    <button type="button" class="btn btn-ghost" data-musicbrainz-search>Search MusicBrainz</button>
    <p class="prov">Unresolved records are checked automatically in the background using saved label details. Unlock editing to search on demand. Changing the details queues fresh evidence.</p>
    <div data-musicbrainz-results aria-live="polite">${sourcePreparationHtml(preparation)}</div>
  </section>`;
}

export function sourcePreparationHtml(p?: SourcePreparation | null): string {
  if (!p) return '';
  const messages: Record<SourcePreparation['status'], string> = {
    waiting: 'Waiting for the automatic source check. You can search now or return later.',
    'needs-details': 'Add a readable catalogue number, or a title with a name or label, to prepare source evidence.',
    settled: 'This record is already identified. Additional source searches are available on request.',
    unavailable: 'Saved source evidence is temporarily unavailable. Refresh later.',
    running: 'Automatic source preparation is in progress. Refresh shortly for results.',
    ready: 'Source evidence is ready for review.',
    incomplete: 'A provider request failed. Saved leads remain available; another attempt is scheduled.',
    paused: 'Automatic attempts have paused after repeated failures. Check the saved details and search again when ready.',
  };
  return `<p><strong>${esc(messages[p.status])}</strong></p>
    ${p.evidence?.retryAt && p.status === 'incomplete' ? `<p class="prov">Next attempt no earlier than ${esc(p.evidence.retryAt)}.</p>` : ''}
    ${p.evidence?.error ? `<p>${esc(p.evidence.error)}</p>` : ''}
    ${p.evidence?.preview ? musicbrainzResultsHtml({ ...p.evidence.preview, cached: true }) : ''}
    ${p.evidence?.retainedPreview ? `<details><summary>Earlier saved leads (before this attempt)</summary>${musicbrainzResultsHtml({ ...p.evidence.retainedPreview, cached: true })}</details>` : ''}`;
}

const card = (c: MBCandidate) => `<article class="mb-candidate">
  <h3><a href="https://musicbrainz.org/release/${esc(c.id)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a></h3>
  <p>${esc(c.artists || 'Credited names not recorded')}</p>
  <p><strong>${c.vinyl ? 'Vinyl candidate — check identity' : 'Context only — check format'}</strong></p>
  <dl class="match-inputs">
    <div><dt>Catalogue numbers</dt><dd>${esc(c.numbers.join(' · ') || 'Not recorded')}</dd></div>
    <div><dt>Labels</dt><dd>${esc(c.labels.join(' · ') || 'Not recorded')}</dd></div>
    <div><dt>Format / tracks</dt><dd>${esc(c.formats.join(' · ') || 'Not recorded')}${c.tracks !== null ? ` · ${c.tracks} tracks` : ''}</dd></div>
    <div><dt>Country / issue date</dt><dd>${esc([c.country, c.date].filter(Boolean).join(' · ') || 'Not recorded')}</dd></div>
  </dl>
  <p>Shared details: ${esc(c.agreements.join(' · ') || 'None established')}.</p>
  ${c.differences.length ? `<p class="mb-differences">${esc(c.differences.join(' · '))}.</p>` : ''}
  <p class="prov">Compare the label, track list and complete package. Shared words and numbers do not confirm a release or performance.</p>
</article>`;

export function musicbrainzResultsHtml(p: MBPreview): string {
  return `<p><strong>${p.incomplete ? 'Search incomplete — useful leads may still be shown' : 'Bounded search complete'}</strong></p>
    <p class="prov">${p.cached ? 'Saved results' : 'Retrieved'}: ${esc(p.retrievedAt)} · MusicBrainz · unconfirmed</p>
    <p>${p.candidates.length ? `${p.candidates.length} candidate releases. This does not establish which pressing you own.` : 'No candidates returned by these searches. This does not establish that the release is absent from MusicBrainz.'}</p>
    ${p.candidates.slice(0, 10).map(card).join('')}
    ${p.candidates.length > 10 ? `<details><summary>Show ${p.candidates.length - 10} more candidates</summary>${p.candidates.slice(10).map(card).join('')}</details>` : ''}
    <details><summary>Searches and limitations</summary><ul>${p.attempts.map(a => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.kind)}</a>: ${a.error ? esc(a.error) : `${a.returned} of ${a.count} results retrieved`}; ${a.requests} request(s).<br><code>${esc(a.query)}</code></li>`).join('')}</ul>
      <p>Only catalogue aliases and a shortened title/name query were tested, up to 25 results each. Different recordings can share the same conductor and work title. These results do not change your catalogue.</p></details>`;
}

export function wireMusicbrainz(panel: HTMLElement, itemId: number, headers: () => Record<string, string>): void {
  const button = panel.querySelector<HTMLButtonElement>('[data-musicbrainz-search]');
  const results = panel.querySelector<HTMLElement>('[data-musicbrainz-results]');
  if (!button || !results) return;
  button.addEventListener('click', async () => {
    const auth = headers();
    if (!auth['x-edit-token']) { results.textContent = 'Unlock editing under More details and editing, then search again.'; return; }
    if (!auth['x-capturer']) { results.textContent = 'Set your name before searching.'; return; }
    button.disabled = true; results.textContent = 'Searching MusicBrainz… This can take a few seconds.';
    try {
      const response = await fetch(`/api/items/${itemId}/musicbrainz`, { method: 'POST', headers: auth });
      const body = await response.json() as MBPreview & { error?: string; sourcePreparation?: SourcePreparation };
      if (!response.ok) throw new Error(body.error ?? `Search unavailable (HTTP ${response.status})`);
      if (results.isConnected) results.innerHTML = body.sourcePreparation ? sourcePreparationHtml(body.sourcePreparation) : musicbrainzResultsHtml(body);
    } catch (error) { if (results.isConnected) results.textContent = error instanceof Error ? error.message : 'Search failed. Try again later.'; }
    finally { button.disabled = false; }
  });
}
