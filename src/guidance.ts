/**
 * What to photograph, and in what order (CAPTURE-GUIDANCE).
 *
 * THE ARGUMENT FOR THIS SCREEN IS SEVENTEEN ROWS. Items 467-483 came
 * back from the second crate photographed sleeve-only, and the sleeve
 * is where the decoys live: a mono and a stereo number printed as a
 * pair, an LP number beside a tape number, an export number beside the
 * domestic one, and adverts carrying the catalogue number of an
 * entirely different record. Only the disc says which of them is in
 * your hand. The ruling was made on 2026-08-31 and written into the
 * README, which is exactly where the person holding the camera is not
 * looking.
 *
 * ORDER IS THE WHOLE MESSAGE. A crate gets walked at speed and nobody
 * reads four paragraphs standing in a loft, so this is a ranked list
 * and the first item is the one that matters. It is separated from
 * `main.ts` so the words can be edited without touching the camera.
 */

const KEY = 'vs.guide';

/** Shown once per device, then only when asked for. */
export function needsGuide(): boolean {
  try { return localStorage.getItem(KEY) !== 'seen'; } catch { return false; }
}

export function markGuideSeen(): void {
  try { localStorage.setItem(KEY, 'seen'); } catch { /* it will offer again, which is harmless */ }
}

interface Step { n: string; what: string; why: string }

const STEPS: Step[] = [
  {
    n: '1',
    what: 'Fill the frame with the disc label',
    why: 'Not the disc, and not the sleeve holding the disc — the label. '
      + 'It carries the catalogue number, the label name and usually the coupling, '
      + 'and it is the one surface that describes the record in your hand rather '
      + 'than the record the sleeve was printed for.',
  },
  {
    n: '2',
    what: 'The back of the sleeve',
    why: 'For the tracklist. What is actually on a pressing is what settles which '
      + 'pressing it is when two of them share a catalogue number.',
  },
  {
    n: '3',
    what: 'The runout, angled to the light',
    why: 'The scratched matrix code between the last groove and the label. It '
      + 'identifies a pressing when nothing else will, and it only shows up when '
      + 'the light rakes across it.',
  },
  {
    n: '4',
    what: 'Anything that disagrees',
    why: 'The sleeve is where the decoys are: a mono and a stereo number printed '
      + 'as a pair, an LP number beside a tape number, an advert carrying a '
      + 'different record’s number. If the disc and the sleeve disagree, '
      + 'photograph both and let the matcher find out which is real.',
  },
];

export function guideHtml(): string {
  return `
    <div class="dlg-head"><h2>What to photograph</h2></div>
    <div class="dlg-body">
      <p class="note">In this order. Take as many as the disc needs — another
        photograph is nearly always worth more than another typed field.</p>
      <ol class="guide">
        ${STEPS.map((s) => `
          <li>
            <span class="gn">${s.n}</span>
            <span class="gw">${s.what}</span>
            <span class="gy">${s.why}</span>
          </li>`).join('')}
      </ol>
      <p class="note-info"><strong>Get close.</strong> A whole 12″ disc in the frame
        leaves a catalogue number about sixteen pixels a character, and that is
        where one of them has already been lost. The same label filling the frame
        gives about fifty. Framing buys more than any camera setting.</p>
      <p class="note">Tap any photograph afterwards to see it full size — while the
        disc is still in your hand is the only cheap moment to notice a number that
        will not read.</p>
    </div>
    <div class="dlg-foot">
      <button class="btn btn-primary" id="guideOk" type="button">Got it</button>
    </div>`;
}
