#!/usr/bin/env node
// @ts-check

/**
 * gen-backlog.mjs — pm-next v0.2 view generator.
 *
 * Records ARE the item files: project/records/<ID>.md with a flat
 * `key: value` frontmatter block (no nesting, no YAML library) over
 * the item's working detail. `_meta.md` holds milestone intent lines.
 * The Active section of project/backlog.md is rendered between
 * generated markers in the standard item grammar ([detail] is
 * rendered as the one-hop link when the flag is present); content
 * outside the markers is preserved.
 *
 * Merge rule (RQ3 finding): on any view conflict, REGENERATE from
 * the merged records — never hand-merge the view.
 *
 * Dialect keys (optional, in `_meta.md` — RECORDS-DIST): `milestones:`
 * as ordered `key=Title` pairs (absent → the canonical three), and
 * `flags:` for the validator. A record naming an unconfigured
 * milestone is an error, never a silent drop.
 *
 * pm-next fork (lab/next/tools/): records live under `records/` with
 * a `tickets/` fallback, and the project dir defaults to `project/`.
 * Re-derive from the canon copy when upstream changes it; do not
 * hand-patch the two apart.
 *
 * Usage: node tools/gen-backlog.mjs [--project-dir project]
 *                                     [--repo-root .] [--check]
 *   --check: exit 1 if the view on disk differs from what the records
 *   generate (divergence detector; the fold-back signal).
 *   --repo-root: resolution base for --project-dir, defaulting to the
 *   working directory — the same rule check-memory.mjs uses, so the
 *   sibling tools agree about which project a path names
 *   (NEXT-HARDEN; the argument-resolution inconsistency was queued
 *   at UPSTREAM-ASSIM).
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const argOf = (/** @type {string} */ name, /** @type {string} */ dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const repoRoot = resolve(argOf('--repo-root', '.'));
const projectDir = resolve(repoRoot, argOf('--project-dir', 'project'));
const recDir = existsSync(join(projectDir, 'records'))
  ? join(projectDir, 'records') : join(projectDir, 'tickets');
/** Directory name the rendered `[detail]` links point at. */
const recDirName = basename(recDir);
const viewPath = join(projectDir, 'backlog.md');
const check = args.includes('--check');

/** @param {string} p */
function parseRecord(p) {
  const raw = readFileSync(p, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`no frontmatter: ${p}`);
  /** @type {Record<string,string>} */
  const fm = {};
  let last = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) { fm[kv[1]] = kv[2].trim(); last = kv[1]; }
    // Hard-wrapped values fold whole (canon A1): a dropped
    // continuation line renders a truncated summary into a view
    // that still looks well-formed.
    else if (last && /^\s+\S/.test(line)) fm[last] += ` ${line.trim()}`;
  }
  return { fm, body: m[2].trim() };
}

const DEFAULT_MILESTONES = [
  ['current', 'Current milestone'],
  ['next', 'Next milestone'],
  ['icebox', 'Icebox'],
];

const files = readdirSync(recDir).filter((f) => f.endsWith('.md'));
const meta = files.includes('_meta.md')
  ? parseRecord(join(recDir, '_meta.md')).fm : {};
const items = files.filter((f) => !f.startsWith('_'))
  .map((f) => parseRecord(join(recDir, f)));

const milestones = meta.milestones
  ? meta.milestones.split(',').map((pair) => {
    const m = pair.trim().match(/^([a-z][a-z0-9-]*)=(.+)$/);
    if (!m) {
      console.error(`gen-backlog: bad milestones pair '${pair.trim()}' in _meta.md — use key=Title`);
      process.exit(1);
    }
    return [m[1], m[2].trim()];
  })
  : DEFAULT_MILESTONES;

const known = new Set(milestones.map(([k]) => k));
let stray = false;
for (const { fm } of items) {
  if (!known.has(fm.milestone ?? '')) {
    console.error(`gen-backlog: record ${fm.id ?? '(no id)'} has milestone '${fm.milestone ?? ''}' — not one of: ${[...known].join(', ')}`);
    stray = true;
  }
}
if (stray) process.exit(1);

