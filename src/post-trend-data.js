import { dayKey } from './domain.js';

const isMonth = value => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && dayKey(`${value}-01`) === `${value}-01`;
const monthLabel = month => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;

function monthPeriods(currentMonth) {
  const [year, month] = currentMonth.split('-').map(Number);
  const current = year * 12 + month - 1;
  return Array.from({ length: 6 }, (_, offset) => {
    const index = current - 5 + offset;
    const monthNumber = index % 12 + 1;
    const key = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}`;
    return { key, label: `${monthNumber}月`, dateLabel: monthLabel(key) };
  });
}

function weekPeriods(month) {
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: Math.ceil(days / 7) }, (_, index) => {
    const start = index * 7 + 1;
    const end = Math.min(start + 6, days);
    const label = start === end ? `${start}日` : `${start}—${end}日`;
    return { label, dateLabel: `${monthLabel(month)}${label}` };
  });
}

/**
 * Count shared posts by their Shanghai creation day, using only supplied records.
 * Legacy records without createdAt use occurredAt; malformed creation dates are skipped.
 * Member order is preserved, and even an accidentally supplied admin has no series data.
 */
export function computePostTrend(entries, members, selectedMonth, now = new Date()) {
  const series = (Array.isArray(members) ? members : []).slice(0, 2);
  const month = isMonth(selectedMonth) ? selectedMonth : '';
  const currentMonth = dayKey(now).slice(0, 7);
  const definitions = month ? weekPeriods(month) : isMonth(currentMonth) ? monthPeriods(currentMonth) : [];
  const periods = definitions.map(({ label, dateLabel }) => ({ label, dateLabel, counts: series.map(() => 0) }));
  const totals = series.map(() => 0);
  const authorIndexes = new Map();
  series.forEach((member, index) => {
    if (typeof member?.id === 'string' && member.id && member.role !== 'admin' && !authorIndexes.has(member.id)) authorIndexes.set(member.id, index);
  });
  const monthIndexes = new Map(definitions.map((period, index) => [period.key, index]));

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !['note', 'event'].includes(entry.type) || entry.deletedAt
      || (entry.status != null && entry.status !== 'published')) continue;
    const author = authorIndexes.get(entry.authorId);
    if (author === undefined) continue;
    const date = dayKey(entry.createdAt == null || entry.createdAt === '' ? entry.occurredAt : entry.createdAt);
    if (!date) continue;
    const index = month
      ? date.slice(0, 7) === month ? Math.floor((Number(date.slice(8)) - 1) / 7) : undefined
      : monthIndexes.get(date.slice(0, 7));
    if (index === undefined || !periods[index]) continue;
    periods[index].counts[author] += 1;
    totals[author] += 1;
  }

  return { periods, totals, scopeLabel: month ? monthLabel(month) : '近六个月', unitLabel: '条' };
}
