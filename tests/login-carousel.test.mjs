import test from 'node:test';
import assert from 'node:assert/strict';
import { findAvailableLoginPhoto } from '../src/login-carousel.js';

test('carousel skips an unavailable next image and keeps the following image reachable', async () => {
  const calls = [], good = { id: 'third', url: 'blob:third' };
  const selected = await findAvailableLoginPhoto({ count: 3, start: 1, load: async index => { calls.push(index); return index === 2 ? good : null; } });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(selected, { index: 2, photo: good });
});

test('carousel previous direction skips broken images and wraps backwards', async () => {
  const calls = [], good = { id: 'second' };
  const selected = await findAvailableLoginPhoto({ count: 4, start: -1, step: -1, load: async index => { calls.push(index); return index === 1 ? good : null; } });
  assert.deepEqual(calls, [3, 2, 1]);
  assert.equal(selected.index, 1);
});

test('carousel all unavailable lookup is bounded to one complete cycle', async () => {
  const calls = [];
  const selected = await findAvailableLoginPhoto({ count: 8, start: 6, load: async index => { calls.push(index); throw new Error('file unavailable'); } });
  assert.equal(selected, null);
  assert.deepEqual(calls, [6, 7, 0, 1, 2, 3, 4, 5]);
  assert.equal(new Set(calls).size, 8);
});

test('carousel returns the current healthy image after other images fail, rather than going blank', async () => {
  const calls = [], current = { id: 'current' };
  const selected = await findAvailableLoginPhoto({ count: 3, start: 1, load: async index => { calls.push(index); return index === 0 ? current : null; } });
  assert.deepEqual(calls, [1, 2, 0]);
  assert.deepEqual(selected, { index: 0, photo: current });
});

test('carousel destroyed or superseded before lookup performs no downloads', async () => {
  let calls = 0;
  assert.equal(await findAvailableLoginPhoto({ count: 3, start: 0, load: async () => { calls++; return {}; }, isCurrent: () => false }), null);
  assert.equal(calls, 0);
});

test('carousel generation change while a download is pending discards the result and stops searching', async () => {
  let resolve, active = true; const calls = [];
  const pending = findAvailableLoginPhoto({ count: 3, start: 1, load: index => { calls.push(index); return new Promise(done => { resolve = done; }); }, isCurrent: () => active });
  active = false; resolve({ id: 'late' });
  assert.equal(await pending, null);
  assert.deepEqual(calls, [1]);
});

test('carousel concurrent navigation allows only the latest request to select a photo', async () => {
  let generation = 1, resolveOld;
  const oldRequest = findAvailableLoginPhoto({ count: 3, start: 1, load: () => new Promise(done => { resolveOld = done; }), isCurrent: () => generation === 1 });
  generation = 2;
  const current = await findAvailableLoginPhoto({ count: 3, start: 2, load: async () => ({ id: 'latest' }), isCurrent: () => generation === 2 });
  resolveOld({ id: 'old' });
  assert.equal(await oldRequest, null);
  assert.equal(current.photo.id, 'latest');
});

test('carousel automatic lookup stops when playback is paused during a download', async () => {
  let resolve, paused = false; const calls = [];
  const pending = findAvailableLoginPhoto({ count: 3, start: 1, load: index => { calls.push(index); return new Promise(done => { resolve = done; }); }, isCurrent: () => !paused });
  paused = true; resolve({ id: 'ready-after-hidden' });
  assert.equal(await pending, null);
  assert.deepEqual(calls, [1]);
});

test('carousel lookup rejects invalid bounds without invoking the loader', async () => {
  let calls = 0;
  for (const options of [{ count: 0, start: 0 }, { count: 9, start: 0 }, { count: 2, start: 0.5 }, { count: 2, start: 0, step: 0 }]) {
    assert.equal(await findAvailableLoginPhoto({ ...options, load: async () => { calls++; return {}; } }), null);
  }
  assert.equal(calls, 0);
});
