import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLoginPhoto, prepareLoginPhoto } from '../src/login-photo-image.js';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), x => x.charCodeAt(0));

test('actual raster headers reject disguised SVG, truncated files and excessive pixel counts before decoding', async () => {
  assert.deepEqual(inspectLoginPhoto(png), { mime: 'image/png', width: 1, height: 1 });
  for (const value of [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), png.slice(0, 10)]) assert.throws(() => inspectLoginPhoto(value));
  const large = png.slice(); new DataView(large.buffer).setUint32(16, 10000); new DataView(large.buffer).setUint32(20, 10000);
  assert.throws(() => inspectLoginPhoto(large), /像素/);
  let decoded = 0;
  await assert.rejects(prepareLoginPhoto(new File([png], 'disguised.jpg', { type: 'image/jpeg' }), { decode: async () => { decoded++; } }), /格式与文件内容不符/);
  assert.equal(decoded, 0);
});

test('portrait/landscape output is bounded, newly encoded, randomly named and closes bitmap resources', async () => {
  const operations = [], bitmap = { width: 4000, height: 6000, close() { operations.push('closed'); } };
  const canvas = { width: 0, height: 0,
    getContext() { return { fillRect: (_x, _y, w, h) => operations.push(['fill', w, h]), drawImage: (image, _x, _y, w, h) => { assert.equal(image, bitmap); operations.push(['draw', w, h]); } }; },
    toBlob(callback, mime) { assert.equal(mime, 'image/jpeg'); callback(new Blob(['newly-encoded-pixels'], { type: mime })); },
  };
  const file = await prepareLoginPhoto(new File([png], 'private-person-and-location.png', { type: 'image/png' }), { decode: async () => bitmap, createCanvas: () => canvas, randomId: () => 'generated-id' });
  assert.equal(file.name, 'login-photo-generated-id.jpg'); assert.equal(file.type, 'image/jpeg');
  assert.equal(await file.text(), 'newly-encoded-pixels');
  assert.deepEqual(operations, [['fill', 1280, 1920], ['draw', 1280, 1920], 'closed']);
  assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
});

test('encoding failure keeps a rejected upload out of the provider and releases decoded pixels', async () => {
  let closed = false;
  await assert.rejects(prepareLoginPhoto(new File([png], 'photo.png', { type: 'image/png' }), {
    decode: async () => ({ width: 1, height: 1, close() { closed = true; } }),
    createCanvas: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: callback => callback(null) }),
  }), /优化失败/);
  assert.equal(closed, true);
});
