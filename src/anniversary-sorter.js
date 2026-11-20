import { loadLocalScript } from './local-script.js';

export function mountAnniversarySorter(list) {
  if (!list) return;
  const events = new AbortController(), { signal } = events;
  const handle = '.anniversary-grip';
  let sorter;

  list.addEventListener('keydown', event => {
    const grip = event.target.closest(handle);
    if (!grip || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const row = grip.closest('[data-anniversary]');
    const rows = [...list.children];
    const from = rows.indexOf(row);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : from + (event.key === 'ArrowUp' ? -1 : 1);
    if (from === to || !rows[to]) return;
    list.insertBefore(row, to < from ? rows[to] : rows[to].nextElementSibling);
    grip.focus({ preventScroll: true });
    list.nextElementSibling.textContent = `纪念日已移到第 ${to + 1} 项`;
  }, { signal });

  void loadLocalScript({ url: new URL('../assets/sortable-1.15.7.js', import.meta.url), read: () => globalThis.Sortable, label: '纪念日排序组件' })
    .then(Sortable => {
      if (signal.aborted) return;
      sorter = new Sortable(list, {
        handle, draggable: '[data-anniversary]', direction: 'vertical', forceFallback: true,
        fallbackOnBody: true, fallbackTolerance: 4, delay: 180, delayOnTouchOnly: true,
        ghostClass: 'anniversary-sort-ghost', fallbackClass: 'anniversary-sort-fallback',
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
        onEnd(event) {
          if (event.newIndex !== event.oldIndex) list.nextElementSibling.textContent = `纪念日已移到第 ${event.newIndex + 1} 项`;
        },
      });
    }).catch(() => {});
  return () => { events.abort(); sorter?.destroy(); };
}
