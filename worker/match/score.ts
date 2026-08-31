/**
 * Scoring and the corroboration gate.
 *
 * THE CHANGE THIS PROJECT EXISTS FOR. The old rule was
 * `catno exact → accept`, which produced 26 wrong matches out of 277
 * and labelled 16 of them "Exact". A catalogue number is unique per
 * label, not globally, so on its own it is a lead and never a verdict.
 *
 * A match is auto-accepted only when THREE things hold at once:
 *   score >= 80, families >= 2, and (top - second) >= 25.
 *
 * The margin test is what kills the collisions where four records all
 * matched one release with nothing to separate them: if the runner-up
 * is nearly as good, no evidence actually discriminated.
 */

import { compactCatno, compactText } from './normalise.ts';

/** Independent kinds of evidence. Two must agree — two readings of the
 *  same fact do not corroborate each other, so they are counted by
 *  family rather than by points. */
export type Family = 'identifier' | 'label' | 'people' | 'title' | 'format';

export const GATE = { minScore: 80, minFamilies: 2, minMargin: 25 } as const;

export interface Capture {
  catnoVariants: string[];
  labelRaw?: string | null;
  titleRaw?: string | null;
  nameRaw?: string | null;
  yearRaw?: string | null;
  formatRaw?: string | null;
}

/** The subset of a Discogs search result the scorer reads. */
export interface Candidate {
  id: number;
  catno?: string | null;
  label?: string[] | null;
  title?: string | null;
  year?: number | string | null;
  format?: string[] | null;
  /**
   * Carried through UNSCORED and on purpose. A sleeve image is worth
   * nothing to the scorer — it cannot read it — and everything to the
   * person the scorer hands the row to when it cannot decide.
   */
  thumb?: string | null;
}

export interface Scored {
  id: number;
  score: number;
  families: Family[];
  signals: Record<string, string>;
  /**
   * The candidate as Discogs returned it.
   *
   * Carried because the release row was being created from the id
   * alone: title, label and catalogue number were scored and then
   * thrown away, so every release the matcher made was blank and the
   * review screen had nothing to show a person to check against. Two
   * items were confirmed on 2026-08-31 against exactly that emptiness.
   */
  candidate: Candidate;
}

const year = (v: unknown): number | null => {
  const m = /(\d{4})/.exec(String(v ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 1900 && n < 2100 ? n : null;
};

/** Score one candidate, recording which families of evidence agreed. */
export function scoreCandidate(capture: Capture, candidate: Candidate): Scored {
  let score = 0;
  const families = new Set<Family>();
  const signals: Record<string, string> = {};

  // ── identifier ──────────────────────────────────────────────────
  const candidateCatno = compactCatno(candidate.catno);
  const variants = capture.catnoVariants.map(compactCatno).filter(Boolean);
  if (candidateCatno && variants.length) {
    if (variants.includes(candidateCatno)) {
      score += 55;
      families.add('identifier');
      signals.identifier = `exact catno ${candidate.catno}`;
    } else {
      const partial = variants.filter((v) => v.includes(candidateCatno) || candidateCatno.includes(v));
      if (partial.length) {
        // Deliberately weak. A containment hit is how `MFP 2014` matched
        // `MFP 20140`; it may support a match, never carry one.
        score += 18;
        signals.identifier = `partial catno ${candidate.catno}`;
      }
    }
  }

  // ── label ───────────────────────────────────────────────────────
  const wantLabel = compactText(capture.labelRaw);
  if (wantLabel) {
    const labels = (candidate.label ?? []).map(compactText).filter(Boolean);
    const hit = labels.find((l) => l === wantLabel || l.includes(wantLabel) || wantLabel.includes(l));
    if (hit) {
      score += 30;
      families.add('label');
      signals.label = `label ${hit}`;
    }
  }

  // ── title ───────────────────────────────────────────────────────
  const wantTitle = compactText(capture.titleRaw);
  const candidateTitle = compactText(candidate.title);
  if (wantTitle && candidateTitle) {
    const wantWords = wantTitle.split(' ').filter((w) => w.length > 3);
    const overlap = wantWords.filter((w) => candidateTitle.includes(w)).length;
    if (wantWords.length && overlap / wantWords.length >= 0.5) {
      score += 20;
      families.add('title');
      signals.title = `${overlap}/${wantWords.length} title words`;
    }
  }

  // ── people ──────────────────────────────────────────────────────
  // Discogs puts artists in the search result's title as "Artist - Work",
  // so a captured name corroborates when it appears there.
  const wantName = compactText(capture.nameRaw);
  if (wantName && candidateTitle) {
    const surname = wantName.split(' ').filter((w) => w.length > 3).pop();
    if (surname && candidateTitle.includes(surname)) {
      score += 25;
      families.add('people');
      signals.people = `name ${surname}`;
    }
  }

  // ── format ──────────────────────────────────────────────────────
  // Weak on its own, but it is what refuses a 7" single for an LP.
  const wantYear = year(capture.yearRaw);
  const candidateYear = year(candidate.year);
  if (wantYear && candidateYear && Math.abs(wantYear - candidateYear) <= 2) {
    score += 10;
    families.add('format');
    signals.format = `year ${candidateYear}`;
  }
  const formats = (candidate.format ?? []).map(compactText);
  if (formats.some((f) => f.includes('lp') || f.includes('vinyl'))) {
    score += 5;
    signals.formatKind = formats.join(',');
  } else if (formats.length) {
    // A CD or a 7" for a record captured off a vinyl shelf is evidence
    // against, not merely absent evidence.
    score -= 25;
    signals.formatKind = `not vinyl: ${formats.join(',')}`;
  }

  return { id: candidate.id, score, families: [...families], signals, candidate };
}

export type Verdict = 'verified' | 'needs_review' | 'no_match';

export interface GateResult {
  verdict: Verdict;
  chosen: Scored | null;
  margin: number;
  reason: string;
  ranked: Scored[];
}

/**
 * Apply the corroboration gate to a scored field.
 * Ranking is a stable sort so an identical result set always produces
 * the same verdict — reproducibility is what makes a bad match
 * arguable after the fact.
 */
export function applyGate(scored: Scored[]): GateResult {
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.id - b.id);
  const top = ranked[0];
  if (!top || top.score <= 0) {
    return { verdict: 'no_match', chosen: null, margin: 0, reason: 'nothing scored above zero', ranked };
  }

  const second = ranked[1];
  const margin = top.score - (second?.score ?? 0);
  const failures: string[] = [];
  if (top.score < GATE.minScore) failures.push(`score ${top.score} < ${GATE.minScore}`);
  if (top.families.length < GATE.minFamilies) {
    failures.push(`only ${top.families.length} signal family (${top.families.join(', ') || 'none'}) — a catalogue number alone is a lead, not a verdict`);
  }
  if (margin < GATE.minMargin) failures.push(`margin ${margin} < ${GATE.minMargin} over the runner-up`);

  return failures.length
    ? { verdict: 'needs_review', chosen: top, margin, reason: failures.join('; '), ranked }
    : { verdict: 'verified', chosen: top, margin, reason: `score ${top.score}, families ${top.families.join('+')}, margin ${margin}`, ranked };
}
