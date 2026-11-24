import { dayKey, MAX_TAG_LENGTH } from './domain.js';

export const DEFAULT_TIMELINE_FILTERS = Object.freeze({
  query: '', tag: '', type: 'all', mood: 'all', authorId: 'all', month: '',
  mediaType: 'all', favoritesOnly: false, trash: false,
});
const moods = new Set(['happy', 'neutral', 'sad', 'unset']);
const monthValue = value => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
  && dayKey(`${value}-01`) === `${value}-01` ? value : '';
const tagValue = value => typeof value === 'string' && value.trim().length <= MAX_TAG_LENGTH ? value.trim() : '';

function locationParts(hash) {
  const value = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const separator = value.indexOf('?');
  return { view: (separator < 0 ? value : value.slice(0, separator)) || 'timeline',
    params: new URLSearchParams(separator < 0 ? '' : value.slice(separator + 1)) };
}

export function timelineFilterHref({ mood, tag, month } = {}) {
  const params = new URLSearchParams();
  if (moods.has(mood)) params.set('mood', mood);
  if (tagValue(tag)) params.set('tag', tagValue(tag));
  if (monthValue(month)) params.set('month', monthValue(month));
  return `#timeline${params.size ? `?${params}` : ''}`;
}

export function statisticsHref(month) {
  const value = monthValue(month);
  return `#stats${value ? `?month=${value}` : ''}`;
}

// Restore only explicit, valid scopes; unrelated previous filters cannot make
// the destination disagree with a statistic's displayed count.
export function timelineFiltersFromHash(hash) {
  const { view, params } = locationParts(hash);
  if (view !== 'timeline') return null;
  const mood = params.get('mood');
  return { ...DEFAULT_TIMELINE_FILTERS, mood: moods.has(mood) ? mood : 'all',
    tag: tagValue(params.get('tag')), month: monthValue(params.get('month')) };
}

export function statisticsMonthFromHash(hash) {
  const { view, params } = locationParts(hash);
  return view === 'stats' ? monthValue(params.get('month')) : '';
}
