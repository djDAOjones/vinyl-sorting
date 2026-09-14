import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSummary } from '../../src/record-summary.ts';
const base = () => ({ item: { list: 'classical' }, captures: [], release: null, readings: [], provenance: [] });
const byLabel = d => Object.fromEntries(recordSummary(d).map(f => [f.label, f]));

test('record summary keeps requested order, and missing genre is not inferred from the list', () => {
  const fields = recordSummary(base());
  assert.deepEqual(fields.map(f => f.label), ['Artist', 'Title', 'Label', 'Year', 'Genre', 'Value']);
  assert.ok(fields.every(f => f.value === null));
});
test('capture takes precedence over machine readings without altering either', () => {
  const d = base();
  d.captures = [{ id: 1, name_raw: 'Shelf artist' }];
  d.readings = [{ id: 2, field: 'name_raw', value: 'Machine artist' }];
  d.provenance = [{ entity: 'capture', entity_id: 1, field: 'name_raw', source: 'shelf', confirmed_by: 'Joe', confirmed_at: '2026-09-14' }];
  const before = structuredClone(d);
  assert.deepEqual(byLabel(d).Artist, { label: 'Artist', value: 'Shelf artist', note: 'Read at the shelf · confirmed by Joe' });
  assert.deepEqual(d, before);
});
test('photo-only details show unconfirmed readings and retain genre provenance', () => {
  const d = base();
  d.readings = [{ id: 1, field: 'title_raw', value: 'Photo title' }, { id: 2, field: 'Genre', value: 'Jazz' }];
  d.provenance = d.readings.map(r => ({ entity: 'raw_value', entity_id: r.id, field: r.field, source: 'vision', confirmed_at: null, confirmed_by: null }));
  assert.equal(byLabel(d).Title.value, 'Photo title');
  assert.equal(byLabel(d).Genre.value, 'Jazz');
  assert.match(byLabel(d).Genre.note, /photograph · unconfirmed/);
});
test('release label/year are fallbacks but a combined release title is not invented artist/title data', () => {
  const d = base();
  d.release = { id: 7, title: 'Artist - Work', label: 'Decca', year: 1965 };
  const fields = byLabel(d);
  assert.equal(fields.Artist.value, null); assert.equal(fields.Title.value, null);
  assert.equal(fields.Label.value, 'Decca'); assert.equal(fields.Year.value, '1965');
  assert.match(fields.Label.note, /Matched release · provenance not recorded/);
});
test('value distinguishes unknown, none listed and a zero price, and shows the check date', () => {
  const d = base();
  assert.equal(byLabel(d).Value.value, null);
  d.release = { lowest_price: null, price_checked_at: '2026-07-01' };
  assert.equal(byLabel(d).Value.value, 'None listed');
  d.release.lowest_price = 0;
  assert.equal(byLabel(d).Value.value, '~£0.00');
  assert.match(byLabel(d).Value.note, /checked 2026-07-01/);
});
