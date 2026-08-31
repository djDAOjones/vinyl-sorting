// @ts-check
/**
 * CAPTURE-WHO — the roster behind the name typed at first launch.
 *
 * The resolver is the whole of the gate and the whole of the spelling
 * guarantee, so it is tested here without a browser. `storedCapturer`
 * and its two writers are three lines of localStorage around this
 * function and are verified by driving the real app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER, resolveCapturer } from '../../src/who.ts';

test('the roster is the six people who capture, spelled once', () => {
  assert.deepEqual([...ROSTER], ['Joe', 'Jen', 'Ro', 'Ivy', 'Jojo', 'Sue']);
});

test('case and stray space are the typist’s problem, not the data’s', () => {
  // One person, four thumbs, one value in the column. This is what
  // keeps the composer-side spelling problem NAMES-CANONICAL exists to
  // clean up from ever reaching captured_by.
  for (const typed of ['Jojo', 'jojo', 'JOJO', 'JoJo', '  jojo  ', '\tJojo\n']) {
    assert.equal(resolveCapturer(typed), 'Jojo', `${JSON.stringify(typed)} is Jojo`);
  }
  assert.equal(resolveCapturer('joe'), 'Joe');
  assert.equal(resolveCapturer('RO'), 'Ro');
});

test('a name not on the roster is refused, and the refusal is the gate', () => {
  assert.equal(resolveCapturer(''), null);
  assert.equal(resolveCapturer('   '), null);
  assert.equal(resolveCapturer('Joseph'), null, 'no prefix match');
  assert.equal(resolveCapturer('Jo'), null, 'no prefix match the other way either');
  assert.equal(resolveCapturer('Joe Bloggs'), null, 'a surname is not forgiven');
  assert.equal(resolveCapturer('Jo3'), null);
  // Near-misses are refused rather than guessed at. Putting one
  // person's name on another person's row is the same class of fault as
  // an invented rating, and just as invisible a month later.
  assert.equal(resolveCapturer('Jon'), null);
  assert.equal(resolveCapturer('Jenn'), null);
  assert.equal(resolveCapturer('Roo'), null);
});

test('every roster name resolves to itself, so the list cannot rot', () => {
  for (const name of ROSTER) assert.equal(resolveCapturer(name), name);
});
