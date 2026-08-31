// @ts-check

/**
 * PHOTOS-TO-DESKTOP — the pull is read-only, and it is a pull.
 *
 * The behaviour needs a Cloudflare account and photographs in R2, so
 * what is testable here is the shape: that a tool pointed at production
 * cannot write to it, that it did not quietly become the export ROUTE
 * the record rejected, and that it reads pairs from D1 rather than
 * enumerating a bucket. Those are the properties that would rot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('tools/photos-pull.mjs', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(SRC);

test('the pull cannot write to the database it points at', () => {
  // It runs with the maintainer's real credentials against --remote.
  // A stray verb here is a production write, not a test failure.
  for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE']) {
    assert.ok(!new RegExp(`\\b${verb}\\b`).test(code), `photos-pull issues ${verb}`);
  }
  assert.match(code, /\bSELECT\b/, 'it does read');
});

test('the only R2 verb is get', () => {
  const r2 = [...code.matchAll(/'r2', 'object', '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(r2, ['get'], 'put or delete against a photo bucket is never this tool\'s job');
});

test('it never writes back over capture', () => {
  // The hard rule: `capture` holds what a human read. This tool reads
  // capture to build ground truth and must never write to it.
  //
  // Asserted as SQL rather than as the words "into capture", which the
  // tool says in prose when it reports where the ground truth came
  // from — a phrase match failed on its own success message.
  assert.ok(!/INSERT\s+INTO\s+capture\b/i.test(code), 'photos-pull inserts into capture');
  assert.ok(!/UPDATE\s+capture\b/i.test(code), 'photos-pull updates capture');
  assert.match(code, /LEFT JOIN capture/, 'it only reads it');
});

test('pairs come from D1, so no bucket is ever enumerated', () => {
  // The record's open question. `item_photo` carries (item_id, r2_key),
  // so listing R2 is unnecessary — and a tool that listed a bucket
  // would be one step from the export route this design exists to
  // avoid.
  assert.match(code, /FROM item_photo/);
  assert.ok(!/'r2', 'object', 'list'|r2 bucket list|listObjects/.test(code),
    'it enumerates R2 rather than reading the pairs it was given');
});

test('a photograph is never anonymously readable, route or key', () => {
  // SUPERSEDED, NOT DELETED. This asserted that no photo GET existed at
  // all — right while the answer to "may a route serve one" was
  // unsettled. BROWSE-PHOTOS settled it on 2026-08-31: yes, behind the
  // typed name. The property being protected has not changed —
  // photographs are not anonymously enumerable — so the assertion moves
  // to the form that still protects it.
  const worker = readFileSync('worker/index.ts', 'utf8');
  assert.match(worker, /app\.get\('\/api\/photos\/:key[^)]*', capturerGuard/,
    'the photo route exists and is guarded, or it should not exist at all');
  assert.match(worker, /app\.put\('\/api\/photos/, 'the upload route is still there');

  // The key IS the photograph's address, so gating the route while
  // handing keys out anonymously would protect nothing. Both or
  // neither — this is the half that is easy to forget.
  assert.match(worker, /\$\{named \? ', r2_key' : ''\}/,
    'item detail must withhold r2_key from an unnamed caller');

  // And R2 is never handed a key the caller invented: `parseCapture`
  // only trims r2Key, so a stored key can be any string.
  assert.match(worker, /SELECT 1 AS ok FROM item_photo WHERE r2_key = \?/,
    'the key must be matched against the database before R2 sees it');
});

test('no credential is read from the environment', () => {
  assert.ok(!/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/.test(code));
  assert.ok(!/DISCOGS_TOKEN/.test(code));
});
