import test from 'node:test';
import assert from 'node:assert/strict';
import { anniversaryInfo, computeStats, dayKey, escapeHtml, filterEntries, relationshipDays, toUtcIso, validateEntry } from '../src/domain.js';
import { createSampleData } from '../src/sample-data.js';

const valid = (extra = {}) => ({ type: 'note', title: '', content: '把今天记下来。', occurredAt: '2026-11-01T16:10:00.000Z', mood: null, tags: [], media: [], ...extra });
const saved = (id, extra = {}) => ({ ...valid(), id, authorId: 'a', createdAt: '2026-11-02T00:00:00.000Z', comments: [], reactionBy: [], favoriteBy: [], deletedAt: null, ...extra });

test('Shanghai dates and inclusive relationship days ignore machine timezone', () => {
  assert.equal(dayKey('2026-11-01T15:59:59.999Z'), '2026-11-01');
  assert.equal(dayKey('2026-11-01T16:00:00.000Z'), '2026-11-02');
  assert.equal(dayKey('2026-11-01'), '2026-11-01');
  assert.equal(toUtcIso('2026-11-01'), '2026-11-01T04:00:00.000Z');
  assert.equal(dayKey('2026-02-30'), '');
  assert.equal(dayKey('2026-11-01T12:00:00'), '');
  assert.equal(relationshipDays('2025-05-20', '2025-05-19T16:00:00.000Z'), 1);
  assert.equal(relationshipDays('2025-05-20', '2025-05-19T15:59:00.000Z'), 0);
  assert.equal(relationshipDays('bad', '2026-11-16'), 0);
});

test('anniversaries roll to the next occurrence and preserve leap dates', () => {
  const next = anniversaryInfo({ id: 'x', title: '纪念日', date: '2025-11-18', yearly: true }, '2026-11-16T00:00:00Z');
  assert.equal(next.nextDate, '2026-11-18');
  assert.equal(next.daysUntil, 2);
  assert.equal(next.years, 1);
  assert.equal(anniversaryInfo({ date: '2025-11-15', yearly: true }, '2026-11-16').nextDate, '2027-11-15');
  assert.equal(anniversaryInfo({ date: '2024-02-29', yearly: true }, '2026-11-16').nextDate, '2028-02-29');
  assert.equal(anniversaryInfo({ date: '2025-11-15', yearly: false }, '2026-11-16').isPast, true);
  assert.equal(anniversaryInfo({ date: '2026-02-30', yearly: true }), null);
});

test('statistics exclude trash, count moods by records and preserve the unset denominator', () => {
  const entries = [
    saved('1', { occurredAt: '2026-10-31T16:10:00Z', mood: 'happy', media: [{ type: 'image' }] }),
    saved('2', { occurredAt: '2026-11-01T12:00:00Z', mood: null, type: 'event', authorId: 'b', media: [{ type: 'video' }] }),
    saved('3', { occurredAt: '2026-11-02T12:00:00Z', mood: 'sad' }),
    saved('4', { mood: 'happy', deletedAt: '2026-11-02T14:00:00Z' }),
  ];
  const stats = computeStats(entries);
  assert.equal(stats.total, 3);
  assert.equal(stats.days, 2);
  assert.equal(stats.events, 1);
  assert.equal(stats.images, 1);
  assert.equal(stats.videos, 1);
  assert.deepEqual(stats.moods, { happy: 1, neutral: 0, sad: 1, unset: 1 });
  assert.equal(stats.moodSampleSize, 2);
  assert.deepEqual(stats.months, [{ month: '2026-11', count: 3 }]);
  assert.deepEqual(stats.authors, [{ authorId: 'a', count: 2 }, { authorId: 'b', count: 1 }]);
  assert.equal(computeStats([], {}).moodSampleSize, 0);
  assert.equal(computeStats(entries, { authorId: 'b' }).total, 1);
});

test('filters combine Shanghai months, per-person favorites, text, mood and trash', () => {
  const entries = [
    saved('1', { title: '一杯咖啡', occurredAt: '2026-10-31T16:10:00Z', mood: 'happy', favoriteBy: ['a'], tags: ['散步'] }),
    saved('2', { mood: null, favoriteBy: ['b'], deletedAt: '2026-11-02T00:00:00Z' }),
  ];
  const snapshot = structuredClone(entries);
  assert.deepEqual(filterEntries(entries, { query: '散步', month: '2026-11', mood: 'happy', favoritesOnly: true, userId: 'a' }).map(item => item.id), ['1']);
  assert.equal(filterEntries(entries, { favoritesOnly: true, userId: 'b' }).length, 0);
  assert.deepEqual(filterEntries(entries, { trash: true, mood: 'unset' }).map(item => item.id), ['2']);
  assert.equal(filterEntries(entries, { month: '2026-10' }).length, 0);
  assert.deepEqual(entries, snapshot);
});

test('validation prevents empty, impossible-date, invalid-mood and unsupported uploads', () => {
  assert.equal(validateEntry(valid()).valid, true);
  assert.equal(validateEntry(valid({ content: '   ' })).valid, false);
  assert.equal(validateEntry(valid({ content: '', title: ' ' }), [{ name: 'a.jpg', type: 'image/jpeg', size: 12 }]).valid, true);
  assert.equal(validateEntry(valid({ type: 'event', title: '' })).valid, false);
  assert.equal(validateEntry(valid({ occurredAt: '2026-02-30T12:00:00Z' })).valid, false);
  assert.equal(validateEntry(valid({ occurredAt: '2026-11-01T24:00:00Z' })).valid, false);
  assert.equal(validateEntry(valid({ mood: 'great' })).valid, false);
  assert.equal(validateEntry(valid(), [{ name: 'attack.svg', type: 'image/svg+xml', size: 12 }]).valid, false);
  assert.equal(validateEntry(valid(), [{ name: 'huge.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 + 1 }]).valid, false);
  assert.equal(validateEntry(valid(), [{ name: 'boundary.mp4', type: 'video/mp4', size: 50 * 1024 * 1024 }]).valid, true);
  const files = Array.from({ length: 10 }, () => ({ name: 'a.jpg', type: 'image/jpeg', size: 12 }));
  assert.equal(validateEntry(valid(), files).valid, false);
  assert.equal(validateEntry(valid({ media: [{ id: 'existing', type: 'image', size: 12 }] }), files.slice(0, 9)).valid, false);
});

test('plain text can be safely placed in HTML and every sample record is internally valid', () => {
  assert.equal(escapeHtml('<img onerror="bad()"> & \'x\''), '&lt;img onerror=&quot;bad()&quot;&gt; &amp; &#39;x&#39;');
  const sample = createSampleData();
  assert.equal(sample.users.length, 3);
  assert.equal(sample.entries.length, 7);
  for (const entry of sample.entries) {
    assert.equal(validateEntry(entry).valid, true);
    assert.ok(entry.tags.includes('示例'));
    assert.equal(dayKey(entry.occurredAt).slice(0, 7), '2026-11');
  }
  assert.deepEqual(computeStats(sample.entries).moods, { happy: 4, neutral: 1, sad: 1, unset: 1 });
});
