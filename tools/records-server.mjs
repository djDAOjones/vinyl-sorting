#!/usr/bin/env node
// @ts-check

/**
 * records-server.mjs — RQ5-INTERFACE prototype (lab-only).
 *
 * An MCP-shaped JSON-RPC 2.0 server over the lab's backlog records:
 * newline-delimited messages on stdio; initialize / tools/list /
 * tools/call. The point under test is ENFORCEMENT AT THE BOUNDARY:
 * invalid state transitions and malformed items are rejected before
 * they touch disk — the property raw file edits cannot have (the
 * validator only catches them post-hoc at the gate).
 *
 * Zero dependencies. State operations only — judgement stays in the
 * prompts (PM-MCP constraint). Writes regenerate the view.
 *
 * Hardened at NEXT-HARDEN (2026-08-29, external reviews PMRL-010 /
 * PML-10): every caller-supplied scalar is validated — single line,
 * no control characters, per-field grammar — so a newline can no
 * longer inject frontmatter keys; creation is create-only (`wx`);
 * and record + view publish as one transaction — the record writes
 * atomically, and a failed regeneration rolls the record back to
 * its preimage before the error is reported, so canonical state
 * and the generated view never part ways.
 */

import {
  readFileSync, readdirSync, writeFileSync, existsSync,
  renameSync, unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve('.');
const recDir = join(root, 'project', 'records');
// Kept in step with the memory contract in AGENTS.md (UPSTREAM-ASSIM,
// 2026-08-24): `open` is a valid status, and `_meta.md` may rename the
// milestones via its `milestones: key=Title` dialect key — a server
// that hardcoded the canonical three would reject writes the contract
// and the validator both allow.
const STATUSES = new Set(['open', 'todo', 'in-progress', 'cut']);
const DEFAULT_MILESTONES = ['current', 'next', 'icebox'];

/** Milestone keys this project accepts: the dialect if set, else the default. */
function milestoneKeys() {
  const meta = join(recDir, '_meta.md');
  if (!existsSync(meta)) return new Set(DEFAULT_MILESTONES);
  const m = readFileSync(meta, 'utf8').match(/^milestones:\s*(.+)$/m);
  if (!m) return new Set(DEFAULT_MILESTONES);
  return new Set(m[1].split(',').map((p) => p.trim().split('=')[0]).filter(Boolean));
}
const ID_RE = /^[A-Z][A-Z0-9-]+$/;

/** @param {string} id */
const recPath = (id) => join(recDir, `${id}.md`);

/** @param {string} id */
function readRecord(id) {
  if (!ID_RE.test(id) || !existsSync(recPath(id))) return null;
  const raw = readFileSync(recPath(id), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  /** @type {Record<string,string>} */
  const fm = {};
  let last = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) { fm[kv[1]] = kv[2].trim(); last = kv[1]; }
    else if (last && /^\s+\S/.test(line)) fm[last] += ` ${line.trim()}`;
  }
  return { fm, body: m[2] };
}

