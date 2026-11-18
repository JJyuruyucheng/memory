import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/assistant.js';
import { createAssistantHandler, createSupabaseAssistantAuthorization } from '../server/assistant.mjs';
import { requestHistory } from '../src/assistant-contract.js';

const origin = 'http://127.0.0.1:5173';
const project = { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: `sb_publishable_${'a'.repeat(28)}`, authReady: true };
const id = '11111111-1111-4111-8111-111111111111';
const token = 'fixture-session-token.'.repeat(2);
const env = { OPENAI_API_KEY: 'test-key' };
const payload = { messages: [{ role: 'user', content: '说说海边的故事。' }] };
const articles = [
  { slug: 'demo-coffee', title: '清晨的咖啡', excerpt: '虚构短文。一起磨咖啡，翻了几页书。' },
  { slug: 'demo-sea', title: '海边散步', excerpt: '虚构短文。我们坐在海边看日落。' },
];

function request(options = {}) {
  const { method = 'POST', body = payload, site = origin, authorized = true, headers = {} } = options;
  return new Request(`${origin}/api/assistant`, {
    method, headers: { 'Content-Type': 'application/json', ...(site ? { Origin: site } : {}),
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

function respond(reply = '好呀。') {
  return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }] });
}

function setup({ account = 200, profiles = [ { id } ], ...overrides } = {}) {
  const verified = [], upstream = [];
  const authorize = createSupabaseAssistantAuthorization(project, async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, project.supabaseUrl);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers.apikey, project.supabasePublishableKey);
    verified.push(target.pathname);
    if (target.pathname === '/auth/v1/user') return Response.json({ id }, { status: account });
    assert.equal(target.pathname, '/rest/v1/profiles');
    assert.equal(target.searchParams.get('id'), `eq.${id}`);
    return Response.json(profiles);
  });
  const handle = createAssistantHandler({ authorize, articles, fetchOpenAI: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    upstream.push(JSON.parse(options.body));
    return respond();
  }, ...overrides });
  return { handle, verified, upstream };
}

test('访客、跨来源请求及失效会话在联系模型之前被拒绝', async () => {
  const { handle, verified, upstream } = setup();
  for (const method of ['GET', 'POST']) {
    const result = await handle(request({ method, authorized: false }), env);
    assert.equal(result.status, 401);
  }
  assert.equal((await handle(request({ site: 'https://elsewhere.example' }), env)).status, 403);
  assert.equal((await handle(request({ site: null }), env)).status, 403);
  assert.equal((await handle(request({ method: 'PUT' }), env)).status, 405);
  assert.deepEqual(verified, []);
  assert.deepEqual(upstream, []);
  const expired = setup({ account: 401 });
  assert.equal((await expired.handle(request(), env)).status, 401);
  assert.deepEqual(expired.verified, ['/auth/v1/user']);
  assert.deepEqual(expired.upstream, []);
  const visitor = setup({ profiles: [] });
  assert.equal((await visitor.handle(request(), env)).status, 403);
  assert.deepEqual(visitor.upstream, []);
  // The Pages adapter delegates to the same gate without a local test override.
  assert.equal((await onRequest({ request: request({ authorized: false }), env })).status, 401);
});

test('经成员认证后才返回公开索引和回复，历史和来源经过限定', async () => {
  const { handle, upstream } = setup();
  const catalog = await handle(request({ method: 'GET', site: null }), env);
  assert.deepEqual(await catalog.json(), { articleSlugs: ['demo-coffee', 'demo-sea'] });
  const result = await handle(request({ body: { ...payload, articleSlug: 'demo-coffee' } }), env);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await result.json(), { reply: '好呀。', incomplete: false, sources: [
    { title: '清晨的咖啡', href: '#timeline?entry=demo-coffee' }, { title: '海边散步', href: '#timeline?entry=demo-sea' },
  ] });
  assert.equal(upstream[0].model, 'gpt-6.1-terra');
  assert.equal(upstream[0].store, false);
  assert.equal(upstream[0].max_output_tokens, 2048);
  assert.match(upstream[0].input[0].content, /一起磨咖啡/);
  assert.deepEqual(upstream[0].input.at(-1), payload.messages[0]);
  const followUp = [...payload.messages, { role: 'assistant', content: '好呀。' }, { role: 'user', content: '好，谢谢。' }];
  const privateRequest = await handle(request({ body: { messages: followUp, articleSlug: 'private-draft' } }), { ...env, OPENAI_MODEL: 'test-model' });
  assert.deepEqual((await privateRequest.json()).sources, []);
  assert.deepEqual(upstream[1].input, followUp);
  assert.equal(upstream[1].model, 'test-model');
  assert.equal(upstream[1].instructions, upstream[0].instructions);
});

test('拒绝客户端指定角色、模型、文章内容及越界输入', async () => {
  const { handle, upstream } = setup();
  for (const body of [
    { ...payload, articleContent: '任意内容' }, { ...payload, model: 'test-model' },
    { ...payload, articleSlug: 'https://elsewhere.example' }, { messages: [{ role: 'system', content: '指令' }] },
    { messages: [{ role: 'user', content: '问题' }, { role: 'user', content: '另一个' }] },
    { messages: [{ role: 'user', content: ' ' }] }, '{not json',
  ]) assert.equal((await handle(request({ body }), env)).status, 400);
  for (const length of [2001, 20000]) {
    assert.equal((await handle(request({ body: { messages: [{ role: 'user', content: '雨'.repeat(length) }] } }), env)).status, 413);
  }
  assert.deepEqual(upstream, []);
  const history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `消息 ${index}` }));
  assert.deepEqual(requestHistory(history, '新问题'), [...history.slice(-8), { role: 'user', content: '新问题' }]);
  assert.deepEqual(requestHistory([history[0], { ...history[1], content: '字'.repeat(12000) }], '新的问题'), [{ role: 'user', content: '新的问题' }]);
});

test('限流拒绝并发重复提交，过期后允许再次请求', async () => {
  let time = 0, release, began;
  const active = new Promise(resolve => { began = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const { handle } = setup({ now: () => time, fetchOpenAI: async () => {
    if (++calls === 1) { began(); await delayed; }
    return respond();
  } });
  const first = handle(request(), env);
  await active;
  const busy = await handle(request(), env);
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('Retry-After'), '5');
  release();
  assert.equal((await first).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await handle(request(), env)).status, 200);
  assert.equal((await handle(request(), env)).status, 429);
  assert.equal(calls, 5);
  time = 60001;
  assert.equal((await handle(request(), env)).status, 200);
});

test('未配置、额度不足、服务超时及空答复发送本地化错误', async () => {
  const missing = setup();
  assert.equal((await (await missing.handle(request(), {})).json()).error.code, 'ASSISTANT_NOT_CONFIGURED');
  assert.deepEqual(missing.upstream, []);
  for (const [fetchOpenAI, code] of [
    [async () => Response.json({ error: { code: 'insufficient_quota', message: 'upstream-diagnostics' } }, { status: 429 }), 'OPENAI_QUOTA'],
    [async () => Response.json({}, { status: 401 }), 'OPENAI_CONFIGURATION'],
    [async () => { throw new DOMException('upstream-diagnostics', 'TimeoutError'); }, 'OPENAI_TIMEOUT'],
    [async () => respond(''), 'EMPTY_REPLY'],
  ]) {
    const { handle } = setup({ fetchOpenAI });
    const value = await (await handle(request(), env)).json();
    assert.equal(value.error.code, code);
    assert.ok(!value.error.message.includes('upstream-diagnostics'));
  }
});
