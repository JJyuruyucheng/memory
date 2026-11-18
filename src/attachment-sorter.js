// Official SortableJS, pinned locally so editing never depends on a public CDN.
import { loadLocalScript } from './local-script.js';

export async function mountAttachmentSorter(target, onOrder, onError = () => {}) {
  if (!target || target.children.length < 2) return;
  try {
    const Sortable = await loadLocalScript({ url: new URL('../assets/sortable-1.15.7.js', import.meta.url), read: () => globalThis.Sortable, label: '附件排序组件' });
    if (!target.isConnected) return;
    target.memorySorter?.destroy();
    const touch = matchMedia('(any-pointer: coarse)').matches;
    target.memorySorter = new Sortable(target, {
      handle: touch ? '.attachment-preview' : '.preview-handle',
      filter: '.preview-remove', preventOnFilter: false, draggable: '.attachment-preview', dataIdAttr: 'data-key',
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150,
      forceFallback: touch, delay: 320, delayOnTouchOnly: true, touchStartThreshold: 5, fallbackTolerance: 4,
      ghostClass: 'preview-ghost', chosenClass: 'preview-chosen', fallbackClass: 'preview-lifted',
      onEnd(event) {
        if (event.oldIndex !== event.newIndex) onOrder([...target.children].map(item => item.dataset.key));
      },
    });
  } catch { if (target.isConnected) onError(new Error('附件拖动暂时不可用，可聚焦排序按钮后按方向键调整。')); }
}

export function destroyAttachmentSorter(root) {
  root.querySelectorAll('.editor-previews').forEach(target => { target.memorySorter?.destroy(); delete target.memorySorter; });
}
