import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaDownloadName, mediaViewerMarkup, mediaViewerUrl, mountMediaViewer } from '../src/media-viewer.js';

const base = 'https://memory.example/memory/#timeline';

test('media downloads reuse only same-origin HTTP or same-origin blob URLs', () => {
  assert.equal(mediaViewerUrl('./assets/photo.jpg', base), 'https://memory.example/memory/assets/photo.jpg');
  assert.equal(mediaViewerUrl('blob:https://memory.example/a-uuid', base), 'blob:https://memory.example/a-uuid');
  for (const value of ['https://other.example/personal.jpg', 'blob:https://other.example/id', 'blob:null/id', 'javascript:alert(1)', 'data:image/svg+xml,test', '//other.example/image', 'https://name:password@memory.example/photo.jpg', '', null]) {
    assert.equal(mediaViewerUrl(value, base), '', String(value));
  }
  assert.equal(mediaViewerUrl('file:///private/photo.jpg', 'file:///private/page.html'), '');
});

test('download names remove paths, control and bidi characters and unsafe extensions', () => {
  assert.equal(mediaDownloadName('../../照片.PNG'), '照片.png');
  assert.equal(mediaDownloadName('C:\\fakepath\\今天\u202e\u0000.jpg'), '今天.jpg');
  assert.equal(mediaDownloadName('x<>":|?*.exe'), 'x.jpg');
  assert.equal(mediaDownloadName('CON.jpg'), '朝夕-照片.jpg');
  assert.equal(mediaDownloadName('', 'video'), '朝夕-视频.mp4');
  assert.equal(mediaDownloadName('回忆.MOV', 'video'), '回忆.mov');
  assert.equal(mediaDownloadName('photo.mp4', 'image'), 'photo.jpg');
  assert.equal(Array.from(mediaDownloadName('照'.repeat(300) + '.webp')).length, 105);
});