function regen() {
  execFileSync(process.execPath, [join(root, 'tools', 'gen-backlog.mjs')],
    { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * One caller-supplied scalar: a non-empty single line with no
 * control characters (a newline here used to inject frontmatter
 * keys straight through the template below — PML-10).
 * @param {any} v @param {string} field
 */
function singleLine(v, field, max = 500) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required (a non-empty string)`);
  for (const ch of v) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if (c < 0x20 || c === 0x7f) throw new Error(`${field} must be a single line with no control characters`);
  }
  if (v.length > max) throw new Error(`${field} is over ${max} characters`);
  return v.trim();
}

/**
 * Record + view are ONE transaction: write the record atomically
 * (create-only for a new record), regenerate the view, and on a
 * regeneration failure restore the preimage — and the view — before
 * reporting. The old shape wrote durably and then threw, leaving
 * the canonical record changed under a stale view (PML-10).
 * @param {string} id
 * @param {string} next
 * @param {string|null} preimage null = creating
 */
function publish(id, next, preimage) {
  const p = recPath(id);
  if (preimage === null) {
    writeFileSync(p, next, { flag: 'wx' }); // create-only: no clobber, no race
  } else {
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, next);
    renameSync(tmp, p);
  }
  try {
    regen();
  } catch (e) {
    try {
      if (preimage === null) unlinkSync(p);
      else writeFileSync(p, preimage);
      regen();
    } catch { /* best-effort rollback; the error below still reports */ }
    const detail = String(/** @type {any} */ (e)?.stderr ?? /** @type {Error} */ (e).message).trim().slice(0, 300);
    throw new Error(`view regeneration failed — the write was rolled back: ${detail}`);
  }
}

const TOOLS = [
  { name: 'list_items', description: 'List backlog records (id, name, status, milestone).', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_item', description: 'Full record for one id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'set_status', description: 'Set a record status (open | todo | in-progress | cut). Regenerates the view.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } }, required: ['id', 'status'] } },
  { name: 'add_item', description: 'Create a record (grammar-checked). Regenerates the view.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, milestone: { type: 'string' }, summary: { type: 'string' }, flags: { type: 'string' }, date: { type: 'string' }, order: { type: 'number' } }, required: ['id', 'name', 'milestone', 'summary'] } },
];

/** @param {string} name @param {any} a */
function call(name, a) {
  if (name === 'list_items') {
    const rows = readdirSync(recDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .map((f) => { const r = readRecord(f.replace(/\.md$/, '')); return r && { id: r.fm.id, name: r.fm.name, status: r.fm.status, milestone: r.fm.milestone }; })
      .filter(Boolean);
    return rows;
  }
  if (name === 'get_item') {
    const r = readRecord(String(a?.id ?? ''));
    if (!r) throw new Error(`no such record: ${a?.id}`);
    return { frontmatter: r.fm, body: r.body.trim() };
  }
  if (name === 'set_status') {
    const { id, status } = a ?? {};
    if (!STATUSES.has(status)) throw new Error(`invalid status '${status}' — one of: ${[...STATUSES].join(' | ')}`);
    const r = readRecord(String(id));
    if (!r) throw new Error(`no such record: ${id}`);
    const raw = readFileSync(recPath(String(id)), 'utf8');
    const next = raw.replace(/^status: .*$/m, `status: ${status}`);
    if (next === raw)
      throw new Error(`record ${id} has no 'status:' line to set — fix the frontmatter first`);
    publish(String(id), next, raw);
    return { id, status };
  }
  if (name === 'add_item') {
    const { id, milestone } = a ?? {};
    if (!ID_RE.test(String(id))) throw new Error(`invalid id '${id}' — SCREAMING-KEBAB required`);
    const milestones = milestoneKeys();
    if (!milestones.has(milestone))
      throw new Error(`invalid milestone '${milestone}' — one of: ${[...milestones].join(' | ')}`);
    const nm = singleLine(a?.name, 'name', 120);
    const summary = singleLine(a?.summary, 'summary', 500);
    const flags = a?.flags === undefined || a?.flags === '' ? ''
      : singleLine(a.flags, 'flags', 120);
    if (flags && !/^[a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*$/.test(flags))
      throw new Error(`invalid flags '${flags}' — a comma list of lower-case kebab words`);
    const date = a?.date === undefined ? new Date().toISOString().slice(0, 10)
      : singleLine(a.date, 'date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid date '${date}' — YYYY-MM-DD`);
    const order = a?.order === undefined ? 50 : a.order;
    if (!Number.isInteger(order) || order < 0 || order > 999)
      throw new Error(`invalid order '${order}' — an integer 0..999`);
    if (existsSync(recPath(String(id)))) throw new Error(`record exists: ${id}`);
    publish(String(id),
      `---\nid: ${id}\nname: ${nm}\nstatus: todo\nmilestone: ${milestone}\nflags: ${flags}\ndate: ${date}\norder: ${order}\nsummary: ${summary}\n---\n# ${id} — ${nm}\n`,
      null);
    return { id, created: true };
  }
  throw new Error(`unknown tool: ${name}`);
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    /** @type {any} */
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const reply = (/** @type {any} */ body) =>
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...body })}\n`);
    try {
      if (msg.method === 'initialize')
        reply({ result: { protocolVersion: '2025-06-18', serverInfo: { name: 'pm-records', version: '0.1' }, capabilities: { tools: {} } } });
      else if (msg.method === 'tools/list') reply({ result: { tools: TOOLS } });
      else if (msg.method === 'tools/call')
        reply({ result: { content: [{ type: 'text', text: JSON.stringify(call(msg.params?.name, msg.params?.arguments)) }] } });
      else if (msg.id !== undefined) reply({ error: { code: -32601, message: `unknown method ${msg.method}` } });
    } catch (e) {
      reply({ error: { code: -32000, message: /** @type {Error} */ (e).message } });
    }
  }
});
