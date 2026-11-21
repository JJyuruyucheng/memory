import { mountDatePickers } from './date-pickers.js';
import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { LUNAR_MAX_YEAR, LUNAR_MIN_YEAR, lunarToSolar, solarToLunar } from './lunar-calendar.js';

const monthNames = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const dayNames = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];
const selectOptions = (names, selected) =>
  names.map((name, index) => `<option value="${index + 1}"${selected === index + 1 ? ' selected' : ''}>${name}</option>`).join('');
const field = (row, name) => row.querySelector(`[name="ann-${name}"]`);
const dateMode = row => field(row, 'calendar').value;
const readLunar = row => ({
  year: Number(field(row, 'year').value),
  month: Number(field(row, 'month').value),
  day: Number(field(row, 'day').value),
  leap: field(row, 'leap').checked,
});

export function anniversaryFields(a = {}) {
  const lunar = a.calendar === 'lunar';
  const parts = lunar ? a.lunar ?? {} : {};
  const dateAttrs = lunar ? ' disabled' : ' required';
  const lunarAttrs = lunar ? ' required' : ' disabled';
  const leapAvailable = lunar && Boolean(lunarToSolar({ year: parts.year, month: parts.month, day: 1, leap: true }));
  return `<div class="anniversary-fields" data-anniversary="${esc(a.id || crypto.randomUUID())}">
    <button type="button" class="icon-button anniversary-grip" aria-label="排序${esc(a.title || '此纪念日')}，按上下方向键移动" title="拖动排序">${icon('grip')}</button>
    <label class="anniversary-name"><span class="sr-only">纪念日名字</span><input name="ann-title" placeholder="例如：第一次见面" value="${esc(a.title || '')}" maxlength="40" required /></label>
    <label class="anniversary-calendar"><span class="sr-only">历法</span><select name="ann-calendar">
      <option value="solar"${lunar ? '' : ' selected'}>公历</option><option value="lunar"${lunar ? ' selected' : ''}>农历</option>
    </select></label>
    <button type="button" class="icon-button" data-action="remove-anniversary" aria-label="移除纪念日">${icon('close')}</button>
    <div class="anniversary-date-fields">
      <label class="anniversary-solar-date" data-ann-solar${lunar ? ' hidden' : ''}><span class="sr-only">纪念日期</span><input name="ann-date" type="date" value="${esc(a.date || '')}"${dateAttrs} /></label>
      <div class="anniversary-lunar-date" data-ann-lunar${lunar ? '' : ' hidden'}>
        <label><span class="sr-only">农历年份</span><input name="ann-year" type="number" min="${LUNAR_MIN_YEAR}" max="${LUNAR_MAX_YEAR}" step="1" inputmode="numeric" placeholder="年份" value="${esc(parts.year ?? '')}"${lunarAttrs} /></label>
        <label><span class="sr-only">农历月份</span><select name="ann-month"${lunarAttrs}><option value="">月份</option>${selectOptions(monthNames, parts.month)}</select></label>
        <label><span class="sr-only">农历日期</span><select name="ann-day"${lunarAttrs}><option value="">日</option>${selectOptions(dayNames, parts.day)}</select></label>
        <div class="anniversary-lunar-detail"><label class="checkbox-label" title="所选农历年有此闰月时可勾选"><input type="checkbox" name="ann-leap"${parts.leap ? ' checked' : ''}${leapAvailable ? '' : ' disabled'} />闰月</label>
          <output class="anniversary-equivalent" aria-live="polite" data-ann-equivalent>${lunar && a.date ? `对应公历 ${esc(a.date)}` : ''}</output></div>
      </div>
      <label class="checkbox-label anniversary-yearly"><input type="checkbox" name="ann-yearly" ${a.yearly ? 'checked' : ''} />每年</label>
    </div>
  </div>`;
}

function showLunarDate(row, resetLeap = false) {
  const lunar = readLunar(row);
  const leapInput = field(row, 'leap');
  const day = field(row, 'day');
  const output = row.querySelector('[data-ann-equivalent]');
  const hasLeapMonth = Boolean(lunarToSolar({ ...lunar, day: 1, leap: true }));
  leapInput.disabled = !hasLeapMonth;
  if (resetLeap && !hasLeapMonth && lunar.leap) {
    leapInput.checked = false;
    lunar.leap = false;
  }
  const monthStart = lunarToSolar({ ...lunar, day: 1 });
  day.querySelector('[value="30"]').disabled = Boolean(monthStart) && !lunarToSolar({ ...lunar, day: 30 });
  const complete = Boolean(lunar.year && lunar.month && lunar.day);
  const date = complete ? lunarToSolar(lunar) : '';
  const error = complete && !date ? '请选择有效的农历日期。' : '';
  day.setCustomValidity(error);
  output.textContent = date ? `对应公历 ${date}` : error;
}

function prefillLunar(row) {
  if (['year', 'month', 'day'].some(name => field(row, name).value)) return;
  const date = field(row, 'date').value;
  const equivalent = date ? solarToLunar(date) : null;
  if (equivalent) {
    for (const name of ['year', 'month', 'day']) field(row, name).value = equivalent[name];
    field(row, 'leap').checked = equivalent.leap;
  } else if (!date) {
    field(row, 'year').value = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date());
  }
}

function showMode(row) {
  const lunar = dateMode(row) === 'lunar';
  const solarGroup = row.querySelector('[data-ann-solar]');
  const lunarGroup = row.querySelector('[data-ann-lunar]');
  solarGroup.hidden = lunar;
  lunarGroup.hidden = !lunar;
  for (const input of solarGroup.querySelectorAll('input')) {
    input.disabled = lunar;
    input.required = !lunar;
  }
  for (const name of ['year', 'month', 'day']) {
    const input = field(row, name);
    input.disabled = !lunar;
    input.required = lunar;
  }
  field(row, 'leap').disabled = true;
  if (lunar) showLunarDate(row);
}

export function mountAnniversaryEditor(container) {
  if (!container) return;
  const events = new AbortController(), { signal } = events;
  for (const row of container.querySelectorAll('[data-anniversary]')) showMode(row);
  container.addEventListener('change', ({ target }) => {
    const row = target.closest('[data-anniversary]');
    if (!row) return;
    if (target.name === 'ann-calendar') {
      if (dateMode(row) === 'lunar') prefillLunar(row);
      showMode(row);
      if (dateMode(row) === 'solar') void mountDatePickers(row);
    } else if (dateMode(row) === 'lunar' && ['ann-year', 'ann-month', 'ann-day', 'ann-leap'].includes(target.name)) {
      showLunarDate(row, ['ann-year', 'ann-month'].includes(target.name));
    }
  }, { signal });
  return () => events.abort();
}

export function readAnniversaries(container) {
  return [...container.querySelectorAll('[data-anniversary]')].map(row => {
    const title = field(row, 'title').value.trim();
    if (!title) throw new Error('请填写纪念日名字。');
    const yearly = field(row, 'yearly').checked;
    const result = { id: row.dataset.anniversary, title, date: field(row, 'date').value, yearly };
    if (dateMode(row) === 'lunar') {
      const lunar = readLunar(row), date = lunarToSolar(lunar);
      if (!date) throw new Error(`请为「${title}」选择有效的农历日期。`);
      return { ...result, date, calendar: 'lunar', lunar };
    }
    if (!result.date) throw new Error(`请为「${title}」选择日期。`);
    return result;
  });
}
