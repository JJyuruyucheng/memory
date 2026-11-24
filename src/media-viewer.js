import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { loadLocalScript } from './local-script.js';

/** Reuse already-authorized media; never turn an arbitrary address into a download link. */
export function mediaViewerUrl(value, base = globalThis.location?.href) {
  if (typeof value !== 'string' || !value.trim() || !base) return '';
  try {
    const page = new URL(base), url = new URL(value, page);
    if (!['http:', 'https:'].includes(page.protocol) || url.username || url.password) return '';
    return url.origin === page.origin && ['http:', 'https:', 'blob:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function mediaDownloadName(value, type = 'image') {
  const video = type === 'video', fallback = video ? '朝夕-视频' : '朝夕-照片';
  let name = String(value || '').split(/[\\/]/).pop()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/[. ]+$/g, '');
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const allowed = video ? ['mp4', 'webm', 'mov'] : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
  const suffix = allowed.includes(extension) ? extension : video ? 'mp4' : 'jpg';
  name = name.replace(/\.[^.]+$/, '').replace(/^\.+/, '').trim();
  if (!name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = fallback;
  return `${Array.from(name).slice(0, 100).join('')}.${suffix}`;
}

export function mediaViewerMarkup({ file, title = '', date = '', index = 0, count = 1, entryId = '', linkToEntry = false }, base) {
  const url = mediaViewerUrl(file?.url, base), video = file?.type === 'video';
  const download = url ? `<a class="media-viewer-download" href="${esc(url)}" download="${esc(mediaDownloadName(file?.name, file?.type))}">${icon('download')}<span>下载</span></a>` : '';
  const entryLink = linkToEntry && entryId ? `<a class="media-viewer-post" href="#timeline?entry=${encodeURIComponent(entryId)}">查看原帖</a>` : '';
  return `<div class="media-viewer-stage ${video ? 'is-video' : ''}" data-media-stage ${video ? '' : 'tabindex="0" role="region" aria-label="图片预览，可缩放和拖动"'}>${url ? video ? `<video controls playsinline preload="metadata" src="${esc(url)}"></video>` : `<div class="media-viewer-canvas"><img class="media-viewer-image" src="${esc(url)}" alt="${esc(file?.name || title || '回忆照片')}" draggable="false" /></div>` : '<p class="media-viewer-invalid">这份附件暂时无法显示。</p>'}</div>
    <div class="media-viewer-toolbar">${!video && url ? `<div class="media-viewer-zoom" aria-label="图片缩放"><button type="button" data-viewer-action="zoom-out" aria-label="缩小图片" disabled><span aria-hidden="true">−</span></button><output data-media-scale aria-label="缩放比例">100%</output><button type="button" data-viewer-action="zoom-in" aria-label="放大图片" disabled>${icon('plus')}</button><button type="button" class="media-viewer-fit" data-viewer-action="reset" disabled>适应</button></div>` : ''}${download}</div>
    ${!video && url ? '<div class="media-viewer-status" role="status"><span data-media-message>正在准备缩放…</span><button type="button" data-viewer-action="retry" hidden>重试</button></div>' : ''}
    <div class="media-viewer-caption"><div><strong>${esc(title || '日常的一帧')}</strong><small>${esc(date)} · ${index + 1} / ${count}</small></div><div class="media-viewer-navigation">${entryLink}${index > 0 ? `<button type="button" class="previous" data-action="media" data-id="${esc(entryId)}" data-index="${index - 1}" aria-label="上一张">${icon('chevron')}</button>` : ''}${index < count - 1 ? `<button type="button" data-action="media" data-id="${esc(entryId)}" data-index="${index + 1}" aria-label="下一张">${icon('chevron')}</button>` : ''}</div></div>`;
}

const loadPanzoom = () => loadLocalScript({ url: new URL('../assets/panzoom-4.6.2.js', import.meta.url), read: () => typeof globalThis.Panzoom === 'function' ? globalThis.Panzoom : null, label: '图片缩放组件' });

/** The caller owns the source URL. Destroying a viewer must never revoke a shared media URL. */
export function mountMediaViewer(root, { load = loadPanzoom, window: view = globalThis.window } = {}) {
  const events = new AbortController(), signal = events.signal;
  const stage = root?.querySelector('[data-media-stage]'), canvas = root?.querySelector('.media-viewer-canvas'), image = root?.querySelector('.media-viewer-image'), video = root?.querySelector('video');
  const output = root?.querySelector('[data-media-scale]'), status = root?.querySelector('.media-viewer-status');
  const message = root?.querySelector('[data-media-message]'), retry = root?.querySelector('[data-viewer-action="retry"]');
  const controls = [...(root?.querySelectorAll('[data-viewer-action]:not([data-viewer-action="retry"])') || [])];
  let destroyed = false, panzoom, loading = false, observer, imageReady = Boolean(image?.complete && image.naturalWidth > 0);
  const current = () => !destroyed && root?.isConnected;
  const motion = () => !view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const inform = (text = '', canRetry = false) => {
    if (!current()) return;
    if (status) status.hidden = !text;
    if (message) message.textContent = text;
    if (retry) retry.hidden = !canRetry;
  };
  const update = () => {
    if (!current() || !panzoom) return;
    const scale = panzoom.getScale(), max = panzoom.getOptions().maxScale;
    if (scale <= 1.001) {
      const { x, y } = panzoom.getPan();
      if (x || y) panzoom.pan(0, 0, { force: true, animate: false });
    }
    if (output) output.textContent = `${Math.round(scale * 100)}%`;
    for (const button of controls) button.disabled = button.dataset.viewerAction === 'zoom-out' ? scale <= 1.001 : button.dataset.viewerAction === 'zoom-in' ? scale >= max - .001 : false;
  };
  const maxScale = () => Math.min(64, Math.max(6, image.naturalWidth / Math.max(1, image.clientWidth), image.naturalHeight / Math.max(1, image.clientHeight)));
  const reset = () => { if (panzoom) { panzoom.reset({ animate: motion() }); update(); } };
  const start = async () => {
    if (!current() || !imageReady || panzoom || loading) return;
    loading = true; inform('正在准备缩放…');
    try {
      const Panzoom = await load();
      if (!current()) return;
      // A full-stage target keeps focal zoom correct even for a very narrow, centered screenshot.
      panzoom = Panzoom(canvas, { canvas: true, minScale: 1, maxScale: maxScale(), startScale: 1, panOnlyWhenZoomed: true, pinchAndPan: true, touchAction: 'none', cursor: 'grab', step: .3, duration: 160 });
      canvas.addEventListener('panzoomchange', update, { signal });
      stage.addEventListener('wheel', event => { event.preventDefault(); panzoom.zoomWithWheel(event); update(); }, { signal, passive: false });
      stage.addEventListener('dblclick', event => { event.preventDefault(); if (panzoom.getScale() > 1.01) reset(); else { panzoom.zoomToPoint(Math.min(2.5, panzoom.getOptions().maxScale), event, { animate: motion() }); update(); } }, { signal });
      stage.addEventListener('keydown', event => {
        const key = event.key, directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!['+', '=', '-', '0', ...Object.keys(directions)].includes(key)) return;
        event.preventDefault();
        if (key === '0') reset();
        else if (key === '-') panzoom.zoomOut({ animate: motion() });
        else if (key === '+' || key === '=') panzoom.zoomIn({ animate: motion() });
        else { const [x, y] = directions[key], distance = 50 / panzoom.getScale(); panzoom.pan(x * distance, y * distance, { relative: true, animate: false }); }
        update();
      }, { signal });
      if (view?.ResizeObserver) {
        let size = `${stage.clientWidth}:${stage.clientHeight}`;
        observer = new view.ResizeObserver(() => {
          const next = `${stage.clientWidth}:${stage.clientHeight}`;
          if (!current() || !panzoom || next === size) return;
          size = next; panzoom.setOptions({ maxScale: maxScale() }); panzoom.reset({ animate: false }); update();
        });
        observer.observe(stage);
      }
      inform(); update();
    } catch {
      if (panzoom) { panzoom.destroy(); panzoom.resetStyle(); panzoom = null; }
      controls.forEach(button => { button.disabled = true; });
      inform('缩放暂不可用，仍可查看和下载。', true);
    } finally { loading = false; }
  };
  if (image && canvas && stage) {
    image.addEventListener('load', () => { imageReady = image.naturalWidth > 0; start(); }, { signal });
    image.addEventListener('error', () => { imageReady = false; inform('图片暂时无法显示，可尝试下载。', true); }, { signal });
    root.addEventListener('click', event => {
      const button = event.target.closest?.('[data-viewer-action]');
      if (!button || !root.contains(button)) return;
      const action = button.dataset.viewerAction;
      if (action === 'retry') {
        if (imageReady) start();
        else { const source = image.getAttribute('src'); image.removeAttribute('src'); image.setAttribute('src', source); inform('正在加载图片…'); }
      } else if (panzoom) {
        if (action === 'zoom-in') panzoom.zoomIn({ animate: motion() });
        if (action === 'zoom-out') panzoom.zoomOut({ animate: motion() });
        if (action === 'reset') reset();
        update();
      }
    }, { signal });
    if (imageReady) start();
  }
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true; events.abort(); observer?.disconnect();
      if (panzoom) { panzoom.destroy(); panzoom.resetStyle(); panzoom = null; }
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    },
  };
}
