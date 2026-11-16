// Air Datepicker 3.6.0 (MIT), locally vendored from the upstream GitHub release.
let loading;
const mounted = new Set();
const locale = {
  days: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
  daysShort: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  daysMin: ['日', '一', '二', '三', '四', '五', '六'],
  months: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
  monthsShort: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
  today: '今天', clear: '清空', dateFormat: 'yyyy-MM-dd', timeFormat: 'HH:mm', firstDay: 1,
};
const pad = value => String(value).padStart(2, '0');
const currentDate = () => parsePickerDate(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()), 'datetime-local');
export function formatPickerDate(date, kind) {
  const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return kind === 'month' ? month : `${month}-${pad(date.getDate())}${kind === 'datetime-local' ? `T${pad(date.getHours())}:${pad(date.getMinutes())}` : ''}`;
}
export function parsePickerDate(value, kind) {
  const match = (kind === 'month' ? /^(\d{4})-(\d{2})$/ : kind === 'date' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/).exec(value);
  if (!match) return null;
  const [, y, m, d = '01', h = '00', minute = '00'] = match;
  if (+y < 1000 || +y > 9999) return null;
  const date = new Date(+y, +m - 1, +d, +h, +minute);
  return formatPickerDate(date, kind) === value.replace(' ', 'T') ? date : null;
}
function load() {
  if (globalThis.AirDatepicker) return Promise.resolve(globalThis.AirDatepicker);
  if (!loading) loading = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('../assets/air-datepicker-3.6.0.css', import.meta.url).href;
    css.dataset.datepickerVendor = ''; document.head.append(css);
    const script = document.createElement('script'); script.src = new URL('../assets/air-datepicker-3.6.0.js', import.meta.url).href;
    const fail = () => { clearTimeout(timer); script.remove(); css.remove(); loading = null; reject(Error('日期组件加载失败')); };
    const timer = setTimeout(fail, 15000);
    script.onload = () => { clearTimeout(timer); typeof globalThis.AirDatepicker === 'function' ? resolve(globalThis.AirDatepicker) : fail(); };
    script.onerror = fail; document.head.append(script);
  });
  return loading;
}
export function destroyDatePickers(root) {
  for (const record of mounted) if (!record.input.isConnected || root?.contains(record.input)) {
    record.picker.destroy(); record.host.remove(); mounted.delete(record);
  }
}
export async function mountDatePickers(root = document) {
  destroyDatePickers();
  const inputs = [...root.querySelectorAll('input[type="date"],input[type="datetime-local"],input[type="month"]')].filter(input => !input.dataset.pickerMounted && !input.matches(':disabled'));
  if (!inputs.length) return;
  let Picker;
  try { Picker = await load(); } catch { return; } // Native controls remain usable if the local asset fails.
  for (const input of inputs) {
    if (!input.isConnected || input.dataset.pickerMounted || input.matches(':disabled')) continue;
    const kind = input.type, initial = parsePickerDate(input.value, kind);
    const display = document.createElement('input');
    display.type = 'text'; display.className = `${input.className} date-picker-input`; display.value = input.value.replace('T', ' ');
    display.autocomplete = 'off'; display.required = input.required;
    display.placeholder = kind === 'month' ? '选择月份' : kind === 'date' ? '选择日期' : '选择日期和时间';
    display.setAttribute('aria-label', input.getAttribute('aria-label') || input.closest('label')?.textContent.trim() || display.placeholder);
    display.setAttribute('aria-haspopup', 'dialog'); display.setAttribute('aria-expanded', 'false');
    input.type = 'hidden'; input.dataset.pickerMounted = kind; input.after(display);
    // A host inside the modal keeps the picker in the dialog's top layer.
    const host = document.createElement('div'); host.className = 'date-picker-host';
    (input.closest('dialog') || document.body).append(host);
    let record;
    const write = date => {
      input.value = date ? formatPickerDate(date, kind) : '';
      display.setCustomValidity(!date && input.required ? '请选择有效的日期。' : '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const picker = new Picker(display, {
      locale, container: host, classes: 'chaoxi-datepicker',
      selectedDates: initial ? [initial] : [], startDate: initial || currentDate(),
      view: kind === 'month' ? 'months' : 'days', minView: kind === 'month' ? 'months' : 'days',
      dateFormat: kind === 'month' ? 'yyyy-MM' : 'yyyy-MM-dd', timepicker: kind === 'datetime-local',
      timeFormat: 'HH:mm', dateTimeSeparator: ' ', minutesStep: 1, maxHours: 23,
      autoClose: kind !== 'datetime-local', toggleSelected: false, fixedHeight: true,
      minDate: input.min ? parsePickerDate(input.min, kind) : '', maxDate: input.max ? parsePickerDate(input.max, kind) : '',
      navTitles: { days: 'yyyy 年 MMMM', months: 'yyyy 年', years: 'yyyy1 — yyyy2' },
      buttons: [
        { content: kind === 'datetime-local' ? '此刻' : kind === 'month' ? '本月' : '今天', onClick: dp => { dp.selectDate(currentDate()); dp.setViewDate(currentDate()); } },
        ...(!input.required ? ['clear'] : []),
        { content: '确定', onClick: dp => { if (!dp.selectedDates.length) dp.selectDate(currentDate()); dp.hide(); display.blur(); } },
      ],
      position({ $datepicker, $target, $pointer }) {
        const box = $target.getBoundingClientRect(), width = $datepicker.offsetWidth, height = $datepicker.offsetHeight;
        const top = box.bottom + 8 + height <= innerHeight ? box.bottom + 8 : Math.max(8, box.top - height - 8);
        $datepicker.style.position = 'fixed'; $datepicker.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`; $datepicker.style.top = `${top}px`; $pointer.style.display = 'none';
      },
      onSelect: ({ date }) => write(date || null),
      onShow: () => { for (const other of mounted) if (other !== record) other.picker.hide(); display.setAttribute('aria-expanded', 'true'); },
      onHide: () => display.setAttribute('aria-expanded', 'false'),
    });
    display.addEventListener('change', event => {
      if (!event.isTrusted) return;
      // The library fires change itself; genuine edits are parsed strictly as local time.
      const date = parsePickerDate(display.value, kind);
      if (!date && display.value) { input.value = ''; display.setCustomValidity('请按示例填写有效日期，如 2026-11-16。'); return; }
      if (date) picker.selectDate(date, { silent: true }); else picker.clear({ silent: true });
      write(date);
    });
    display.addEventListener('keydown', event => { if (event.key === 'Escape' && picker.visible) { event.preventDefault(); event.stopPropagation(); picker.hide(); } });
    record = { input, display, picker, host }; mounted.add(record);
  }
}