/** @param {{fm: Record<string,string>}} r */
function renderItem({ fm }) {
  const box = fm.status === 'in-progress' ? '~' : fm.status === 'cut' ? '-' : ' ';
  const flags = (fm.flags ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((f) => {
      if (f === 'detail') return `[detail](${recDirName}/${fm.id}.md)`;
      if (f === 'blocked' && fm['blocked-on']) return `[blocked: ${fm['blocked-on']}]`;
      return `[${f}]`;
    }).join(' ');
  const date = fm.date ? ` (${fm.date})` : '';
  const grades = fm.grades ? ` · ${fm.grades}` : '';
  const head = `- [${box}] **${fm.id} ${fm.name}**${flags ? ` ${flags}` : ''}${date} —`;
  return wrap(`${head} ${fm.summary}${grades}`.trim());
}

/** Hard-wrap at ~72 with two-space continuations. @param {string} s */
function wrap(s) {
  const words = s.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 72 && cur) { lines.push(cur); cur = '  ' + w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

let out = '';
for (const [key, title] of milestones) {
  const intent = meta[`${key}-intent`];
  out += `### ${title}\n\n`;
  if (intent) out += `<!-- Intent: ${intent} -->\n\n`;
  const rows = items.filter((i) => i.fm.milestone === key)
    .sort((a, b) => Number(a.fm.order ?? 99) - Number(b.fm.order ?? 99));
  for (const r of rows) out += `${renderItem(r)}\n`;
  if (rows.length) out += '\n';
}

const START = '<!-- generated:records:start (edit records/, run gen-backlog) -->';
const END = '<!-- generated:records:end -->';
const existing = existsSync(viewPath) ? readFileSync(viewPath, 'utf8') : '';

/**
 * Match an existing block by its marker STEM, not by the full marker
 * line. The canon copy matches the whole literal including its
 * parenthetical hint, so a view whose markers were written by any
 * other copy — a dialect, an older version, a hand edit — fails the
 * test and the block is APPENDED, silently duplicating the whole
 * Active section (reproduced against lab/project at UPSTREAM-ASSIM,
 * 2026-08-24). The stem is the contract; the parenthetical is a hint
 * to a human and may drift.
 */
const re = /<!-- generated:records:start[\s\S]*?<!-- generated:records:end -->/;

// Exactly one marker pair may exist (external reviews PMRL-009 /
// PML-09): a merge can duplicate the generated block, the
// non-greedy match then rewrites only the FIRST, and --check
// compares that healthy first block and reports green over a
// duplicated view. Count before matching; refuse imbalance.
{
  const starts = existing.split('<!-- generated:records:start').length - 1;
  const ends = existing.split('<!-- generated:records:end -->').length - 1;
  if (starts !== ends || starts > 1) {
    console.error(`gen-backlog: ${viewPath} has ${starts} start / ${ends} end markers (want one balanced pair, or none before first generation) — refusing`);
    process.exit(1);
  }
}

const block = `${START}\n\n${out.trim()}\n\n${END}`;

/**
 * First generation appends the block at the end of the file, inside
 * the `## Active` section the validator parses — creating the heading
 * when the file lacks one. If the backlog keeps other `## ` sections
 * after Active, move the block inside Active once; later runs rewrite
 * it in place. @param {string} content @param {string} blk
 */
function appendBlock(content, blk) {
  const trimmed = content.trim();
  if (/^## Active\s*$/m.test(trimmed)) return `${trimmed}\n\n${blk}\n`;
  const head = trimmed ? `${trimmed}\n\n` : '# Backlog\n\n';
  return `${head}## Active\n\n${blk}\n`;
}

const next = re.test(existing)
  ? existing.replace(re, block)
  : appendBlock(existing, block);

if (check) {
  if (existing !== next) { console.error('gen-backlog --check: view diverges from records — regenerate'); process.exit(1); }
  console.log('gen-backlog --check: view matches records');
} else {
  writeFileSync(viewPath, next);
  console.log(`gen-backlog: ${items.length} record(s) → ${viewPath}`);
}
