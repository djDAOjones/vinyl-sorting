#!/usr/bin/env node
// @ts-check

/**
 * reverify.mjs — M2's first production job: re-verify every existing
 * Discogs match against the corroboration gate.
 *
 * This is the audit, not a search. For each row that already claims a
 * Discogs release, fetch that exact release and ask whether the
 * evidence actually supports the claim. The old rule was
 * `catno exact -> accept`, so 26 of 277 point at a different record and
 * 16 of those are labelled "Exact". The gate answers on evidence.
 *
 * THE AUDIT MUST USE ONLY WHAT A HUMAN SUPPLIED. On these 277 rows the
 * `label` column came FROM Discogs — M0 established that it is filled
 * on exactly the matched rows and on none of the others. Scoring the
 * claimed release against it compares Discogs with itself, the label
 * family always fires, and every match looks corroborated. A first run
 * did exactly that and reported 1 unsupported out of 277, which is a
 * measurement of nothing.
 *
 * So every field is filtered by its recorded provenance, and only
 * `legacy` and `shelf` values are allowed to corroborate. This is the
 * AGENTS.md rule — duplicate detection runs on what a human read
 * rather than on what a bad match wrote — applied to the audit itself.
 *
 * Rate limited to the shared 50/min AGENTS.md fixes, with a real
 * user-agent. Read-only: it fetches releases and writes a report.
 * Releases are cached to disk so a re-score costs no API calls.
 *
 * Usage: node tools/reverify.mjs [--limit N] [--out data/reverify.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readCsv } from './lib/csv.mjs';
import { normaliseCatno } from '../worker/match/normalise.ts';
import { applyGate, scoreCandidate } from '../worker/match/score.ts';
import { USER_AGENT } from '../worker/discogs.ts';

const TOKEN_FILE = 'Pre August 2026/Windsurf Projects/discogs_personal_access_token';
const CSV = 'data/deep-groove-v1.csv';
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const limit = Number(argOf('--limit', '0')) || Infinity;
const out = argOf('--out', 'data/reverify.json');

const token = readFileSync(TOKEN_FILE, 'utf8').trim();
const CACHE_FILE = 'data/discogs-release-cache.json';
/** @type {Record<string, any>} */
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
const SPACING_MS = 1_250;   // 48/min, inside the shared 50/min budget

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRelease(id) {
  if (cache[id]) return cache[id];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://api.discogs.com/releases/${id}`, {
      headers: { Authorization: `Discogs token=${token}`, 'User-Agent': USER_AGENT },
    });
    if (res.status === 429) { await sleep(5_000 * attempt); continue; }
    if (res.status === 404) { cache[id] = { missing: true }; return cache[id]; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for release ${id}`);
    cache[id] = await res.json();
    return cache[id];
  }
  throw new Error(`rate limited repeatedly on release ${id}`);
}

/**
 * Keep only values a person supplied, judged by their recorded
 * provenance. Exported so the rule is testable: letting a
 * Discogs-sourced field corroborate a Discogs match is the circularity
 * that made a first run report 1 unsupported out of 277.
 * @param {Record<string,string>} row
 */
export function humanFieldsOnly(row) {
  const human = (field) => (row[`${field}_source`] === 'legacy' || row[`${field}_source`] === 'shelf'
    ? (row[field] ?? '') : '');
  return {
    catnoVariants: normaliseCatno(human('catno_raw')),
    labelRaw: human('label_raw'),
    titleRaw: human('title'),
    nameRaw: human('conductor') || human('composer'),
    yearRaw: human('year_released'),
  };
}

/** Adapt release JSON to the shape the scorer reads. */
const asCandidate = (release) => ({
  id: release.id,
  catno: release.labels?.[0]?.catno ?? null,
  label: (release.labels ?? []).map((l) => l.name).filter(Boolean),
  title: [(release.artists ?? []).map((a) => a.name).join(' '), release.title].filter(Boolean).join(' - '),
  year: release.year ?? null,
  format: (release.formats ?? []).flatMap((f) => [f.name, ...(f.descriptions ?? [])]).filter(Boolean),
});

// Importing this module for `humanFieldsOnly` must not start an audit.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (!isMain) { /* library use */ } else { await main(); }

async function main() {
const rows = readCsv(readFileSync(CSV, 'utf8')).filter((r) => r.discogs_id);
console.log(`reverify: ${rows.length} rows carry a Discogs id; auditing ${Math.min(rows.length, limit)}`);

const findings = [];
let done = 0;
for (const row of rows.slice(0, limit)) {
  const release = await getRelease(Number(row.discogs_id));
  done++;

  const capture = humanFieldsOnly(row);

  if (release.missing) {
    findings.push({ itemId: row.item_id, discogsId: row.discogs_id, verdict: 'missing',
      legacyConfidence: row.discogs_confidence_legacy, score: null, families: [], reason: 'release no longer exists' });
  } else {
    const scored = scoreCandidate(capture, asCandidate(release));
    // A single-candidate gate: the question is whether THIS release is
    // supported, so there is no runner-up and the margin test cannot
    // apply. Score and family corroboration still must.
    const supported = scored.score >= 80 && scored.families.length >= 2;
    findings.push({
      itemId: row.item_id,
      discogsId: row.discogs_id,
      verdict: supported ? 'supported' : 'unsupported',
      legacyConfidence: row.discogs_confidence_legacy,
      score: scored.score,
      families: scored.families,
      signals: scored.signals,
      capture: { catno: capture.catnoVariants[0] ?? null, label: capture.labelRaw || null,
        title: (capture.titleRaw ?? '').slice(0, 60), name: capture.nameRaw || null },
      humanFieldsUsed: Object.entries({ catno: capture.catnoVariants.length, label: capture.labelRaw,
        title: capture.titleRaw, name: capture.nameRaw }).filter(([, v]) => v).map(([k]) => k),
      discogs: { catno: asCandidate(release).catno, label: asCandidate(release).label?.[0],
        title: String(asCandidate(release).title).slice(0, 60), year: release.year },
      reason: supported ? `score ${scored.score}, families ${scored.families.join('+')}`
        : `score ${scored.score}, ${scored.families.length} family (${scored.families.join('+') || 'none'})`,
    });
  }

  if (done % 25 === 0) {
    console.log(`  ${done}/${Math.min(rows.length, limit)}…`);
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  }
  await sleep(SPACING_MS);
}
writeFileSync(CACHE_FILE, JSON.stringify(cache));

const unsupported = findings.filter((f) => f.verdict === 'unsupported');
const missing = findings.filter((f) => f.verdict === 'missing');
const exactButUnsupported = unsupported.filter((f) => f.legacyConfidence === 'Exact');

writeFileSync(out, `${JSON.stringify({
  auditedAt: new Date().toISOString(),
  audited: findings.length,
  supported: findings.length - unsupported.length - missing.length,
  unsupported: unsupported.length,
  missing: missing.length,
  exactButUnsupported: exactButUnsupported.length,
  findings,
}, null, 2)}\n`);

console.log(`\nreverify: ${findings.length} audited`);
console.log(`  supported by evidence : ${findings.length - unsupported.length - missing.length}`);
console.log(`  UNSUPPORTED           : ${unsupported.length}`);
console.log(`  release gone          : ${missing.length}`);
console.log(`  labelled "Exact" but unsupported: ${exactButUnsupported.length}`);
const byFamilyCount = {};
for (const f of findings) {
  if (f.families) byFamilyCount[f.families.length] = (byFamilyCount[f.families.length] ?? 0) + 1;
}
console.log(`  corroborating families per row: ${JSON.stringify(byFamilyCount)}`);
console.log(`  -> ${out}`);
}
