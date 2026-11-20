import { mountFileDrop } from './file-drop.js';

export function mountEntryBody(container) {
  const textarea = container.querySelector('textarea');
  const grip = container.querySelector('.body-resize');
  let manualHeight = 0;
  let contentHeight = 0;
  let drag;

  function applyHeight() {
    textarea.style.height = `${Math.max(manualHeight, contentHeight)}px`;
  }
  function fitBody() {
    textarea.style.height = '';
    const style = getComputedStyle(textarea);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    contentHeight = textarea.scrollHeight + border;
    applyHeight();
  }

  textarea.addEventListener('input', fitBody);
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    grip.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, y: event.clientY, height: textarea.offsetHeight };
    event.preventDefault();
  });
  grip.addEventListener('pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return;
    manualHeight = Math.max(0, drag.height + event.clientY - drag.y);
    applyHeight();
  });
  grip.addEventListener('lostpointercapture', () => { drag = null; });
  grip.addEventListener('keydown', event => {
    const delta = event.key === 'ArrowDown' ? 26 : event.key === 'ArrowUp' ? -26 : 0;
    if (!delta) return;
    event.preventDefault();
    manualHeight = Math.max(0, textarea.offsetHeight + delta);
    applyHeight();
  });

  fitBody();
  let width = container.clientWidth;
  const observer = new ResizeObserver(() => {
    const currentWidth = container.clientWidth;
    if (width === currentWidth) return;
    width = currentWidth;
    fitBody();
  });
  observer.observe(container);
  return () => observer.disconnect();
}

export function mountEntryUpload(dropzone, addFiles) {
  const input = dropzone.querySelector('input[type=file]');
  const controller = new AbortController();
  const { signal } = controller;

  input.addEventListener('change', () => {
    addFiles(Array.from(input.files));
    input.value = '';
  }, { signal });
  mountFileDrop(dropzone, addFiles, { signal });
  return () => controller.abort();
}
