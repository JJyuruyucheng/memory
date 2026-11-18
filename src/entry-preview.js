import { escapeHtml as esc } from './domain.js';
import { renderEntryText } from './daily-report.js';
import { icon } from './icons.js';

export function entryPreviewMarkup(entry) {
  const contentId = `entry-text-${esc(encodeURIComponent(entry.id))}`;
  return `<div class="entry-preview" data-entry-id="${esc(entry.id)}">
    <div id="${contentId}" class="entry-preview-text"><p class="memory-text">${renderEntryText(entry.title, entry.content)}</p></div>
    <button type="button" class="entry-preview-toggle" aria-controls="${contentId}" aria-expanded="false" hidden>
      <span>展开全文</span>${icon('down')}
    </button>
  </div>`;
}

export function mountEntryPreviews(root, expanded) {
  const syncPreview = new Map();
  const observer = new ResizeObserver(changes => {
    for (const { target } of changes) syncPreview.get(target)?.();
  });
  for (const preview of root.querySelectorAll('.entry-preview')) {
    const { entryId } = preview.dataset;
    const text = preview.querySelector('.memory-text');
    const toggle = preview.querySelector('.entry-preview-toggle');
    const label = toggle.querySelector('span');
    const update = () => {
      const cutoff = Math.ceil(parseFloat(getComputedStyle(text).lineHeight) * 9);
      const canExpand = text.offsetHeight > cutoff + 1;
      const isExpanded = expanded.has(entryId);
      preview.style.setProperty('--entry-preview-height', `${cutoff}px`);
      preview.classList.toggle('is-collapsed', canExpand && !isExpanded);
      toggle.hidden = !canExpand;
      toggle.setAttribute('aria-expanded', String(isExpanded));
      label.textContent = isExpanded ? '收起全文' : '展开全文';
    };
    update();
    syncPreview.set(text, update);
    observer.observe(text);
    toggle.addEventListener('click', () => {
      const wasExpanded = expanded.delete(entryId);
      if (!wasExpanded) expanded.add(entryId);
      update();
      if (wasExpanded) toggle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  return () => observer.disconnect();
}
