#!/usr/bin/env node
// @ts-check

/**
 * check-memory.mjs — mechanical validator for pm-skills project memory.
 *
 * The mechanical half of the close: it checks the FORM of project
 * memory after the memory writes, and doubles as the property oracle
 * for evaluation scenarios. It does NOT check that the backlog view
 * matches the records — that is `gen-backlog.mjs --check`, and a close
 * runs both.
 *
 * Exit semantics (assessment C1: budgets propose, they never block):
 *   - STRUCTURAL failures exit 1 — grammar violations, [x] items left
 *     in the backlog, duplicate IDs, ticket orphans, conflict markers.
 *     These gate commits via lint:memory in `npm run check`.
 *   - BUDGET overruns and ageing are WARN lines, exit 0 — they feed
 *     maintenance proposals, never block work.
 *
 * Budget numbers come from a machine-readable block, never from this
 * script: the project directory's `memory-policy.md` when present,
 * then `pm_skills/memory-policy.md`, else the Budgets section of
 * `AGENTS.md`.
 *
 * HONESTY NOTE: this validates the FORM of project memory, never the
 * truth of it — a well-formed decision entry can still be wrong.
 *
 * Records-mode dialect: the records directory's `_meta.md` may carry
 * `flags: a, b` to extend the known flag list (sign-off, spike, detail,
 * maintainer, security, blocked). Custom flags are known, never
 * standing.
 *
 * pm-next fork (lab/next/tools/): four deliberate differences from
 * the canon copy this file tracks — records under `records/` with a
 * `tickets/` fallback, project-owned budgets outrank the canon-shaped
 * policy and fall back to AGENTS.md when neither policy exists, the
 * project dir defaults to `project/`, and the reference-doc set is
 * brief.md alone. Re-derive from the canon copy when upstream changes
 * it; do not hand-patch the two apart.
 *
 * Hardened at NEXT-HARDEN (2026-08-29, external reviews PMRL-009 /
 * PML-09): a validator that cannot read its target must say so and
 * fail — a missing project directory, missing required files, or an
 * unreadable budgets source are catalogued FAILs, never a silent
 * green or a stack trace. Frontmatter reads fold hard-wrapped
 * values (canon A1) and refuse duplicate keys; the item head splits
 * only at a top-level em dash (canon FLAGS-EMDASH port).
 *
 * Usage:
 *   node tools/check-memory.mjs [--project-dir project]
 *                                 [--repo-root .]
 *
 * Zero dependencies; git via execSync only for the lite-close trailer
 * scan (skipped gracefully outside a git repo / on shallow history).
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

/** @typedef {{tag: 'FAIL'|'WARN'|'OK'|'note', msg: string}} Line */

/** @type {Line[]} */
const lines = [];
const say = (/** @type {Line['tag']} */ tag, /** @type {string} */ msg) =>
  lines.push({ tag, msg });

