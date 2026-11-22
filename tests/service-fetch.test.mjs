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

test('记录附件上传默认允许十分钟；认证、REST、其他桶及下载继续使用各自期限', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fetch = createServiceFetch(origin, { fetchImpl: async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, options });
    if (['POST', 'PUT'].includes(options.method) && url.pathname.startsWith('/storage/v1/object/memory-media/')) {
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return Response.json({ ok: true });
  } });
  const routes = [
    ['POST', '/storage/v1/object/memory-media/author/entry/video.mp4', 600_000],
    ['PUT', '/storage/v1/object/memory-media/author/entry/video.mp4', 600_000],
    ['GET', '/storage/v1/object/memory-media/author/entry/video.mp4', 45_000],
    ['GET', '/storage/v1/object/authenticated/memory-media/author/entry/video.mp4', 45_000],
    ['GET', '/storage/v1/object/login-photos/slides/photo', 45_000],
    ['POST', '/auth/v1/token?grant_type=refresh_token', 30_000],
    ['POST', '/rest/v1/rpc/finalize_media', 30_000],
    ['POST', '/storage/v1/object/login-photos/slides/photo', 30_000],
    ['POST', '/storage/v1/object/memory-media-other/file', 30_000],
    ['DELETE', '/storage/v1/object/memory-media', 30_000],
  ];
  const requests = routes.map(([method, path]) => fetch(`${origin}${path}`, { method }).then(value => ({ value }), error => ({ error })));
  let previous = 0;
  for (const elapsed of [29_999, 30_000, 44_999, 45_000, 599_999, 600_000]) {
    t.mock.timers.tick(elapsed - previous);
    previous = elapsed;
    calls.forEach((call, index) => assert.equal(call.options.signal.aborted, elapsed >= routes[index][2], `${routes[index][0]} ${routes[index][1]} at ${elapsed} ms`));
  }
  assert.deepEqual((await Promise.all(requests)).slice(0, 2).map(result => result.error?.name), ['TimeoutError', 'TimeoutError']);
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-store');
    if (call.options.signal.aborted) assert.equal(call.options.signal.reason.name, 'TimeoutError');
  }
  for (const index of [0, 1]) assert.equal(calls[index].url.searchParams.has('cacheNonce'), false, 'upload URL is unchanged');
});

test('十分钟上传期限也支持独立覆盖，不延长普通API或下载', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [];
  const fetch = createServiceFetch(origin, { uploadTimeout: 9_000, apiTimeout: 100, fileTimeout: 200,
    fetchImpl: async (_input, options) => {
      signals.push(options.signal);
      if (options.method === 'POST') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      return new Response('ok');
    } });
  await fetch(`${origin}/rest/v1/entries`);
  await fetch(`${origin}/storage/v1/object/memory-media/author/entry/video.mp4`);
  const pending = fetch(`${origin}/storage/v1/object/memory-media/author/entry/video.mp4`, { method: 'POST' }).then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(100);
  assert.deepEqual(signals.map(signal => signal.aborted), [true, false, false]);
  t.mock.timers.tick(100);
  assert.deepEqual(signals.map(signal => signal.aborted), [true, true, false]);
  t.mock.timers.tick(8_799); assert.equal(signals[2].aborted, false);
  t.mock.timers.tick(1); assert.equal(signals[2].aborted, true);
  assert.equal((await pending).error?.name, 'TimeoutError');
});

test('调用方可立即取消长上传，Request中的方法、正文和鉴权保持不变', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), reason = new DOMException('synthetic caller cancellation', 'AbortError');
  let captured;
  const fetch = createServiceFetch(origin, { fetchImpl: (resource, options) => {
    captured = { resource, options };
    return new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  } });
  const input = new Request(`${origin}/storage/v1/object/memory-media/author/entry/video.mp4`, {
    method: 'POST', signal: controller.signal, body: 'synthetic bytes',
    headers: { Authorization: 'Bearer synthetic-member-jwt', apikey: 'sb_publishable_synthetic' },
  });
  const pending = fetch(input).then(value => ({ value }), error => ({ error }));
  assert.equal(captured.resource.method, 'POST');
  assert.equal(captured.resource.headers.get('authorization'), 'Bearer synthetic-member-jwt');
  assert.equal(captured.resource.headers.get('apikey'), 'sb_publishable_synthetic');
  assert.equal(await captured.resource.text(), 'synthetic bytes');
  t.mock.timers.tick(120_000); assert.equal(captured.options.signal.aborted, false);
  controller.abort(reason); assert.equal((await pending).error, reason);
  assert.equal(captured.options.signal.reason, reason);
});

test('40MB视频的合成慢上传超过30及45秒仍能完成，十分钟后未完成请求才超时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const video = new File([new Uint8Array(40_000_000)], 'synthetic-40mb.mp4', { type: 'video/mp4' });
  const body = new FormData(); body.append('cacheControl', '0'); body.append('', video);
  let captured, completed = false;
  const fetch = createServiceFetch(origin, { fetchImpl: (_input, options) => {
    captured = options;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      setTimeout(() => { completed = true; resolve(Response.json({ Key: 'memory-media/synthetic/entry/file' })); }, 120_000);
    });
  } });
  const pending = fetch(`${origin}/storage/v1/object/memory-media/synthetic/entry/file`, {
    method: 'POST', body, headers: { Authorization: 'Bearer synthetic-member-jwt', 'x-upsert': 'false' },
  }).then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(45_001);
  assert.equal(captured.signal.aborted, false); assert.equal(completed, false);
  assert.equal(captured.body, body); assert.equal(captured.body.get('').size, 40_000_000);
  assert.equal(captured.body.get('').type, 'video/mp4');
  assert.equal(captured.headers.Authorization, 'Bearer synthetic-member-jwt'); assert.equal(captured.headers['x-upsert'], 'false');
  t.mock.timers.tick(74_999);
  const result = await pending;
  assert.equal(result.error, undefined); assert.equal(result.value.status, 200); assert.equal(completed, true);

  let hangingSignal;
  const hangingFetch = createServiceFetch(origin, { fetchImpl: (_input, options) => {
    hangingSignal = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  const hanging = hangingFetch(`${origin}/storage/v1/object/memory-media/synthetic/entry/file`, { method: 'POST', body }).then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(599_999); assert.equal(hangingSignal.aborted, false);
  t.mock.timers.tick(1); assert.equal((await hanging).error?.name, 'TimeoutError'); assert.equal(hangingSignal.aborted, true);
});

test('上传收到响应头后正文停滞仍受十分钟期限约束', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const fetch = createServiceFetch(origin, { fetchImpl: async (_input, options) => {
    signal = options.signal;
    const stream = new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } });
    return new Response(stream, { headers: { 'content-type': 'application/json' } });
  } });
  const response = await fetch(`${origin}/storage/v1/object/memory-media/synthetic/entry/file`, { method: 'POST', body: 'synthetic upload' });
  const pending = response.json().then(value => ({ value }), error => ({ error }));
  t.mock.timers.tick(599_999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(signal.aborted, true);
  assert.equal((await pending).error?.name, 'TimeoutError');
});
