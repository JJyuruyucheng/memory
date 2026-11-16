import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLocalScript } from '../src/local-script.js';

function fixture(outcomes) {
  let value = null;
  const scripts = [];
  const document = { baseURI: 'https://example.invalid/memory/',
    createElement: () => ({ removed: false, remove() { this.removed = true; } }),
    head: { append(script) {
      scripts.push(script);
      const outcome = outcomes.shift();
      queueMicrotask(() => {
        if (outcome === 'success') { value = { ready: true }; script.onload?.(); }
        else if (outcome === 'error') script.onerror?.();
        else if (outcome === 'empty') script.onload?.();
      });
    } },
  };
  return { scripts, options: { document, url: new URL(`assets/vendor-${Math.random().toString().slice(2)}.js`, document.baseURI),
    read: () => value, timeoutMs: 20, retryDelays: [1, 1], now: () => 1234 } };
}

test('a transient local script failure retries with a fresh URL and concurrent callers share one load', async () => {
  const f = fixture(['error', 'success']);
  const first = loadLocalScript(f.options), second = loadLocalScript(f.options);
  assert.equal(first, second);
  assert.equal((await first).ready, true);
  assert.equal(f.scripts.length, 2);
  assert.equal(f.scripts[0].removed, true);
  assert.equal(new URL(f.scripts[1].src).searchParams.get('retry'), '1234-1');
  assert.equal((await loadLocalScript(f.options)).ready, true);
  assert.equal(f.scripts.length, 2, 'an available global is reused');
});

test('unavailable or malformed vendor code stops after three tries and a deliberate retry is possible', async () => {
  const f = fixture(['empty', 'error', 'empty', 'success']);
  await assert.rejects(loadLocalScript(f.options), error => error.code === 'COMPONENT_LOAD_FAILED' && !error.message.includes('script'));
  assert.equal(f.scripts.length, 3);
  assert.ok(f.scripts.every(script => script.removed && script.onload === null && script.onerror === null));
  assert.equal((await loadLocalScript(f.options)).ready, true);
  assert.equal(f.scripts.length, 4);
});

test('hung transfers time out, detach their handlers, and never loop indefinitely', async () => {
  const f = fixture(['hang', 'hang', 'hang']);
  await assert.rejects(loadLocalScript({ ...f.options, timeoutMs: 2 }), { code: 'COMPONENT_LOAD_FAILED' });
  assert.equal(f.scripts.length, 3);
  assert.ok(f.scripts.every(script => script.removed && script.onload === null && script.onerror === null));
});

test('only same-origin public JavaScript asset paths can use the retry loader', async () => {
  const f = fixture([]);
  for (const url of ['https://third-party.invalid/assets/code.js', 'https://example.invalid/src/private.js', 'https://example.invalid/storage/secret.js', 'https://example.invalid/storage/assets/private.js']) {
    await assert.rejects(loadLocalScript({ ...f.options, url }), /本站的公开资源/);
  }
  assert.equal(f.scripts.length, 0);
});