const args = process.argv.slice(2);
const argOf = (/** @type {string} */ name, /** @type {string} */ dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const repoRoot = resolve(argOf('--repo-root', '.'));
const projectDir = resolve(repoRoot, argOf('--project-dir', 'project'));

/**
 * pm-next names its item records `records/`, not `tickets/`. The
 * fallback keeps a canon-shaped project readable by this copy, and
 * one constant keeps the dialect, records-mode detection, and the
 * records pass from ever disagreeing about where records live
 * (the v0 bug: the validator looked under tickets/ and silently
 * skipped coherence).
 */
const recordsDir = existsSync(join(projectDir, 'records'))
  ? join(projectDir, 'records') : join(projectDir, 'tickets');

const read = (/** @type {string} */ p) =>
  existsSync(p) ? readFileSync(p, 'utf8') : null;
const words = (/** @type {string|null} */ s) =>
  s ? s.split(/\s+/).filter(Boolean).length : 0;
const tok = (/** @type {number} */ w) => `~${Math.round((w * 4) / 3)} tok`;
const daysSince = (/** @type {string} */ iso) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/**
 * Require the complete non-negative integer shape this validator reads.
 * Extra keys stay legal so a canon-shaped policy remains compatible.
 */
function validateBudgets(/** @type {any} */ B, /** @type {string} */ source) {
  const object = (/** @type {any} */ value, /** @type {string} */ path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${source}: ${path} must be an object`);
  };
  const count = (/** @type {any} */ value, /** @type {string} */ path) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${source}: ${path} must be a non-negative safe integer`);
  };

  object(B, 'budget block');
  if ('$comment' in B && typeof B.$comment !== 'string')
    throw new Error(`${source}: $comment must be a string when present`);
  object(B.backlogActive, 'backlogActive');
  object(B.decisionLog, 'decisionLog');

  if (!Number.isSafeInteger(B.backlogActive.softWords)
      && Number.isSafeInteger(B.backlogActive.itemGuardWords))
    throw new Error(`${source}: backlogActive.softWords is required by the pm-next fork; itemGuardWords alone is the canon 4.18+ schema`);

  for (const [path, value] of [
    ['referenceDocSoftWords', B.referenceDocSoftWords],
    ['backlogActive.softWords', B.backlogActive.softWords],
    ['backlogActive.maxOpenItems', B.backlogActive.maxOpenItems],
    ['trajectoryWords', B.trajectoryWords],
    ['decisionLog.maxLiveEntries', B.decisionLog.maxLiveEntries],
    ['decisionLog.entryGuardWords', B.decisionLog.entryGuardWords],
    ['decisionLog.maxOldestDays', B.decisionLog.maxOldestDays],
    ['decisionLog.liveFloorEntries', B.decisionLog.liveFloorEntries],
    ['decisionLog.minEntriesBeyondFloor', B.decisionLog.minEntriesBeyondFloor],
    ['wishListMaxOpen', B.wishListMaxOpen],
    ['ticketSoftWords', B.ticketSoftWords],
    ['standingItemWarnDays', B.standingItemWarnDays],
  ]) count(value, path);

  const D = B.decisionLog;
  if (D.liveFloorEntries > D.maxLiveEntries)
    throw new Error(`${source}: decisionLog.liveFloorEntries must not exceed maxLiveEntries`);
  if (D.liveFloorEntries + D.minEntriesBeyondFloor > D.maxLiveEntries)
    throw new Error(`${source}: decisionLog live floor plus beyond-floor minimum must not exceed maxLiveEntries`);
  return B;
}

/** Parse and validate the first machine-readable budget source. */
function readBudgets() {
  // pm-next carries its budgets inline in the one-file contract;
  // a canon-shaped project still has memory-policy.md. A policy
  // file in the project dir outranks the repo-root copy, so a
  // project can own its budgets without editing an inherited or
  // frozen canon copy (the lab's case: pm_skills/ is comparison
  // apparatus and must not drift).
  const sources = [
    join(projectDir, 'memory-policy.md'),
    join(repoRoot, 'pm_skills', 'memory-policy.md'),
    join(repoRoot, 'AGENTS.md'),
  ];
  let policy = null;
  let source = '';
  for (const path of sources) {
    const candidate = read(path);
    if (candidate === null) continue;
    policy = candidate;
    source = relative(repoRoot, path) || basename(path);
    break;
  }
  if (policy === null) throw new Error('no budgets source (memory-policy.md or AGENTS.md)');
  const m = policy.match(/```json\n([\s\S]*?)```/);
  if (!m) throw new Error(`${source}: no machine-readable budget block`);
  return validateBudgets(JSON.parse(m[1]), source);
}

const KNOWN_FLAGS = /^(sign-off|spike|detail|maintainer|security|blocked\b.*)$/;
const STANDING = /^(sign-off|maintainer|blocked\b.*)$/;

