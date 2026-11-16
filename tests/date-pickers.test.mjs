import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPickerDate, parsePickerDate } from '../src/date-pickers.js';

test('日期、月份、时间往返保留表单需要的格式，不做UTC偏移', () => {
  for (const [value, kind] of [['2026-11', 'month'], ['2028-02-29', 'date'], ['2026-11-16T00:03', 'datetime-local'], ['2026-11-16T23:59', 'datetime-local']]) {
    const parsed = parsePickerDate(value, kind); assert.ok(parsed); assert.equal(formatPickerDate(parsed, kind), value);
  }
  assert.equal(formatPickerDate(parsePickerDate('2026-11-16 16:33', 'datetime-local'), 'datetime-local'), '2026-11-16T16:33');
});
test('手填非法日期和溢出时间不会被悄悄进位', () => {
  for (const [value, kind] of [['2026-13', 'month'], ['2027-02-29', 'date'], ['2026-11-31', 'date'], ['2026-00-01', 'date'], ['0001-01-01', 'date'], ['2026-11-16T24:00', 'datetime-local'], ['2026-11-16T12:60', 'datetime-local'], ['2026-11-16T12:30Z', 'datetime-local']]) assert.equal(parsePickerDate(value, kind), null, value);
});
