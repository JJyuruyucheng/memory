import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceFetch } from '../src/service-fetch.js';
const origin = 'https://abcdefghijklmnopqrst.supabase.co';
test('私有下载使用独立新URL并保持用户JWT；认证/API不改参数，外部目标被拒', async () => {
  const calls = [];
  const fetch = createServiceFetch(origin, { nonce: () => 'fresh-request', fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return new Response('ok'); } });
  const headers = { Authorization: 'Bearer synthetic-user-token' };
  await fetch(`${origin}/storage/v1/object/authenticated/memory-media/a/b/c`, { headers });
  assert.equal(new URL(calls[0].url).searchParams.get('cacheNonce'), 'fresh-request');
  assert.deepEqual(calls[0].options.headers, headers); assert.equal(calls[0].options.cache, 'no-store');
  await fetch(`${origin}/storage/v1/object/memory-media/a/b/c`, { headers });
  assert.equal(new URL(calls[1].url).searchParams.get('cacheNonce'), 'fresh-request');
  await fetch(`${origin}/auth/v1/token?grant_type=password`, { method: 'POST', body: '{}' });
  assert.equal(calls[2].url, `${origin}/auth/v1/token?grant_type=password`);
  await assert.rejects(fetch('https://example.invalid/'), /地址无效/);
  assert.equal(calls.length, 3);
});
test('调用方取消及服务超时均中止原请求，不会退回无鉴权下载', async () => {
  const fetch = createServiceFetch(origin, { apiTimeout: 8, fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(fetch(`${origin}/rest/v1/entries`), error => error.name === 'TimeoutError');
    const controller = new AbortController(); const request = fetch(`${origin}/rest/v1/entries`, { signal: controller.signal }); controller.abort();
    await assert.rejects(request, error => error.name === 'AbortError');
  } finally { clearTimeout(keepAlive); }
});

test('登录页匿名下载保留publishable key且不引入用户JWT，每次实际下载均替换旧nonce', async () => {
  const calls = []; let serial = 0;
  const fetch = createServiceFetch(origin, { nonce: () => `new-${++serial}`, fetchImpl: async (input, options) => { calls.push({ request: new Request(input, options), options }); return new Response('image'); } });
  for (const route of ['login-photos', 'authenticated/login-photos']) {
    const input = new Request(`${origin}/storage/v1/object/${route}/slides/example?cacheNonce=old`, { headers: { apikey: 'sb_publishable_synthetic_only' } });
    await fetch(input);
  }
  assert.deepEqual(calls.map(call => new URL(call.request.url).searchParams.get('cacheNonce')), ['new-1', 'new-2']);
  for (const call of calls) {
    assert.equal(call.request.headers.get('apikey'), 'sb_publishable_synthetic_only');
    assert.equal(call.request.headers.has('authorization'), false); assert.equal(call.options.cache, 'no-store');
  }
  await fetch(`${origin}/storage/v1/object/login-photos/slides/example`, { method: 'POST', body: 'upload', headers: { Authorization: 'Bearer synthetic-user-token' } });
  assert.equal(new URL(calls[2].request.url).searchParams.has('cacheNonce'), false, 'upload paths are not changed');
});

test('两类受策略保护的下载在响应头返回后仍保留45秒期限，普通API为30秒', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [];
  const fetch = createServiceFetch(origin, { fetchImpl: async (_input, options) => { signals.push(options.signal); return new Response('body'); } });
  await fetch(`${origin}/rest/v1/rpc/get_login_photos`, { method: 'POST', body: '{}' });
  await fetch(`${origin}/storage/v1/object/login-photos/slides/example`);
  await fetch(`${origin}/storage/v1/object/memory-media/author/entry/example`);
  t.mock.timers.tick(30_000);
  assert.equal(signals[0].aborted, true); assert.equal(signals[0].reason.name, 'TimeoutError');
  assert.equal(signals[1].aborted, false); assert.equal(signals[2].aborted, false);
  t.mock.timers.tick(14_999); assert.equal(signals[1].aborted, false);
  t.mock.timers.tick(1); assert.equal(signals[1].aborted, true); assert.equal(signals[2].aborted, true);
});