/** Extra known flags from the records-mode dialect key (`_meta.md`). */
function dialectFlags() {
  const fm = recordFm(join(recordsDir, '_meta.md'));
  if (!fm?.flags) return new Set();
  return new Set(fm.flags.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Parse the backlog's Active section into items, joining continuation
 * lines so multi-line flags and descriptions parse whole.
 */
function parseBacklog(/** @type {string} */ content) {
  const active = content.split(/^## Active\s*$/m)[1] ?? '';
  const section = active.split(/^## /m)[0];
  const raw = section.split('\n');
  /** @type {{status:string,text:string,line:number}[]} */
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i].match(/^- \[([ x~-])\]\s+(.*)$/);
    if (!m) continue;
    let text = m[2];
    let j = i + 1;
    while (j < raw.length && /^ {2,}\S/.test(raw[j]) && !/^ *- \[/.test(raw[j])) {
      text += ` ${raw[j].trim()}`;
      j++;
    }
    items.push({ status: m[1], text, line: i + 1 });
  }
  return { items, sectionWords: words(section) };
}

function backlogCheck(/** @type {any} */ B) {
  const path = join(projectDir, 'backlog.md');
  const content = read(path);
  if (!content) { say('note', 'backlog.md: absent — skipped'); return { detailIds: new Set() }; }
  // Records mode changes the right repair: the view is generated, so a bad
  // line is fixed by regenerating from records — never by editing the view.
  const recordsMode = content.includes('<!-- generated:records:start')
    || existsSync(join(recordsDir, '_meta.md'));
  const extraFlags = recordsMode ? dialectFlags() : new Set();
  const { items, sectionWords } = parseBacklog(content);
  const ids = new Map();
  const detailIds = new Set();
  /** @type {Map<string,string>} */
  const openStatuses = new Map();
  const ageing = [];
  let open = 0, unparsed = 0;

  for (const it of items) {
    if (it.status === 'x')
      say('FAIL', recordsMode
        ? `backlog: shipped [x] item in the generated view (line ${it.line}) — ship deletes the record; delete it and regenerate (gen-backlog), never hand-edit between the markers`
        : `backlog: shipped [x] item still present (line ${it.line}) — evict to trajectory`);
    if (it.status === ' ' || it.status === '~') open++;
    const bold = it.text.match(/^\*\*([A-Z][A-Z0-9-]+)\b([^*]*)\*\*\s*(.*)$/);
    if (!bold) { unparsed++; continue; }
    const id = bold[1];
    if (ids.has(id)) say('FAIL', `backlog: duplicate item ID ${id}`);
    ids.set(id, true);
    if (it.status !== 'x') openStatuses.set(id, it.status);
    const head = itemHead(bold[3] ?? '');
    const flags = [...head.matchAll(/\[([^\]]+)\]/g)].map((f) => f[1]);
    for (const f of flags)
      if (!KNOWN_FLAGS.test(f) && !extraFlags.has(f))
        say('WARN', `backlog: ${id} carries unknown flag [${f}]`);
    if (flags.includes('detail')) detailIds.add(id);
    const date = head.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1];
    const standing = flags.some((f) => STANDING.test(f));
    if (standing && !date)
      say('WARN', `backlog: standing item ${id} has no creation date (grammar asks for one)`);
    if (standing && date && daysSince(date) > B.standingItemWarnDays)
      ageing.push(`${id} (${daysSince(date)} d)`);
    if (flags.includes('security'))
      say('WARN', `SECURITY: ${id} open${date ? ` since ${date} (${daysSince(date)} d)` : ''} — banners every session until closed`);
  }
  if (unparsed)
    say('WARN', `backlog: ${unparsed} item line(s) do not parse as "**ID Title** [flags] — …" (template placeholders count)`);
  if (ageing.length)
    say('WARN', `backlog: standing items past ${B.standingItemWarnDays} d — ${ageing.slice(0, 3).join(', ')}`);
  if (sectionWords > B.backlogActive.softWords || open > B.backlogActive.maxOpenItems)
    say('WARN', `backlog Active over budget: ${sectionWords} words / ${open} open (budget ${B.backlogActive.softWords} words / ${B.backlogActive.maxOpenItems} items) — propose Refactor`);
  else
    say('OK', `backlog Active: ${sectionWords} words, ${open} open items (budget ${B.backlogActive.softWords} / ${B.backlogActive.maxOpenItems})`);
  return { detailIds, openStatuses };
}

/**
 * The item head: everything before the first TOP-LEVEL em dash.
 * A plain split('—') read an em dash inside a flag body — e.g.
 * `[blocked: upstream — see the other thing]` — as the head
 * boundary, erasing the date and any later flags (canon
 * FLAGS-EMDASH, ported). `gen-backlog.mjs` renders `blocked-on`
 * verbatim into the bracket, so the generator emits exactly what
 * the naive split could not read.
 */
function itemHead(/** @type {string} */ rest) {
  let square = 0, round = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '[') square++;
    else if (c === ']') square = Math.max(0, square - 1);
    else if (c === '(') round++;
    else if (c === ')') round = Math.max(0, round - 1);
    else if (c === '—' && !square && !round) return rest.slice(0, i);
  }
  return rest;
}

