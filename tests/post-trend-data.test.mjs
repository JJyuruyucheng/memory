import test from 'node:test';
import assert from 'node:assert/strict';
import { computePostTrend } from '../src/post-trend-data.js';

const members = [{ id: 'a', role: 'member' }, { id: 'b', role: 'member' }];
const now = new Date('2026-11-23T00:00:00Z');
const post = (authorId, createdAt, extra = {}) => ({ authorId, createdAt, occurredAt: '2020-01-01', type: 'note', status: 'published', deletedAt: null, ...extra });

test('six months include the current Shanghai month and all empty bins across a year boundary', () => {
  const result = computePostTrend([], members, '', new Date('2026-12-31T16:00:00Z'));
  assert.deepEqual(result, {
    periods: ['8月', '9月', '10月', '11月', '12月', '1月'].map((label, index) => ({
      label, dateLabel: index === 5 ? '2027年1月' : `2026年${index + 8}月`, counts: [0, 0],
    })),
    totals: [0, 0], scopeLabel: '近六个月', unitLabel: '条',
  });
});

test('monthly posts use Shanghai creation dates rather than occurred dates and exclude outside months', () => {
  const entries = [
    post('a', '2026-05-31T15:59:59.999Z'),
    post('a', '2026-05-31T16:00:00Z'),
    post('b', '2026-06-30T16:00:00Z', { type: 'event' }),
    post('a', '2026-10-31T15:59:59.999Z'),
    post('b', '2026-10-31T16:00:00Z'),
    post('a', '2026-12-01'),
  ];
  const snapshot = structuredClone(entries);
  const result = computePostTrend(entries, members, '', new Date('2026-10-31T16:00:00Z'));
  assert.deepEqual(result.periods.map(period => period.counts), [[1, 0], [0, 1], [0, 0], [0, 0], [1, 0], [0, 1]]);
  assert.deepEqual(result.totals, [2, 2]);
  assert.equal(result.periods.at(-1).dateLabel, '2026年11月');
  assert.deepEqual(entries, snapshot);
});

test('a selected month uses complete seven-day segments with a shortened last range and zero gaps', () => {
  const entries = [
    post('a', '2026-11-07T15:59:59.999Z'),
    post('b', '2026-11-07T16:00:00Z'),
    post('a', '2026-11-21'),
    post('b', '2026-11-30'),
    post('a', '2026-10-31', { occurredAt: '2026-11-01' }),
    post('b', '2026-12-01'),
  ];
  const result = computePostTrend(entries, members, '2026-11', now);
  assert.deepEqual(result.periods, [
    { label: '1—7日', dateLabel: '2026年11月1—7日', counts: [1, 0] },
    { label: '8—14日', dateLabel: '2026年11月8—14日', counts: [0, 1] },
    { label: '15—21日', dateLabel: '2026年11月15—21日', counts: [1, 0] },
    { label: '22—28日', dateLabel: '2026年11月22—28日', counts: [0, 0] },
    { label: '29—30日', dateLabel: '2026年11月29—30日', counts: [0, 1] },
  ]);
  assert.deepEqual(result.totals, [2, 2]);
  assert.equal(result.scopeLabel, '2026年11月');
  assert.equal(result.unitLabel, '条');
});

test('February ranges respect leap years and retain an empty selected month', () => {
  const leap = computePostTrend([post('b', '2024-02-29')], members, '2024-02', now);
  assert.equal(leap.periods.length, 5);
  assert.deepEqual(leap.periods.at(-1), { label: '29日', dateLabel: '2024年2月29日', counts: [0, 1] });
  const ordinary = computePostTrend([], members, '2026-02', now);
  assert.equal(ordinary.periods.length, 4);
  assert.deepEqual(ordinary.periods.at(-1), { label: '22—28日', dateLabel: '2026年2月22—28日', counts: [0, 0] });
  assert.deepEqual(ordinary.totals, [0, 0]);
});

test('only supplied members shared published notes and events count, including legacy missing status', () => {
  const entries = [
    post('a', '2026-11-01'),
    post('a', '2026-11-02', { status: undefined }),
    post('b', '2026-11-03', { type: 'event', status: null }),
    post('a', '2026-11-04', { type: 'whisper' }),
    post('b', '2026-11-05', { type: 'whisper' }),
    post('a', '2026-11-06', { deletedAt: '2026-11-07' }),
    post('a', '2026-11-07', { status: 'draft' }),
    post('b', '2026-11-08', { status: 'unknown' }),
    post('b', '2026-11-09', { type: 'unknown' }),
    post('admin', '2026-11-10'),
    post('outsider', '2026-11-11'),
    null,
  ];
  const result = computePostTrend(entries, members, '2026-11', now);
  assert.deepEqual(result.totals, [2, 1]);
  assert.deepEqual(result.periods.map(period => period.counts), [[2, 1], [0, 0], [0, 0], [0, 0], [0, 0]]);
  const accidentalAdmin = computePostTrend(entries, [members[0], { id: 'admin', role: 'admin' }], '2026-11', now);
  assert.deepEqual(accidentalAdmin.totals, [2, 0]);
});

test('only missing legacy creation dates fall back, while invalid dates do not silently move posts', () => {
  const entries = [
    post('a', undefined, { occurredAt: '2026-10-31T16:00:00Z' }),
    post('b', null, { occurredAt: '2026-11-02' }),
    post('a', '', { occurredAt: '2026-11-03' }),
    post('b', 'not-a-date', { occurredAt: '2026-11-04' }),
    post('b', '2026-11-04T12:00:00', { occurredAt: '2026-11-04' }),
    post('a', undefined, { occurredAt: '2026-02-30' }),
  ];
  assert.deepEqual(computePostTrend(entries, members, '2026-11', now).totals, [2, 1]);
});

test('series follow the supplied member order without mutating inputs, and bad month filters use the default scope', () => {
  const entries = Object.freeze([Object.freeze(post('a', '2026-11-01')), Object.freeze(post('b', '2026-11-02')), Object.freeze(post('b', '2026-11-03'))]);
  const reversed = Object.freeze([Object.freeze({ ...members[1] }), Object.freeze({ ...members[0] })]);
  const result = computePostTrend(entries, reversed, '2026-13', now);
  assert.deepEqual(result.totals, [2, 1]);
  assert.deepEqual(result.periods.at(-1).counts, [2, 1]);
  assert.equal(result.periods.length, 6);
  assert.equal(result.scopeLabel, '近六个月');
  assert.deepEqual(computePostTrend(null, members, '', now).totals, [0, 0]);
});
