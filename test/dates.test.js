import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays, businessDaysBetween, isIsoDate, maxDate } from '../src/core/dates.js';

test('addBusinessDays skips weekends', () => {
  assert.equal(addBusinessDays('2026-11-27', 1), '2026-11-30'); // Fri -> Mon
  assert.equal(addBusinessDays('2026-11-24', 0), '2026-11-24');
  assert.equal(addBusinessDays('2026-11-24', 5), '2026-12-01');
  assert.equal(addBusinessDays('2026-11-28', 1), '2026-11-30'); // Sat -> Mon
  assert.equal(addBusinessDays('2026-12-31', 1), '2027-01-01');
});

test('addBusinessDays rejects bad input', () => {
  assert.throws(() => addBusinessDays('2026-11-24', -1), RangeError);
  assert.throws(() => addBusinessDays('2026-11-24', 1.5), RangeError);
  assert.throws(() => addBusinessDays('24/11/2026', 1), TypeError);
});

test('businessDaysBetween is signed and inverse of addBusinessDays', () => {
  assert.equal(businessDaysBetween('2026-11-27', '2026-11-30'), 1);
  assert.equal(businessDaysBetween('2026-11-30', '2026-11-27'), -1);
  assert.equal(businessDaysBetween('2026-11-24', '2026-11-24'), 0);
  for (let n = 0; n < 30; n += 1) {
    assert.equal(businessDaysBetween('2026-11-24', addBusinessDays('2026-11-24', n)), n);
  }
});

test('helpers', () => {
  assert.equal(maxDate(null, '2026-01-02', '2025-12-31', undefined), '2026-01-02');
  assert.equal(maxDate(null), null);
  assert.ok(isIsoDate('2026-02-28'));
  assert.ok(!isIsoDate('2026-2-28'));
});
