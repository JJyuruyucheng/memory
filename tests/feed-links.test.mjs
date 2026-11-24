import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, filterEntries } from '../src/domain.js';
import { DEFAULT_TIMELINE_FILTERS, statisticsHref, statisticsMonthFromHash, timelineFilterHref, timelineFiltersFromHash } from '../src/feed-links.js';

test('all three mood links retain the selected month and reset unrelated filters on reload', () => {
  for (const month of ['', '2026-11']) for (const mood of ['happy', 'neutral', 'sad']) {
    const href = timelineFilterHref({ mood, month });
    assert.deepEqual(timelineFiltersFromHash(href), { ...DEFAULT_TIMELINE_FILTERS, mood, month });
    const previous = { query: 'old search', tag: 'old tag', authorId: 'other', type: 'event', mediaType: 'video', favoritesOnly: true, trash: true };
    Object.assign(previous, timelineFiltersFromHash(href));
    assert.deepEqual(previous, { ...DEFAULT_TIMELINE_FILTERS, mood, month });
  }
});

test('destination records reconcile with the mood counts, including empty moods and Shanghai month boundaries', () => {
  const row = (mood, occurredAt, fields = {}) => ({ id: crypto.randomUUID(), mood, occurredAt, type: 'note', deletedAt: null, media: [], tags: [], ...fields });
  const entries = [
    row('happy', '2026-10-31T16:00:00Z'), row('happy', '2026-11-02', { type: 'event' }),
    row('neutral', '2026-11-30T15:59:59Z', { type: 'whisper' }), row(null, '2026-11-04'),
    row('sad', '2026-10-31T15:59:59Z'), row('sad', '2026-11-30T16:00:00Z'),
    row('sad', '2026-11-13', { deletedAt: '2026-11-14T00:00:00Z' }),
  ];
  for (const month of ['', '2026-11']) {
    const stats = computeStats(filterEntries(entries, { month }));
    for (const mood of ['happy', 'neutral', 'sad']) {
      const selected = filterEntries(entries, timelineFiltersFromHash(timelineFilterHref({ mood, month })));
      assert.equal(selected.length, stats.moods[mood]);
      assert.ok(selected.every(entry => entry.mood === mood && !entry.deletedAt));
    }
  }
});

test('statistics and tag URLs restore the same month across back and forward navigation', () => {
  const statistics = statisticsHref('2026-11');
  const target = timelineFilterHref({ tag: '约会 & 旅行', month: statisticsMonthFromHash(statistics) });
  assert.equal(statisticsMonthFromHash(statistics), '2026-11');
  assert.deepEqual(timelineFiltersFromHash(target), { ...DEFAULT_TIMELINE_FILTERS, tag: '约会 & 旅行', month: '2026-11' });
  assert.equal(statisticsMonthFromHash(statistics), timelineFiltersFromHash(target).month);
  assert.equal(statisticsHref(''), '#stats'); assert.equal(timelineFilterHref(), '#timeline');
});

test('malformed URL scopes are ignored, entry links still work, and defaults are never mutated', () => {
  for (const hash of ['#timeline?mood=unknown&month=2026-13', '#timeline?month=0099-01', `#timeline?tag=${'长'.repeat(41)}`]) {
    assert.deepEqual(timelineFiltersFromHash(hash), DEFAULT_TIMELINE_FILTERS);
  }
  assert.deepEqual(timelineFiltersFromHash('#timeline?entry=selected-memory'), DEFAULT_TIMELINE_FILTERS);
  assert.equal(timelineFiltersFromHash('#album?mood=happy'), null);
  assert.equal(statisticsMonthFromHash('#stats?month=2026-00'), '');
  const first = timelineFiltersFromHash('#timeline?mood=happy'); first.month = '2020-01';
  assert.deepEqual(timelineFiltersFromHash('#timeline?mood=happy'), { ...DEFAULT_TIMELINE_FILTERS, mood: 'happy' });
});
