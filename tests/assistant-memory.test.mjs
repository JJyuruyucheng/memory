import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/assistant-memory.js';
import { createAssistantMemoryHandler } from '../server/assistant-memory.mjs';

const project = { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: `sb_publishable_${'a'.repeat(28)}`, authReady: true };
const env = { OPENAI_API_KEY: 'test-key' };
const token = '11223344-5500-4677-8899-aabbccddeeff';
const source = {
  id: '22222222-2222-4222-8222-222222222222', title: '海边散步',
  content: ` 沿着海边走了一会。${'🌊'.repeat(19950)}最后我感觉很轻松。 `,
  tags: ['日常'], mood: 'happy', occurredAt: '2026-11-23T12:00:00+00:00', hidden: 'mock-private-value',
};
const memory = { summary: '作者沿着海边散步。', themes: ['散步'], statedFeelings: ['很轻松', '微笑'] };
const extracted = value => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

function task(capability, body, method = 'POST') {
  return new Request('https://example.test/api/assistant-memory', {
    method, headers: capability ? { 'X-Assistant-Memory-Token': capability } : {},
    body: method === 'POST' && body ? JSON.stringify(body) : undefined,
  });
}

function setup({ job = source, output = extracted(memory), completed = true, upstream = 200, claimStatus = 200 } = {}) {
  const calls = [];
  const handle = createAssistantMemoryHandler(project, {
    fetchSupabase: async (url, options) => {
      const path = new URL(url);
      assert.equal(path.origin, project.supabaseUrl);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.apikey, project.supabasePublishableKey);
      assert.equal(options.headers.Authorization, undefined);
      calls.push([path.pathname, JSON.parse(options.body)]);
      if (path.pathname === '/rest/v1/rpc/assistant_memory_claim') {
        return claimStatus === 204 ? new Response(null, { status: 204 }) : Response.json(job, { status: claimStatus });
      }
      assert.equal(path.pathname, '/rest/v1/rpc/assistant_memory_complete');
      return Response.json(completed);
    },
    fetchOpenAI: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      assert.equal(options.redirect, 'manual');
      calls.push(['openai', JSON.parse(options.body)]);
      return Response.json(output, { status: upstream });
    },
  });
  return { handle, calls };
}

test('记忆任务只接受 POST 和标准 UUIDv4 请求头，不从请求体读取令牌', async () => {
  const { handle, calls } = setup();
  for (const capability of ['', token.replace('-4677-', '-7677-'), `${token}, ${token}`, token.replace('-8899-', '-0899-')]) {
    const result = await handle(task(capability, { token }), env);
    assert.equal(result.status, 403);
    assert.equal(await result.text(), '');
  }
  const response = await onRequest({ request: task(token, undefined, 'GET'), env });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal((await handle(task(token))).status, 503);
  assert.deepEqual(calls, []);
});

test('已失效的能力不发送模型请求，响应正文为空', async () => {
  for (const options of [{ job: null }, { claimStatus: 204 }]) {
    const { handle, calls } = setup(options);
    const result = await handle(task(token), env);
    assert.equal(result.status, 204);
    assert.equal(await result.text(), '');
    assert.deepEqual(calls, [['/rest/v1/rpc/assistant_memory_claim', { p_token: token }]]);
  }
});

test('处理已领取的完整正文并保存有依据的结构化记忆', async () => {
  const { handle, calls } = setup({ output: extracted({ ...memory, themes: ['散步', '散步'], statedFeelings: [...memory.statedFeelings, '臆测情绪'] }) });
  const result = await handle(task(token, { id: 'untrusted-job-id', content: 'untrusted-body' }), { ...env, OPENAI_MODEL: 'gpt-5-mini' });
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(await result.text(), '');
  assert.deepEqual(calls[0], ['/rest/v1/rpc/assistant_memory_claim', { p_token: token }]);
  const [provider, request] = calls[1];
  assert.equal(provider, 'openai');
  assert.equal(request.model, 'gpt-5-mini');
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.required, Object.keys(memory));
  const [entry] = request.input;
  assert.equal(entry.role, 'user');
  assert.deepEqual(JSON.parse(entry.content), {
    title: source.title, content: source.content, tags: source.tags,
    mood: '微笑', occurredAt: source.occurredAt,
  });
  assert.deepEqual(calls[2], ['/rest/v1/rpc/assistant_memory_complete', { p_token: token, p_memory: memory }]);
});

test('失效或更改的文章由数据库拒绝写回，调用方看不到记忆内容', async () => {
  const { handle, calls } = setup({ completed: false });
  const result = await handle(task(token), env);
  assert.equal(result.status, 204);
  assert.equal(await result.text(), '');
  assert.equal(calls.length, 3);
});

test('拒绝写入不完整、越界或非结构化的模型结果', async () => {
  const invalid = [
    { ...extracted(memory), status: 'incomplete' },
    extracted({ ...memory, summary: '字'.repeat(421) }),
    extracted({ ...memory, themes: ['字'.repeat(81)] }),
    extracted({ ...memory, statedFeelings: Array(7).fill('很轻松') }),
    extracted({ ...memory, unexpected: source.hidden }),
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: source.hidden }] }] },
  ];
  for (const output of invalid) {
    const { handle, calls } = setup({ output });
    const result = await handle(task(token), env);
    assert.equal(result.status, 502);
    assert.equal(await result.text(), '');
    assert.equal(calls.length, 2);
  }
});

test('上游的错误正文、请求内容和能力令牌均不返回调用方', async () => {
  const { handle, calls } = setup({ upstream: 429, output: { error: `${token} ${source.hidden}` } });
  const result = await handle(task(token), env);
  assert.equal(result.status, 503);
  assert.equal(await result.text(), '');
  assert.equal(calls.length, 2);
});