test('preview escapes user metadata and omits media/download sources for rejected addresses', () => {
  const markup = mediaViewerMarkup({ file: { type: 'image', url: './photo.png', name: '\"><script>.png' }, title: '<script>alert(1)</script>', entryId: '\" onclick=evil', index: 1, count: 3, date: '今天' }, base);
  assert.ok(!markup.includes('<script>'));
  assert.ok(markup.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(markup.includes('data-id="&quot; onclick=evil"'));
  assert.ok(markup.includes('download="script.png"'));
  const rejected = mediaViewerMarkup({ file: { type: 'image', url: 'https://other.example/a.png' } }, base);
  assert.ok(!rejected.includes('href='));
  assert.ok(!rejected.includes('<img'));
  const video = mediaViewerMarkup({ file: { type: 'video', url: './clip.mp4', name: 'clip.mp4' } }, base);
  assert.ok(video.includes('controls playsinline'));
  assert.ok(video.includes('download="clip.mp4"'));
  assert.ok(!video.includes('data-viewer-action="zoom-in"'));
});

class Element extends EventTarget {
  constructor(values = {}) { super(); Object.assign(this, { isConnected: true, dataset: {}, style: {}, clientWidth: 400, clientHeight: 500, attrs: new Map() }, values); }
  getAttribute(name) { return this.attrs.get(name); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  removeAttribute(name) { this.attrs.delete(name); }
}
function fixture({ video = false } = {}) {
  const image = video ? null : new Element({ complete: true, naturalWidth: 1080, naturalHeight: 20000, clientWidth: 27, clientHeight: 500 });
  const stage = new Element(), canvas = video ? null : new Element(), output = new Element(), status = new Element(), message = new Element(), retry = new Element();
  const controls = ['zoom-in', 'zoom-out', 'reset'].map(action => new Element({ dataset: { viewerAction: action }, disabled: true }));
  const movie = video ? new Element({ paused: 0, loaded: 0, pause() { this.paused++; }, load() { this.loaded++; } }) : null;
  if (movie) movie.setAttribute('src', 'blob:https://memory.example/video');
  const nodes = new Map([['[data-media-stage]', stage], ['.media-viewer-canvas', canvas], ['.media-viewer-image', image], ['video', movie], ['[data-media-scale]', output], ['.media-viewer-status', status], ['[data-media-message]', message], ['[data-viewer-action="retry"]', retry]]);
  const root = new Element({ querySelector: selector => nodes.get(selector), querySelectorAll: () => controls, contains: element => [...nodes.values(), ...controls].includes(element) });
  const record = { creates: 0, wheels: 0, destroyed: 0, resetStyles: 0, observed: 0, disconnected: 0 };
  let options, scale = 1, pan = { x: 0, y: 0 };
  const Panzoom = (_image, input) => { record.creates++; options = input; return {
    getScale: () => scale, getOptions: () => options, getPan: () => pan,
    zoomWithWheel() { record.wheels++; scale = 2; },
    destroy() { record.destroyed++; }, resetStyle() { record.resetStyles++; },
    reset() { scale = 1; pan = { x: 0, y: 0 }; }, setOptions(value) { Object.assign(options, value); },
    pan(x, y) { pan = { x, y }; },
  }; };
  const window = { matchMedia: () => ({ matches: true }), ResizeObserver: class { observe() { record.observed++; } disconnect() { record.disconnected++; } } };
  return { root, image, movie, stage, canvas, status, message, retry, output, record, Panzoom, window, controls, options: () => options, setTransform: (nextScale, x, y) => { scale = nextScale; pan = { x, y }; }, pan: () => pan };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('closing before the optional library resolves prevents stale initialization', async () => {
  const f = fixture(); let resolve;
  const viewer = mountMediaViewer(f.root, { load: () => new Promise(done => { resolve = done; }), window: f.window });
  viewer.destroy(); resolve(f.Panzoom); await flush();
  assert.equal(f.record.creates, 0);
  assert.equal(f.record.observed, 0);
});

test('long screenshot zoom, added listeners and observers clean up once without revoking the source', async () => {
  const f = fixture();
  const viewer = mountMediaViewer(f.root, { load: async () => f.Panzoom, window: f.window });
  await flush();
  assert.equal(f.options().maxScale, 40);
  assert.equal(f.options().touchAction, 'none');
  f.stage.dispatchEvent(new Event('wheel', { cancelable: true }));
  assert.equal(f.record.wheels, 1);
  assert.equal(f.output.textContent, '200%');
  viewer.destroy(); viewer.destroy();
  f.stage.dispatchEvent(new Event('wheel', { cancelable: true }));
  assert.equal(f.record.wheels, 1);
  assert.equal(f.record.destroyed, 1);
  assert.equal(f.record.resetStyles, 1);
  assert.equal(f.record.disconnected, 1);
});

test('optional library failure leaves image/download intact and offers a bounded user retry', async () => {
  const f = fixture(); let attempts = 0;
  const viewer = mountMediaViewer(f.root, { load: async () => { attempts++; throw new Error('offline'); }, window: f.window });
  await flush();
  assert.equal(attempts, 1);
  assert.equal(f.retry.hidden, false);
  assert.equal(f.status.hidden, false);
  assert.match(f.message.textContent, /仍可查看和下载/);
  assert.ok(f.controls.every(button => button.disabled));
  assert.equal(f.record.creates, 0);
  viewer.destroy();
});

test('zooming a dragged image back to its fit scale recenters it before dragging becomes disabled', async () => {
  const f = fixture();
  const viewer = mountMediaViewer(f.root, { load: async () => f.Panzoom, window: f.window });
  await flush();
  f.setTransform(1, 240, -400);
  f.canvas.dispatchEvent(new Event('panzoomchange'));
  assert.deepEqual(f.pan(), { x: 0, y: 0 });
  assert.equal(f.output.textContent, '100%');
  assert.equal(f.controls.find(button => button.dataset.viewerAction === 'zoom-out').disabled, true);
  viewer.destroy();
});

test('closing a video pauses playback and releases its element source without revoking shared blobs', () => {
  const f = fixture({ video: true });
  const viewer = mountMediaViewer(f.root, { load: () => { throw new Error('must not load'); }, window: f.window });
  viewer.destroy(); viewer.destroy();
  assert.equal(f.movie.paused, 1);
  assert.equal(f.movie.loaded, 1);
  assert.equal(f.movie.getAttribute('src'), undefined);
});
