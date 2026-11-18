import { dayKey, escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';

const firstDay = '1000-01-01';
const lastDay = '9999-12-31';
const monthLabel = month => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;

export function shiftCalendarMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return month;
  return date.toISOString().slice(0, 7);
}

export function calendarGrid(month, { dates, selectedDay, today = dayKey(new Date()), focusDay = '', dayAction = 'calendar-day' }) {
  const [year, number] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const offset = (start.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'].map(day => `<span class="weekday">${day}</span>`).join('');
  const buttons = Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const recorded = dates.has(key);
    const selected = key === selectedDay;
    return `<button type="button" data-action="${dayAction}" data-value="${key}"
      class="calendar-day${recorded ? ' has-memory' : ''}${key === today ? ' today' : ''}${selected ? ' selected' : ''}"
      aria-label="${key}${recorded ? '，有回忆' : ''}" aria-pressed="${selected}"
      ${key === today ? 'aria-current="date"' : ''} ${focusDay && key !== focusDay ? 'tabindex="-1"' : ''}>${day}</button>`;
  }).join('');
  return `<div class="calendar-grid">${weekdays}${'<span></span>'.repeat(offset)}${buttons}</div>`;
}

export function feedDatePickerMarkup() {
  return `<h2>日期筛选</h2>
    <div class="feed-date-navigation">
      <button type="button" class="icon-button previous" data-month-step="-1" aria-label="上个月">${icon('chevron')}</button>
      <select id="feed-date-month" aria-label="选择月份" autofocus></select>
      <button type="button" class="icon-button" data-month-step="1" aria-label="下个月">${icon('chevron')}</button>
    </div>
    <div id="feed-date-days"></div>
    <div class="feed-date-footer">
      <button type="button" class="text-button" data-action="apply-feed-date" data-value="">全部日期</button>
      <button type="button" class="primary" id="feed-date-whole-month" data-action="apply-feed-date">筛选整月</button>
    </div>`;
}

export function mountFeedDatePicker(dialog, { initialMonth, selectedDay, dates }) {
  const grid = dialog.querySelector('#feed-date-days');
  const select = dialog.querySelector('#feed-date-month');
  const monthButton = dialog.querySelector('#feed-date-whole-month');
  const navigation = dialog.querySelectorAll('[data-month-step]');
  const availableMonths = new Set(Array.from(dates, day => day.slice(0, 7)));
  const today = dayKey(new Date());
  let month = initialMonth;

  function render(focusDay = '') {
    const months = [...new Set([month, today.slice(0, 7), ...availableMonths])].sort().reverse();
    select.innerHTML = months.map(value => `<option value="${esc(value)}">${monthLabel(value)}</option>`).join('');
    select.value = month;
    const tabbableDay = focusDay || [selectedDay, today].find(day => day.startsWith(`${month}-`)) || `${month}-01`;
    grid.innerHTML = calendarGrid(month, { dates, selectedDay, today, focusDay: tabbableDay, dayAction: 'apply-feed-date' });
    monthButton.dataset.value = month;
    monthButton.setAttribute('aria-label', `筛选整月，${monthLabel(month)}`);
    for (const button of navigation) button.disabled = shiftCalendarMonth(month, Number(button.dataset.monthStep)) === month;
  }

  select.addEventListener('change', () => { month = select.value; render(); });
  for (const button of navigation) {
    button.addEventListener('click', () => { month = shiftCalendarMonth(month, Number(button.dataset.monthStep)); render(); });
  }
  const daySteps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  grid.addEventListener('keydown', event => {
    const button = event.target.closest('button[data-value]');
    const step = daySteps[event.key];
    if (!button || !step) return;
    event.preventDefault();
    const date = new Date(`${button.dataset.value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + step);
    const key = date.toISOString().slice(0, 10);
    if (key < firstDay || key > lastDay || date.getUTCFullYear() > 9999) return;
    month = key.slice(0, 7);
    render(key);
    grid.querySelector(`[data-value="${key}"]`)?.focus({ preventScroll: true });
  });

  render();
}
