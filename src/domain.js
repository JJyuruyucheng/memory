import { lunarAnniversaryInYear, lunarToSolar, solarToLunar, LUNAR_MIN_YEAR, LUNAR_MAX_YEAR } from './lunar-calendar.js';

const DAY_MS = 86400000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_ZONE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/i;
const MOODS = ['happy', 'neutral', 'sad'];
export const MAX_ENTRY_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const ALLOWED_FILE_TYPES = Object.freeze({
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'image/gif': 'image', 'image/avif': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
});

function dateParts(value) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function instant(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value !== 'string') return null;
  if (DATE_ONLY.test(value)) return dateParts(value) ? new Date(`${value}T12:00:00+08:00`) : null;
  if (!ISO_ZONE.test(value) || !dateParts(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Date-only input means noon in Shanghai; stored instants always have an explicit UTC zone. */
export function toUtcIso(value) {
  const date = instant(value);
  if (!date) throw new Error('日期无效，请填写真实日期或带时区的时间。');
  return date.toISOString();
}

export function dayKey(value) {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return dateParts(value) ? value : '';
  const date = instant(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ordinal(date) {
  const parts = dateParts(date);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS : NaN;
}

/** Inclusive calendar-day count: the relationship's first Shanghai day is day 1. */
export function relationshipDays(startDate, now = new Date()) {
  const elapsed = ordinal(dayKey(now)) - ordinal(startDate);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed + 1) : 0;
}

export function normalizeAnniversaryDate(anniversary) {
  if (!anniversary || !dateParts(anniversary.date)) return null;
  const { date, calendar, lunar } = anniversary;
  if (calendar !== 'lunar') return (calendar === undefined || calendar === 'solar') && lunar === undefined ? { date } : null;
  if (!lunar || lunarToSolar(lunar) !== date) return null;
  const { year, month, day, leap } = lunar;
  return { date, calendar, lunar: { year, month, day, leap } };
}

function anniversaryYear(anniversary) {
  return anniversary.lunar?.year ?? Number(anniversary.date.slice(0, 4));
}

function occurrence(anniversary, year) {
  if (year < anniversaryYear(anniversary)) return '';
  if (anniversary.calendar === 'lunar') return lunarAnniversaryInYear(anniversary.lunar, year);
  const candidate = `${year}-${anniversary.date.slice(5)}`;
  return dateParts(candidate) ? candidate : '';
}

export function anniversariesInMonth(anniversaries, month) {
  const result = new Map();
  if (!dateParts(`${month}-01`)) return result;
  const year = Number(month.slice(0, 4));
  for (const item of anniversaries) {
    const anniversary = normalizeAnniversaryDate(item);
    if (!anniversary) continue;
    const dates = !item.yearly ? [anniversary.date] : anniversary.calendar === 'lunar'
      ? [occurrence(anniversary, year - 1), occurrence(anniversary, year)] : [occurrence(anniversary, year)];
    for (const date of dates) {
      if (!date.startsWith(month)) continue;
      const matches = result.get(date) ?? [];
      matches.push(item);
      result.set(date, matches);
    }
  }
  return result;
}

export function anniversaryInfo(item, now = new Date()) {
  const anniversary = normalizeAnniversaryDate(item);
  if (!anniversary) return null;
  const today = dayKey(now);
  if (!today) return null;
  const solarYear = Number(today.slice(0, 4));
  const isLunar = anniversary.calendar === 'lunar';
  const thisYear = isLunar ? solarToLunar(today)?.year ?? Math.max(LUNAR_MIN_YEAR, Math.min(LUNAR_MAX_YEAR, solarYear)) : solarYear;
  const originalYear = anniversaryYear(anniversary);
  let occurrenceYear = originalYear;
  let nextDate = anniversary.date;
  if (item.yearly) {
    const max = isLunar ? Math.min(thisYear + 1, LUNAR_MAX_YEAR) : thisYear + 8;
    for (let year = Math.max(thisYear, originalYear); year <= max; year += 1) {
      const candidate = occurrence(anniversary, year);
      if (candidate && candidate >= today) { nextDate = candidate; occurrenceYear = year; break; }
    }
  }
  const daysUntil = ordinal(nextDate) - ordinal(today);
  return {
    ...item, nextDate, daysUntil, isToday: daysUntil === 0, isPast: daysUntil < 0,
    years: occurrenceYear - originalYear,
  };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

/** Returns all useful form errors; providers throw before persisting invalid input. */
export function validateEntry(entry, files = [], config = {}) {
  const errors = [];
  const maxImages = config.maxImages ?? 9;
  const maxFileBytes = config.maxFileBytes ?? 50 * 1024 * 1024;
  if (!entry || typeof entry !== 'object') return { valid: false, errors: ['记录格式无效。'] };
  const media = Array.isArray(entry.media) ? entry.media : [];
  if (!Array.isArray(files)) return { valid: false, errors: ['附件格式无效。'] };
  if (!['note', 'event', 'whisper'].includes(entry.type)) errors.push('请选择日常随记、事件或悄悄话。');
  if (entry.mood !== null && entry.mood !== undefined && !MOODS.includes(entry.mood)) errors.push('心情选项无效。');
  if (entry.content !== undefined && typeof entry.content !== 'string') errors.push('正文必须是文字。');
  if (entry.title !== undefined && typeof entry.title !== 'string') errors.push('标题必须是文字。');
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const content = typeof entry.content === 'string' ? entry.content.trim() : '';
  if (!title && !content && !media.length && !files.length) errors.push('写一点文字，或添加一张图片、一段视频。');
  if (entry.type === 'event' && !title) errors.push('请为事件填写标题。');
  if (title.length > 120) errors.push('标题最多 120 个字符。');
  if (content.length > 20000) errors.push('正文最多 20000 个字符。');
  if (!instant(entry.occurredAt)) errors.push('发生日期无效，请选择真实日期。');
  if (entry.media !== undefined && !Array.isArray(entry.media)) errors.push('已保存附件的格式无效。');
  if (media.some(item => !item || !['image', 'video'].includes(item.type))) errors.push('附件类型无效。');
  if (media.some(item => !Number.isFinite(item.size) || item.size < 0 || item.size > maxFileBytes)) errors.push('已有附件大小无效或超过单文件限制。');
  let images = media.filter(item => item?.type === 'image').length;
  for (const file of files) {
    const type = ALLOWED_FILE_TYPES[file?.type];
    if (!type) errors.push(`不支持附件“${String(file?.name ?? '未命名文件')}”的类型。请使用 JPG、PNG、WebP、GIF、AVIF、MP4、WebM 或 MOV。`);
    if (type === 'image') images += 1;
    if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > maxFileBytes) errors.push(`附件“${String(file?.name ?? '未命名文件')}”为空或超过 ${maxFileBytes === 50_000_000 ? '50 MB' : `${Math.floor(maxFileBytes / 1024 / 1024)} MiB`}。`);
  }
  if (images > maxImages) errors.push(`每条记录最多保存 ${maxImages} 张图片。`);
  if (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.length > MAX_ENTRY_TAGS || entry.tags.some(tag => typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH))) errors.push(`标签格式无效，每条最多 ${MAX_ENTRY_TAGS} 个标签，每个最多 ${MAX_TAG_LENGTH} 个字符。`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/** Presentation guard; production privacy is enforced by database and Storage RLS. */
export function canReadEntry(entry, user) {
  if (!entry || !user?.id) return false;
  if (entry.status === 'draft') return entry.authorId === user.id;
  return entry.type !== 'whisper' || entry.authorId === user.id || user.role === 'admin';
}

export function filterEntries(entries, filters = {}) {
  const query = String(filters.query ?? '').trim().toLocaleLowerCase('zh-CN');
  const tag = typeof filters.tag === 'string' ? filters.tag.trim() : '';
  return (Array.isArray(entries) ? entries : []).filter(entry => {
    if (filters.trash ? !entry.deletedAt : Boolean(entry.deletedAt)) return false;
    if (filters.type && filters.type !== 'all' && entry.type !== filters.type) return false;
    if (filters.mood && filters.mood !== 'all') {
      if (filters.mood === 'unset' ? entry.mood != null : entry.mood !== filters.mood) return false;
    }
    if (filters.authorId && filters.authorId !== 'all' && entry.authorId !== filters.authorId) return false;
    if (filters.favoritesOnly && (!filters.userId || !entry.favoriteBy?.includes(filters.userId))) return false;
    if (filters.month && dayKey(entry.occurredAt).slice(0, 7) !== filters.month) return false;
    if (tag && (!Array.isArray(entry.tags) || !entry.tags.some(value => typeof value === 'string' && value.trim() === tag))) return false;
    if (query && !`${entry.title ?? ''}\n${entry.content ?? ''}\n${(entry.tags ?? []).join(' ')}`.toLocaleLowerCase('zh-CN').includes(query)) return false;
    return true;
  }).sort((a, b) => (instant(b.occurredAt)?.getTime() ?? 0) - (instant(a.occurredAt)?.getTime() ?? 0)
    || (instant(b.createdAt)?.getTime() ?? 0) - (instant(a.createdAt)?.getTime() ?? 0));
}

/** Rank readable tags by active-record use; ignore the selected tag when counting. */
export function collectEntryTags(entries, user, filters = {}) {
  const visible = (Array.isArray(entries) ? entries : []).filter(entry => canReadEntry(entry, user)
    && (entry.status == null || entry.status === 'published'));
  const counts = new Map();
  for (const entry of filterEntries(visible, { ...filters, tag: '' })) {
    const tags = new Set((Array.isArray(entry.tags) ? entry.tags : [])
      .filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim()));
    for (const tag of tags) {
      // Retain scoped recycle-bin options without letting deleted records boost
      // popularity. Ordinary timeline and composer scopes already exclude them.
      counts.set(tag, (counts.get(tag) || 0) + (entry.deletedAt ? 0 : 1));
    }
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)
    || a.localeCompare(b, 'zh-CN') || (a < b ? -1 : a > b ? 1 : 0));
}

export function computeStats(entries, options = {}) {
  const active = filterEntries(entries, { ...(options.filters ?? options), trash: false });
  const stats = { total: active.length, events: 0, days: 0, images: 0, videos: 0,
    moods: { happy: 0, neutral: 0, sad: 0, unset: 0 }, months: [], authors: [] };
  const days = new Set();
  const months = new Map();
  const authors = new Map();
  for (const entry of active) {
    if (entry.type === 'event') stats.events += 1;
    const day = dayKey(entry.occurredAt);
    if (day) { days.add(day); months.set(day.slice(0, 7), (months.get(day.slice(0, 7)) ?? 0) + 1); }
    stats.moods[MOODS.includes(entry.mood) ? entry.mood : 'unset'] += 1;
    stats.images += (entry.media ?? []).filter(media => media.type === 'image').length;
    stats.videos += (entry.media ?? []).filter(media => media.type === 'video').length;
    authors.set(entry.authorId, (authors.get(entry.authorId) ?? 0) + 1);
  }
  stats.days = days.size;
  stats.months = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
  stats.authors = [...authors].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([authorId, count]) => ({ authorId, count }));
  // The denominator excludes entries with an unset mood; it is never the number of days.
  stats.moodSampleSize = stats.moods.happy + stats.moods.neutral + stats.moods.sad;
  return stats;
}
