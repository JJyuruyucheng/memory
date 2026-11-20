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

export function feedDatePickerMarkup(checkin = '') {
  return `<div class="feed-date-title"><h2>日期筛选</h2>${checkin}</div>
    <div class="feed-date-navigation"></div>
    <div id="feed-date-options"></div>
    <div class="feed-date-footer">
      <button type="button" class="text-button" data-action="apply-feed-date" data-value="">全部日期</button>
      <button type="button" class="primary" id="feed-date-whole-month" data-action="apply-feed-date" hidden>筛选整月</button>
    </div>`;
}

export function mountFeedDatePicker(dialog, { selectedMonth, selectedDay, dates }) {
  const grid = dialog.querySelector('#feed-date-options');
  const navigation = dialog.querySelector('.feed-date-navigation');
  const monthButton = dialog.querySelector('#feed-date-whole-month');
  const availableMonths = new Set(Array.from(dates, day => day.slice(0, 7)));
  const today = dayKey(new Date());
  const currentMonth = today.slice(0, 7);
  const yearsWithRecords = [...new Set([today.slice(0, 4), ...[...availableMonths].map(value => value.slice(0, 4))])];
  let month = selectedMonth || currentMonth;
  let year = Number(month.slice(0, 4)), choosingMonth = true;

  function render(focus = '') {
    const stepName = choosingMonth ? '年' : '个月';
    const canStep = offset => choosingMonth ? year + offset >= 1000 && year + offset <= 9999 : shiftCalendarMonth(month, offset) !== month;
    const stepButton = (offset, label) => `<button type="button" class="icon-button${offset < 0 ? ' previous' : ''}"
      data-date-step="${offset}" aria-label="${label}${stepName}" ${canStep(offset) ? '' : 'disabled'}>${icon('chevron')}</button>`;
    const years = [...new Set([String(year), ...yearsWithRecords])].sort().reverse();
    const center = choosingMonth
      ? `<select id="feed-date-year" aria-label="选择年份">${years.map(value => `<option value="${esc(value)}" ${Number(value) === year ? 'selected' : ''}>${value} 年</option>`).join('')}</select>`
      : `<button type="button" class="feed-date-switch" data-show-months aria-label="${monthLabel(month)}，选择月份">${monthLabel(month)}${icon('down')}</button>`;
    navigation.innerHTML = stepButton(-1, choosingMonth ? '上一' : '上') + center + stepButton(1, choosingMonth ? '下一' : '下');
    monthButton.hidden = choosingMonth;
    if (choosingMonth) {
      grid.innerHTML = `<div class="feed-month-grid" role="group" aria-label="${year}年月份">${Array.from({ length: 12 }, (_, index) => {
        const value = `${year}-${String(index + 1).padStart(2, '0')}`;
        const recorded = availableMonths.has(value);
        return `<button type="button" data-choose-month="${value}" class="feed-month${recorded ? ' has-memory' : ''}"
          aria-label="${monthLabel(value)}${recorded ? '，有回忆' : ''}" aria-pressed="${value === selectedMonth}"
          ${value === currentMonth ? 'aria-current="date"' : ''}>${index + 1} 月</button>`;
      }).join('')}</div>`;
    } else {
      const tabbableDay = focus.length === 10 && focus.startsWith(month) ? focus
        : [selectedDay, today].find(day => day?.startsWith(`${month}-`)) || `${month}-01`;
      grid.innerHTML = calendarGrid(month, { dates, selectedDay, today, focusDay: tabbableDay, dayAction: 'apply-feed-date' });
      monthButton.dataset.value = month;
      monthButton.setAttribute('aria-label', `筛选整月，${monthLabel(month)}`);
    }
    let focusTarget;
    if (focus === 'options') {
      focusTarget = choosingMonth ? grid.querySelector(`[data-choose-month="${month}"]`)
        || grid.querySelector('[data-choose-month]') : grid.querySelector('.calendar-day:not([tabindex="-1"])');
    } else if (focus.length === 10 && focus.startsWith(month)) {
      focusTarget = grid.querySelector(`[data-value="${focus}"]`);
    } else if (focus) {
      focusTarget = navigation.querySelector(focus) || navigation.querySelector('select, .feed-date-switch');
    }
    focusTarget?.focus({ preventScroll: true });
  }

  navigation.addEventListener('change', event => {
    year = Number(event.target.value);
    render('#feed-date-year');
  });
  navigation.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-show-months')) {
      year = Number(month.slice(0, 4)); choosingMonth = true;
      render('options');
      return;
    }
    const offset = Number(button.dataset.dateStep);
    if (choosingMonth) year += offset;
    else month = shiftCalendarMonth(month, offset);
    render(`[data-date-step="${offset}"]:not(:disabled)`);
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-choose-month]');
    if (!button) return;
    month = button.dataset.chooseMonth;
    choosingMonth = false;
    render('options');
  });
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
  });

  render('#feed-date-year');
}
