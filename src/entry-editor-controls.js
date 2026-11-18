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
  const options = { signal: controller.signal };
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');

  input.addEventListener('change', () => {
    addFiles(Array.from(input.files));
    input.value = '';
  }, options);
  for (const type of ['dragenter', 'dragover']) {
    document.addEventListener(type, event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const inside = dropzone.contains(event.target);
      event.dataTransfer.dropEffect = inside ? 'copy' : 'none';
      dropzone.classList.toggle('drag-over', inside);
    }, options);
  }
  dropzone.addEventListener('dragleave', event => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag-over');
  }, options);
  document.addEventListener('drop', event => {
    if (!hasFiles(event) && !event.dataTransfer?.files?.length) return;
    event.preventDefault();
    dropzone.classList.remove('drag-over');
    if (dropzone.contains(event.target)) addFiles(Array.from(event.dataTransfer.files));
  }, options);
  return () => controller.abort();
}
