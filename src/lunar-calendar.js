import { LUNAR_FIRST_YEAR, lunarYearData } from './lunar-calendar-data.js';

export const LUNAR_MIN_YEAR = LUNAR_FIRST_YEAR;
export const LUNAR_MAX_YEAR = LUNAR_FIRST_YEAR + lunarYearData.length - 1;
const dayMs = 86_400_000;
const monthNames = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '腊'];
const numberNames = '一二三四五六七八九十';
const firstDay = iso => Date.parse(`${iso}T00:00:00Z`);
const yearData = year => Number.isInteger(year) ? lunarYearData[year - LUNAR_FIRST_YEAR] : null;

export function lunarToSolar({ year, month, day, leap } = {}) {
  const row = yearData(year);
  if (!row || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || typeof leap !== 'boolean') return '';
  const [start, leapMonth, lengths] = row;
  if (leap && month !== leapMonth) return '';
  const index = month - 1 + Number(leap || (leapMonth > 0 && month > leapMonth));
  if (day > lengths[index]) return '';
  const offset = lengths.slice(0, index).reduce((sum, length) => sum + length, day - 1);
  return new Date(firstDay(start) + offset * dayMs).toISOString().slice(0, 10);
}

export function solarToLunar(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return null;
  const date = firstDay(iso);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== iso) return null;
  let year = Number(iso.slice(0, 4));
  if (year === LUNAR_MAX_YEAR + 1 || (yearData(year) && iso < yearData(year)[0])) year--;
  const row = yearData(year);
  if (!row) return null;
  const [start, leapMonth, lengths] = row;
  let offset = (date - firstDay(start)) / dayMs;
  for (const [index, length] of lengths.entries()) {
    if (offset < length) {
      const month = index + 1 - Number(leapMonth > 0 && index >= leapMonth);
      return { year, month, day: offset + 1, leap: leapMonth > 0 && index === leapMonth };
    }
    offset -= length;
  }
  return null;
}

export function lunarAnniversaryInYear(lunar, year) {
  const leap = lunar.leap && yearData(year)?.[1] === lunar.month;
  const date = { ...lunar, year, leap };
  return lunarToSolar(date) || (date.day === 30 ? lunarToSolar({ ...date, day: 29 }) : '');
}

export function lunarDateLabel(lunar) {
  const { year, month, day, leap } = lunar;
  const dayName = day <= 10 ? `初${numberNames[day - 1]}` : day < 20 ? `十${numberNames[day - 11]}`
    : day === 20 ? '二十' : day === 30 ? '三十' : `廿${numberNames[day - 21]}`;
  return `农历 ${year} 年${leap ? '闰' : ''}${monthNames[month - 1]}月${dayName}`;
}
