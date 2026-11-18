export function mountTagOverflow(row, expanded, onToggle) {
  if (!row) return () => {};
  const list = row.querySelector('.feed-tag-items');
  const toggle = row.querySelector('.feed-tag-toggle');
  const tags = Array.from(list.querySelectorAll('button'));
  let width = 0;

  function layout() {
    for (const tag of tags) tag.hidden = false;
    toggle.hidden = true;
    const firstTop = tags[0].offsetTop;
    if (tags.at(-1).offsetTop === firstTop) return;

    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? '收起' : '展开';
    if (!expanded) {
      const top = tags[0].offsetTop;
      for (const tag of tags.filter(tag => tag.offsetTop > top)) tag.hidden = true;
    }
  }

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    onToggle(expanded);
    layout();
  });
  const observer = new ResizeObserver(() => {
    if (width === row.clientWidth) return;
    width = row.clientWidth;
    layout();
  });
  layout();
  width = row.clientWidth;
  observer.observe(row);
  return () => observer.disconnect();
}
