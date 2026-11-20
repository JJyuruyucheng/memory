export function mountFileDrop(dropzone, addFiles, { signal, enabled = () => true }) {
  const document = dropzone.ownerDocument;
  const options = { signal };
  const hasFiles = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const stopFeedback = () => dropzone.classList.remove('drag-over');

  for (const type of ['dragenter', 'dragover']) {
    document.addEventListener(type, event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const inside = enabled() && dropzone.contains(event.target);
      event.dataTransfer.dropEffect = inside ? 'copy' : 'none';
      dropzone.classList.toggle('drag-over', inside);
    }, options);
  }
  dropzone.addEventListener('dragleave', event => {
    if (!dropzone.contains(event.relatedTarget)) stopFeedback();
  }, options);
  document.addEventListener('drop', event => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!hasFiles(event) && !files.length) return;
    event.preventDefault();
    stopFeedback();
    if (enabled() && dropzone.contains(event.target)) addFiles(files);
  }, options);
  signal.addEventListener('abort', stopFeedback, { once: true });
}
