// @ts-check
/**
 * M0-REPAIR-ENCODING — the repair is tested against strings taken from
 * the frozen inputs, plus negative controls that must survive untouched.
 * Fixtures are committed, so this runs on a clone with no archive.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodeMacRoman, repairMojibake, repairText, stripInvisible } from '../lib/text-repair.mjs';

const fx = JSON.parse(readFileSync('tools/test/fixtures/encoding.json', 'utf8'));

test('every fixture drawn from the frozen inputs repairs to its expected string', () => {
  assert.ok(fx.cases.length > 0, 'fixture set is empty');
  for (const { raw, expected, source } of fx.cases) {
    assert.equal(repairText(raw), expected, `fixture from ${source}: ${JSON.stringify(raw.slice(0, 60))}`);
  }
});

test('negative controls survive the repair unchanged', () => {
  for (const { raw, why } of fx.negatives) {
    assert.equal(repairText(raw), raw, `${why}: ${JSON.stringify(raw)}`);
  }
});

test('repair is idempotent — a second pass changes nothing', () => {
  for (const { raw } of [...fx.cases, ...fx.negatives]) {
    const once = repairText(raw);
    assert.equal(repairText(once), once, `not idempotent: ${JSON.stringify(raw.slice(0, 60))}`);
  }
});

test('the corruption is MacRoman, not cp1252 - the obvious guess is wrong', () => {
  // 0x8E, 0xD0 and 0xCA are the three commonest non-ASCII bytes in the
  // CSV (19, 57 and 68 occurrences). MacRoman reads them as e-acute,
  // en dash and NBSP - exactly what a classical record list contains.
  // Compared by code point, so no invisible character has to survive
  // a copy-paste for this test to keep meaning what it says.
  const bytes = new Uint8Array([0x8e, 0xd0, 0xca]);
  const mac = decodeMacRoman(bytes);
  assert.deepEqual([...mac].map((c) => c.codePointAt(0)), [0x00e9, 0x2013, 0x00a0]);

  // cp1252 recovers none of them. Asserted as a property rather than
  // as literal characters: the point is that the obvious guess
  // disagrees, not which mojibake ICU emits for an unassigned slot
  // (0x8E is unassigned in ICU's cp1252 and passes through raw).
  const cp1252 = new TextDecoder('windows-1252').decode(bytes);
  assert.notEqual(cp1252, mac);
  for (const ch of mac) {
    assert.ok(!cp1252.includes(ch), `cp1252 should not recover U+${ch.codePointAt(0)?.toString(16)}`);
  }
});

test('U+00A0 becomes a space, never nothing — it separates label from catalogue number', () => {
  assert.equal(stripInvisible('CBS Harmony 30001 (NL)'), 'CBS Harmony 30001 (NL)');
  assert.equal(stripInvisible('Decca (London) LL 3287 (mono)'), 'Decca (London) LL 3287 (mono)');
});

test('zero-width characters are removed outright', () => {
  for (const zw of ['​', '‌', '‍', '⁠', '﻿', '­']) {
    assert.equal(stripInvisible(`CFP${zw}40001`), 'CFP40001', `U+${zw.codePointAt(0)?.toString(16)} survived`);
  }
});

test('newlines survive — track listings are multi-line and M3 reads them per track', () => {
  const listing = 'A1 Adagio\r\nA2 Allegro\r\nB1 Andante';
  assert.equal(stripInvisible(listing), 'A1 Adagio\nA2 Allegro\nB1 Andante');
  assert.equal(stripInvisible(listing).split('\n').length, 3);
});

test('no repaired string retains an invisible character', () => {
  for (const { raw } of fx.cases) {
    assert.doesNotMatch(repairText(raw), /[ ​-‍⁠﻿­]/,
      `invisible survived: ${JSON.stringify(raw.slice(0, 60))}`);
  }
});

test('a string with no mojibake lead byte is returned by identity', () => {
  const clean = 'RCA Gold Seal GL25021';
  assert.equal(repairMojibake(clean), clean);
});

// Archive-backed: proves the fixtures still describe the real corpus.
// Skipped on a clone without the 143 MB archive.
const archive = 'Pre August 2026';
test('the whole frozen corpus repairs without leaving invisibles', { skip: !existsSync(archive) }, async () => {
  const { readWorkbook } = await import('../lib/xlsx.mjs');
  // Distinct strings, matching how the extractor counts: the same
  // corrupted catalogue number appears in several rows.
  const repaired = new Set();
  for (const file of ['Vinyl Records Record 2 Jen.xlsx', '1st load to add.xlsx', '2nd load to add.xlsx']) {
    const wb = readWorkbook(`${archive}/${file}`);
    for (const sheet of wb.order) {
      for (const row of wb.sheets[sheet]) {
        for (const value of Object.values(row)) {
          const out = repairText(value);
          if (out !== value) repaired.add(value);
          assert.doesNotMatch(out, /[ ​-‍⁠﻿]/, `invisible survived in ${file}:${sheet}`);
        }
      }
    }
  }
  assert.equal(repaired.size, fx.counts.invisible + fx.counts.mojibake,
    'corpus drifted from the fixture counts — regenerate fixtures');
});