/**
 * Parse a record file's flat frontmatter, or null if none.
 * Hard-wrapped values fold whole (canon A1: a continuation line
 * silently dropped leaves a well-formed view over truncated
 * state), and duplicate keys are recorded for the caller to FAIL
 * — last-wins parsing turns a merge artefact into a silent
 * overwrite.
 */
function recordFm(/** @type {string} */ p) {
  const m = (read(p) ?? '').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  /** @type {Record<string,string>} */
  const fm = {};
  /** @type {string[]} */
  const dupes = [];
  let last = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) {
      if (kv[1] in fm) dupes.push(kv[1]);
      fm[kv[1]] = kv[2].trim();
      last = kv[1];
    } else if (last && /^\s+\S/.test(line)) {
      fm[last] += ` ${line.trim()}`;
    }
  }
  if (dupes.length) fm['duplicate-keys'] = dupes.join(',');
  return fm;
}

function ticketsCheck(/** @type {any} */ B, /** @type {Set<string>} */ detailIds, /** @type {Map<string,string>|null} */ openStatuses) {
  const dir = recordsDir;
  if (!existsSync(dir)) { say('note', `${basename(dir)}/: absent — skipped`); return; }
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  // Records mode is the SAME test backlogCheck uses (generated markers or
  // a _meta.md). Requiring _meta.md here dropped a structurally perfect
  // records project into legacy tickets mode and FAILed every record that
  // did not carry [detail].
  const recordsMode = openStatuses
    && (files.includes('_meta.md')
      || (read(join(projectDir, 'backlog.md')) ?? '').includes('<!-- generated:records:start'));
  if (!recordsMode && files.some((f) => f !== '_meta.md') && basename(dir) === 'records') {
    say('FAIL', `records: ${files.length} record(s) but the backlog has no generated block — run gen-backlog before the validator`);
    return;
  }
  if (recordsMode && openStatuses) {
    // RECORDS MODE (BACKLOG-STATE phase 1): tickets are the records;
    // the backlog view is generated. Coherence replaces the old
    // detail-flag two-way rule.
    const recs = files.filter((f) => !f.startsWith('_'));
    const recIds = new Map(recs.map((f) => {
      const fm = recordFm(join(dir, f));
      return [basename(f, '.md'), fm];
    }));
    for (const [id, fm] of recIds) {
      if (!fm) { say('FAIL', `records: ${id}.md has no frontmatter`); continue; }
      if (fm['duplicate-keys'])
        say('FAIL', `records: ${id}.md repeats frontmatter key(s) ${fm['duplicate-keys']} — a merge artefact; keep exactly one`);
      // Grammar first: an ID fault otherwise reappears below as "the view has
      // drifted", whose advice regenerates the same view forever.
      if (!/^[A-Z][A-Z0-9-]+$/.test(id)) {
        say('FAIL', `records: ${id}.md filename is not a valid ID — SCREAMING-KEBAB, letters, digits and hyphens only, no dots`);
        continue;
      }
      if (fm.id && fm.id !== id) {
        say('FAIL', `records: ${id}.md declares id '${fm.id}' — the frontmatter id must equal the filename`);
        continue;
      }
      const status = fm.status ?? '';
      if (!/^(open|todo|in-progress|cut)$/.test(status))
        say('WARN', `records: ${id} status '${status}' is not a known value (open/todo/in-progress/cut) — it renders as open; a shipped record is deleted, not marked done`);
      if (!openStatuses.has(id))
        say('FAIL', `records: ${id}.md has no open item in the view — if it shipped, delete the record and regenerate; if still open, the view has drifted — regenerate from records (never hand-edit the view)`);
      else {
        const box = openStatuses.get(id);
        const want = status === 'in-progress' ? '~' : status === 'cut' ? '-' : ' ';
        if (box !== want)
          say('FAIL', `records: ${id} status '${status}' does not match view box '[${box}]' — regenerate the view from records`);
        const w = words(read(join(dir, `${id}.md`)));
        if (w > B.ticketSoftWords)
          say('WARN', `records: ${id}.md at ${w} words (soft ${B.ticketSoftWords})`);
      }
    }
    for (const id of openStatuses.keys())
      if (!recIds.has(id))
        say('FAIL', `records: open item ${id} has no record file — the view should be generated`);
    say('OK', `records mode: ${recs.length} record(s), id/status coherence with the view checked (byte drift is gen-backlog --check's remit)`);
    return;
  }
  for (const f of files) {
    const id = basename(f, '.md');
    if (!detailIds.has(id))
      say('FAIL', `tickets: orphan file ${f} — no open backlog item ${id} with [detail]`);
    const w = words(read(join(dir, f)));
    if (w > B.ticketSoftWords)
      say('WARN', `tickets: ${f} at ${w} words (soft ${B.ticketSoftWords})`);
  }
  for (const id of detailIds)
    if (!files.includes(`${id}.md`))
      say('FAIL', `tickets: ${id} carries [detail] but tickets/${id}.md is missing`);
  if (files.length) say('OK', `tickets: ${files.length} file(s), mapping checked`);
}

