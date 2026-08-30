#!/usr/bin/env node
// @ts-check

/**
 * janitor-read.mjs — the read-only maintenance janitor (JANITOR-READ).
 *
 * Runs the memory validator plus the cheap environment
 * line and writes a dated report to <project-dir>/reports/latest.md
 * (pm-next default: project/reports/latest.md — gitignored).
 * A fresh report (per the staleness contract in AGENTS.md → Operation)
 * lets session start read instead of compute; a stale or absent one
 * falls back to computing.
 *
 * READ-ONLY FOREVER: this janitor never writes project memory —
 * writing verbs are JANITOR-WRITE, separately gated per verb. The
 * report is generated output: never hand-edited, never canonical.
 *
 * Usage: node tools/janitor-read.mjs [--project-dir project]
 *                                      [--repo-root .]
 */

import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const argOf = (/** @type {string} */ n, /** @type {string} */ d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const repoRoot = resolve(argOf('--repo-root', '.'));
const projectDir = argOf('--project-dir', 'project');

const sh = (/** @type {string} */ c) => {
  try {
    return execSync(c, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return /** @type {any} */ (e).stdout?.trim() ?? '(command failed)';
  }
};

const sha = sh('git rev-parse HEAD') || '(no git)';
const now = new Date().toISOString();
const cloud = sh("pwd -P | grep -Ei 'Library/CloudStorage|OneDrive|Dropbox|Google Drive|iCloud' || true");
let validator = '';
try {
  // argv, never a shell string: JSON.stringify quoting left `$()`
  // and backticks expandable inside the generated double quotes, so
  // a hostile project path could execute (PML-10 / CWE-78).
  validator = execFileSync(process.execPath,
    ['tools/check-memory.mjs', '--repo-root', repoRoot, '--project-dir', projectDir],
    { cwd: repoRoot, encoding: 'utf8' });
} catch (e) {
  validator = /** @type {any} */ (e).stdout ?? 'validator failed to run';
}

const report = `# Janitor report (generated — never edit)

Generated: ${now}
Start SHA: ${sha}
Project dir: ${projectDir}
Freshness contract: sessions read this only if it is under ~24 h
old AND the Start SHA is in the current branch history; otherwise
compute per AGENTS.md -> Operation.

## Environment

Cloud-sync path: ${cloud ? `MATCH — ${cloud} (warn-only at session start)` : 'clean'}

## Validator (check-memory)

${validator.trim()}
`;

const outDir = join(repoRoot, projectDir, 'reports');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'latest.md'), report);
console.log(`janitor-read: wrote ${join(projectDir, 'reports', 'latest.md')} @ ${sha.slice(0, 7)}`);
