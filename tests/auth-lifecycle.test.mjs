import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAuthLifecycle } from '../src/auth-lifecycle.js';

function fixture() {
  const browser = new EventTarget(), document = new EventTarget(), navigator = { onLine: true }, calls = [];
  document.visibilityState = 'visible';
  const auth = { async startAutoRefresh() { calls.push('start'); }, async stopAutoRefresh() { calls.push('stop'); } };
  const lifecycle = createBrowserAuthLifecycle(auth, { windowTarget: browser, documentTarget: document, navigatorTarget: navigator });
  const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  return { browser, document, navigator, calls, auth, lifecycle, settle };
}

test('returning from a suspended tab immediately restarts SDK refresh, including bfcache and reconnect', async () => {
  const f = fixture(); await f.settle(); assert.deepEqual(f.calls, ['start']);
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange')); await f.settle();
  assert.deepEqual(f.calls, ['start', 'stop']);
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange')); await f.settle();
  f.browser.dispatchEvent(new Event('pageshow')); await f.settle();
  assert.deepEqual(f.calls, ['start', 'stop', 'start', 'start']);
  f.navigator.onLine = false; f.browser.dispatchEvent(new Event('offline')); await f.settle();
  f.navigator.onLine = true; f.browser.dispatchEvent(new Event('online')); await f.settle();
  assert.deepEqual(f.calls.slice(-2), ['stop', 'start']);
  await f.lifecycle.dispose();
});

test('logout stays paused across visibility/network changes; a new explicit login resumes only in foreground', async () => {
  const f = fixture(); await f.settle(); await f.lifecycle.pause();
  for (const event of ['online', 'pageshow']) f.browser.dispatchEvent(new Event(event));
  f.document.dispatchEvent(new Event('visibilitychange')); await f.settle();
  assert.deepEqual(f.calls, ['start', 'stop']);
  f.document.visibilityState = 'hidden'; await f.lifecycle.resume();
  assert.equal(f.calls.at(-1), 'stop');
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange')); await f.settle();
  assert.equal(f.calls.at(-1), 'start');
  await f.lifecycle.dispose();
});

test('rapid visibility changes coalesce to the latest state without a late restart after logout', async () => {
  const f = fixture();
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange'));
  await f.lifecycle.pause();
  assert.deepEqual(f.calls, ['stop']);
  await f.lifecycle.dispose();
});

test('dispose removes lifecycle listeners and cannot be restarted by an obsolete provider', async () => {
  const f = fixture(); await f.settle(); await f.lifecycle.dispose(); const before = f.calls.length;
  f.document.dispatchEvent(new Event('visibilitychange'));
  for (const event of ['online', 'offline', 'pageshow']) f.browser.dispatchEvent(new Event(event));
  await f.lifecycle.resume(); await f.settle();
  assert.equal(f.calls.length, before); assert.equal(f.calls.at(-1), 'stop');
});

test('a rejected refresh scheduler is recoverable on the next foreground event', async () => {
  const f = fixture(); let failures = 1;
  f.auth.startAutoRefresh = async () => { f.calls.push('start'); if (failures--) throw Error('synthetic scheduler error'); };
  await f.settle(); f.browser.dispatchEvent(new Event('online')); await f.settle();
  assert.deepEqual(f.calls, ['start', 'start']); await f.lifecycle.dispose();
});