function markersCheck() {
  const targets = [projectDir, recordsDir];
  for (const dir of targets) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const c = read(join(dir, f)) ?? '';
      if (/^(?:<{7}|>{7})(?:\s|$)/m.test(c))
        say('FAIL', `merge residue: conflict marker in ${f}`);
    }
  }
}

function budgetsReport(/** @type {any} */ B) {
  const refs = [
    join(repoRoot, 'README.md'),
    join(projectDir, 'brief.md'),
  ];
  for (const p of refs) {
    const w = words(read(p));
    if (!w) continue;
    say(w > B.referenceDocSoftWords ? 'WARN' : 'OK',
      `reference doc ${basename(p)}: ${w} words, ${tok(w)} (soft ${B.referenceDocSoftWords})`);
  }

  const tw = words(read(join(projectDir, 'trajectory.md')));
  if (tw) say(tw > B.trajectoryWords ? 'WARN' : 'OK',
    `trajectory: ${tw} words (budget ${B.trajectoryWords})`);

  const dl = read(join(projectDir, 'decision-log.md'));
  if (dl) {
    const heads = [...dl.matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]);
    const n = heads.length;
    const oldest = heads.length ? heads.reduce((a, b) => (a < b ? a : b)) : null;
    const D = B.decisionLog;
    if (n > D.maxLiveEntries)
      say('WARN', `decision-log: ${n} live entries (budget ${D.maxLiveEntries}) — propose archive split, keep latest ${D.liveFloorEntries} live`);
    else say('OK', `decision-log: ${n} live entries (budget ${D.maxLiveEntries})`);
    if (oldest && daysSince(oldest) > D.maxOldestDays) {
      const beyond = n - D.liveFloorEntries;
      say(beyond >= D.minEntriesBeyondFloor ? 'WARN' : 'note',
        `decision-log: oldest entry ${oldest} (${daysSince(oldest)} d > ${D.maxOldestDays})`
        + (beyond >= D.minEntriesBeyondFloor ? ' — propose archive split' : ' — noted only (few entries beyond the read-tier floor)'));
    }
    for (const chunk of dl.split(/^## /m).slice(1)) {
      const w = words(chunk);
      if (w > D.entryGuardWords)
        say('WARN', `decision-log: entry "${chunk.slice(0, 46).trim()}…" at ${w} words (guard ${D.entryGuardWords})`);
    }
  }

  const wl = read(join(projectDir, 'wish-list.md'));
  if (wl) {
    const openSec = wl.split(/^## Open\s*$/m)[1] ?? '';
    const n = (openSec.match(/^- /gm) ?? []).length;
    say(n > B.wishListMaxOpen ? 'WARN' : 'OK',
      `wish-list: ${n} open (budget ${B.wishListMaxOpen})${n > B.wishListMaxOpen ? ' — propose a triage pass' : ''}`);
  }

}

/**
 * Attention counters (metrics-lite): derivable from trajectory dates
 * and git history alone — no telemetry infrastructure. Informational;
 * read at reflection, never a gate.
 */
function attentionCounters() {
  const tr = read(join(projectDir, 'trajectory.md'));
  if (!tr) return;
  /** @type {{id:string,date:string}[]} */
  const items = [];
  for (const chunk of tr.split(/^(?=- )/m)) {
    // Tolerate consuming-project dialects: `- ID (date, mode) — …` as well
    // as canon's `- ID — …`, and `(YYYY-MM-DD, anything)` date stamps.
    const id = chunk.match(/^- ([A-Z][A-Z0-9-]+)(?: \([^)]*\))? —/)?.[1];
    const dates = [...chunk.matchAll(/\((\d{4}-\d{2}-\d{2})(?:,[^)]*)?\)/g)];
    if (id && dates.length) items.push({ id, date: dates[dates.length - 1][1] });
  }
  const last30 = items.filter((i) => daysSince(i.date) <= 30).length;
  say('note', `counters: ${items.length} items in trajectory, ${last30} shipped in the last 30 days`);
  let commits = 0, counted = 0;
  for (const i of items.slice(0, 5)) {
    try {
      const n = execSync(`git log --oneline --grep=${i.id}`, {
        cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().split('\n').filter(Boolean).length;
      commits += n; counted++;
    } catch { /* no git — skip */ }
  }
  if (counted)
    say('note', `counters: ${(commits / counted).toFixed(1)} commits per shipped item (last ${counted})`);
}

function finish() {
  for (const l of lines) console.log(`${l.tag.padEnd(4)} ${l.msg}`);
  const fails = lines.filter((l) => l.tag === 'FAIL').length;
  const warns = lines.filter((l) => l.tag === 'WARN').length;
  console.log(`Summary: ${fails} structural failure(s), ${warns} warning(s)`);
  process.exit(fails ? 1 : 0);
}

function main() {
  console.log(`check-memory: ${projectDir.replace(`${repoRoot}/`, '')} (root ${repoRoot})`);
  console.log('note: validates the form of memory, never the truth of it.');
  // A validator that cannot read its target must fail, not skip its
  // way to a green summary: a missing project scored exit 0 with
  // every check politely "skipped" (external review, PML-09 class).
  if (!existsSync(projectDir)) {
    say('FAIL', `project directory absent: ${projectDir} — nothing was validated`);
    return finish();
  }
  for (const f of ['backlog.md', 'brief.md', 'trajectory.md', 'decision-log.md', 'wish-list.md']) {
    if (!existsSync(join(projectDir, f)))
      say('FAIL', `required file absent: ${f} — the install ships it; an empty file is honest, a missing one is unreadable state`);
  }
  /** @type {any} */
  let B;
  try {
    B = readBudgets();
  } catch (e) {
    say('FAIL', `budgets source unreadable: ${/** @type {Error} */ (e).message}`);
    return finish();
  }
  const { detailIds, openStatuses } = backlogCheck(B);
  ticketsCheck(B, detailIds, openStatuses);
  markersCheck();
  budgetsReport(B);
  attentionCounters();
  return finish();
}

try {
  main();
} catch (e) {
  // Never a raw stack trace: an unexpected error is still a
  // catalogued failure of the run itself.
  say('FAIL', `check-memory could not complete: ${/** @type {Error} */ (e).message}`);
  finish();
}
