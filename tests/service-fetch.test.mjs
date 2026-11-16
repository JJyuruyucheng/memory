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
