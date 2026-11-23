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
  const { method = 'POST', body = payload, site = origin, authorized = true, headers = {}, signal } = options;
  return new Request(`${origin}/api/assistant`, {
    method, signal, headers: { 'Content-Type': 'application/json', ...(site ? { Origin: site } : {}),
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

function respond(reply = '好呀。') {
  return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }] });
}

function setup({ account = 200, profiles = [ { id } ], entries = [], ...overrides } = {}) {
  const verified = [], upstream = [];
  const authorize = createSupabaseAssistantAuthorization(project, async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, project.supabaseUrl);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers.apikey, project.supabasePublishableKey);
    assert.equal(options.headers['Cache-Control'], 'no-store');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, undefined);
    verified.push(target.pathname);
    if (target.pathname === '/auth/v1/user') return Response.json({ id }, { status: account });
    if (target.pathname === '/rest/v1/entries') {
      assert.equal(target.searchParams.get('status'), 'eq.published');
      assert.equal(target.searchParams.get('type'), 'in.(note,event)');
      assert.equal(target.searchParams.get('deletedAt'), 'is.null');
      // PostgREST also sees favorites and reactions as relationships to profiles.
      if (!target.searchParams.get('select').includes('author:profiles!entries_authorId_fkey(name)')) {
        return Response.json({ code: 'PGRST201' }, { status: 300 });
      }
      const selected = target.searchParams.get('id');
      if (selected) return Response.json(entries.filter(row => selected.includes(row.id)));
      assert.ok(!target.searchParams.get('select').includes('content'));
      return Response.json(entries.map(({ content, ...row }) => row));
    }
    assert.equal(target.pathname, '/rest/v1/profiles');
    assert.equal(target.searchParams.get('id'), `eq.${id}`);
    return Response.json(profiles);
  });
  const handle = createAssistantHandler({ authorize, articles, fetchOpenAI: async (url, options) => {
    if (url === 'https://api.openai.com/v1/models') {
      return Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-5-mini' }, { id: 'other-private-model' }] });
    }
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.redirect, 'manual');
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
  assert.deepEqual(await catalog.json(), { articleSlugs: ['demo-coffee', 'demo-sea'], defaultModel: 'gpt-6.1-terra', models: ['gpt-6.1-terra', 'gpt-5-mini'] });
  const result = await handle(request({ body: { ...payload, articleSlug: 'demo-coffee' } }), env);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await result.json(), { reply: '好呀。', incomplete: false, model: 'gpt-6.1-terra', sources: [
    { title: '清晨的咖啡', href: '#timeline?entry=demo-coffee' }, { title: '海边散步', href: '#timeline?entry=demo-sea' },
  ] });
  assert.equal(upstream[0].model, 'gpt-6.1-terra');
  assert.equal(upstream[0].store, false);
  assert.equal(upstream[0].max_output_tokens, 2048);
  assert.match(upstream[0].input[0].content, /一起磨咖啡/);
  assert.match(upstream[0].instructions, /瓜子/);
  assert.deepEqual(upstream[0].input.at(-1), payload.messages[0]);
  const followUp = [...payload.messages, { role: 'assistant', content: '好呀。' }, { role: 'user', content: '好，谢谢。' }];
  const privateRequest = await handle(request({ body: { messages: followUp, articleSlug: 'private-draft' } }), { ...env, OPENAI_MODEL: 'test-model' });
  assert.deepEqual((await privateRequest.json()).sources, []);
  assert.deepEqual(upstream[1].input, followUp);
  assert.equal(upstream[1].model, 'gpt-6.1-terra', 'an absent configured preference cannot override a confirmed model catalog');
  assert.match(upstream[1].instructions, /gpt-6\.1-terra/);
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
  const { handle } = setup({ now: () => time, fetchOpenAI: async url => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6.1-terra' }] });
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
    [async () => Response.json({}, { status: 401 }), 'OPENAI_AUTHENTICATION'],
    [async () => Response.redirect('https://unexpected.example/'), 'OPENAI_UNAVAILABLE'],
    [async () => { throw new DOMException('upstream-diagnostics', 'TimeoutError'); }, 'OPENAI_TIMEOUT'],
    [async () => respond(''), 'EMPTY_REPLY'],
  ]) {
    const { handle } = setup({ fetchOpenAI });
    const value = await (await handle(request(), env)).json();
    assert.equal(value.error.code, code);
    assert.ok(!value.error.message.includes('upstream-diagnostics'));
  }
});

test('成功模型目录只广告交集，缺席偏好使用首个可用模型，没有交集时不猜测', async () => {
  for (const [listed, expected] of [
    [['gpt-5-mini', 'unconfigured-model'], { models: ['gpt-5-mini'], defaultModel: 'gpt-5-mini' }],
    [['unconfigured-model'], { models: [], defaultModel: '' }],
  ]) {
    const generated = [];
    const { handle } = setup({ fetchOpenAI: async (url, options) => {
      if (url.endsWith('/models')) return Response.json({ data: listed.map(id => ({ id })) });
      generated.push(JSON.parse(options.body).model); return respond();
    } });
    const catalog = await (await handle(request({ method: 'GET' }), env)).json();
    assert.deepEqual({ models: catalog.models, defaultModel: catalog.defaultModel }, expected);
    const response = await handle(request(), env);
    if (expected.models.length) {
      assert.equal(response.status, 200); assert.deepEqual(generated, ['gpt-5-mini']);
      assert.equal((await response.json()).model, 'gpt-5-mini');
    } else {
      assert.equal((await response.json()).error.code, 'MODEL_UNAVAILABLE'); assert.deepEqual(generated, []);
    }
  }
});

test('模型目录不受支持或暂不可用时只展示配置默认，不假称其他模型可用', async () => {
  for (const listing of [async () => Response.json({}, { status: 403 }), async () => { throw new TypeError('synthetic unavailable'); }]) {
    const { handle } = setup({ fetchOpenAI: listing });
    const value = await (await handle(request({ method: 'GET' }), { ...env, OPENAI_MODEL: 'gpt-5-mini' })).json();
    assert.deepEqual(value.models, ['gpt-5-mini']); assert.equal(value.defaultModel, 'gpt-5-mini');
  }
});

test('明确模型拒绝只回退一次，保留输入与总超时并返回实际模型', async () => {
  for (const [status, error] of [[404, { code: 'model_not_found' }], [400, { code: 'unsupported_model' }], [403, { code: 'forbidden', param: 'model' }]]) {
    const attempts = [], signals = [];
    const { handle } = setup({ fetchOpenAI: async (url, options) => {
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-5-mini' }] });
      attempts.push(JSON.parse(options.body)); signals.push(options.signal);
      return attempts.length === 1 ? Response.json({ error: { ...error, message: 'private upstream diagnostics' } }, { status }) : respond('回退后成功。');
    } });
    const response = await handle(request({ body: { ...payload, model: 'gpt-5-mini' } }), env);
    const value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.model, 'gpt-6.1-terra');
    assert.deepEqual(attempts.map(value => value.model), ['gpt-5-mini', 'gpt-6.1-terra']);
    assert.deepEqual(attempts[0].input, attempts[1].input); assert.equal(signals[0], signals[1]);
    assert.match(attempts[1].instructions, /gpt-6\.1-terra/);
    assert.ok(!JSON.stringify(value).includes('private upstream diagnostics'));
  }
});

test('默认模型失效可使用已确认的替代，但不循环尝试所有模型', async () => {
  const attempts = [];
  const { handle } = setup({ fetchOpenAI: async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-6.2-sol' }, { id: 'gpt-5-mini' }] });
    attempts.push(JSON.parse(options.body).model);
    return Response.json({ error: { code: 'model_not_found', message: 'never expose' } }, { status: 404 });
  } });
  const result = await handle(request(), env);
  assert.equal((await result.json()).error.code, 'MODEL_UNAVAILABLE');
  assert.deepEqual(attempts, ['gpt-6.1-terra', 'gpt-6.2-sol']);
});

test('回退优先选择本密钥曾成功且仍在目录中的模型', async () => {
  const attempts = [];
  const { handle } = setup({ fetchOpenAI: async (url, options) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-6.2-sol' }, { id: 'gpt-5-mini' }] });
    const model = JSON.parse(options.body).model; attempts.push(model);
    return model === 'gpt-6.1-terra' ? Response.json({ error: { code: 'model_not_found' } }, { status: 404 }) : respond();
  } });
  assert.equal((await handle(request({ body: { ...payload, model: 'gpt-5-mini' } }), env)).status, 200);
  const response = await handle(request(), env);
  assert.equal((await response.json()).model, 'gpt-5-mini');
  assert.deepEqual(attempts, ['gpt-5-mini', 'gpt-6.1-terra', 'gpt-5-mini']);
});

test('密钥、额度、限流、普通403及超时不触发模型回退，错误不泄漏上游原文', async () => {
  const cases = [
    [401, { code: 'invalid_api_key', param: 'model' }, 'OPENAI_AUTHENTICATION'],
    [429, { code: 'insufficient_quota' }, 'OPENAI_QUOTA'],
    [429, { code: 'credit_balance_exhausted' }, 'OPENAI_QUOTA'],
    [429, { code: 'rate_limit_exceeded' }, 'OPENAI_LIMIT'],
    [403, { code: 'unsupported_country_region_territory' }, 'OPENAI_ACCESS_DENIED'],
    [404, { code: 'not_found' }, 'OPENAI_UNAVAILABLE'],
    [503, { code: 'server_is_overloaded' }, 'OPENAI_UNAVAILABLE'],
    [0, null, 'OPENAI_TIMEOUT'],
  ];
  for (const [status, error, expected] of cases) {
    let calls = 0;
    const { handle } = setup({ fetchOpenAI: async url => {
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-5-mini' }] });
      calls++;
      if (!status) throw new DOMException('private upstream diagnostics', 'TimeoutError');
      return Response.json({ error: { ...error, message: 'private upstream diagnostics' } }, { status, headers: { 'Retry-After': '23' } });
    } });
    const response = await handle(request(), env), body = await response.json();
    assert.equal(body.error.code, expected); assert.equal(calls, 1);
    assert.ok(!JSON.stringify(body).includes('private upstream diagnostics'));
    if ([429, 503].includes(status) && expected !== 'OPENAI_QUOTA') assert.equal(response.headers.get('Retry-After'), '23');
  }
});

test('目录按密钥隔离缓存，轮换后不继续广告旧密钥的模型', async () => {
  let calls = 0;
  const { handle } = setup({ fetchOpenAI: async (_url, options) => {
    calls++;
    const model = options.headers.Authorization === 'Bearer test-key' ? 'gpt-6.1-terra' : 'gpt-5-mini';
    return Response.json({ data: [{ id: model }] });
  } });
  const first = await (await handle(request({ method: 'GET' }), env)).json();
  const second = await (await handle(request({ method: 'GET' }), { OPENAI_API_KEY: 'different-synthetic-key' })).json();
  assert.deepEqual(first.models, ['gpt-6.1-terra']); assert.deepEqual(second.models, ['gpt-5-mini']); assert.equal(calls, 2);
});

test('限流的HTTP日期提示转换为有限等待秒数，异常提示不转发', async () => {
  for (const [retry, expected] of [['Thu, 01 Jan 1970 00:01:00 GMT', '60'], ['not-a-delay', null], ['999999', null]]) {
    const { handle } = setup({ now: () => 0, fetchOpenAI: async url => url.endsWith('/models')
      ? Response.json({ data: [{ id: 'gpt-6.1-terra' }] })
      : Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'Retry-After': retry } }) });
    const result = await handle(request(), env);
    assert.equal((await result.json()).error.code, 'OPENAI_LIMIT'); assert.equal(result.headers.get('Retry-After'), expected);
  }
});

test('首次模型拒绝时预算已耗尽，不再发出回退请求', async () => {
  const controller = new AbortController(); let calls = 0;
  const { handle } = setup({ fetchOpenAI: async url => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6.1-terra' }, { id: 'gpt-5-mini' }] });
    calls++; controller.abort(new DOMException('synthetic deadline', 'TimeoutError'));
    return Response.json({ error: { code: 'model_not_found' } }, { status: 404 });
  } });
  const response = await handle(request({ signal: controller.signal }), env);
  assert.equal((await response.json()).error.code, 'OPENAI_TIMEOUT'); assert.equal(calls, 1);
});

test('成员服务返回重定向时停止校验，不联系模型', async () => {
  const { handle, verified, upstream } = setup({ account: 302 });
  const result = await handle(request(), env);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'MEMBER_CHECK_UNAVAILABLE');
  assert.deepEqual(verified, ['/auth/v1/user']);
  assert.deepEqual(upstream, []);
});

test('按作者和标题读取共享记录，不发送悄悄话、草稿、回收站或附件', async () => {
  const row = (index, fields = {}) => ({ id: `20000000-0000-4000-8000-00000000000${index}`,
    authorId: id, title: '阴天', author: { name: 'Bunny' }, occurredAt: '2026-11-18T00:00:00Z',
    status: 'published', type: 'note', deletedAt: null, tags: ['心情'], content: '可分析的共享文字。', ...fields });
  const selected = row(1, { media: [{ name: 'irrelevant-private-media' }] });
  const entries = [selected, row(2, { author: { name: '另一个人' }, content: 'wrong-author' }),
    row(3, { type: 'whisper', content: 'private-whisper' }), row(4, { status: 'draft', content: 'unfinished-draft' }),
    row(5, { deletedAt: '2026-11-18T11:00:00Z', content: 'deleted-text' })];
  const { handle, upstream, verified } = setup({ entries });
  const body = { messages: [{ role: 'user', content: '帮我分析 Bunny 发的这篇阴天的文章' }], model: 'gpt-5-mini' };
  const value = await (await handle(request({ body }), env)).json();
  assert.deepEqual(value.sources, [{ title: '阴天', href: `#timeline?entry=${selected.id}` }]);
  assert.equal(upstream[0].model, 'gpt-5-mini');
  const input = JSON.stringify(upstream[0].input);
  assert.match(input, /可分析的共享文字/u);
  assert.doesNotMatch(input, /wrong-author|private-whisper|unfinished-draft|deleted-text|irrelevant-private-media/);
  assert.deepEqual(verified.slice(-2), ['/rest/v1/entries', '/rest/v1/entries']);
  const hidden = await handle(request({ body: { ...body, articleSlug: entries[2].id } }), env);
  assert.deepEqual((await hidden.json()).sources, []);
  assert.equal(upstream.length, 1);
});

test('从无标题的共享随记发起提问，短问题也读取所选正文和作者', async () => {
  const selected = {
    id: '20000000-0000-4000-8000-000000000001', authorId: id, title: '', author: { name: '示例成员' },
    occurredAt: '2026-11-19T04:10:00Z', status: 'published', type: 'note', deletedAt: null,
    content: '想知道出游回来的朋友会不会带一张明信片。', tags: ['期待'],
  };
  const { handle, upstream, verified } = setup({ entries: [selected] });
  const response = await handle(request({ body: {
    articleSlug: selected.id, messages: [{ role: 'user', content: '你觉得会带吗？' }],
  } }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sources, [{ title: '2026-11-19 的随记', href: `#timeline?entry=${selected.id}` }]);
  assert.deepEqual(verified, ['/auth/v1/user', '/rest/v1/profiles', '/rest/v1/entries']);
  const input = upstream[0].input[0].content;
  assert.match(input, /示例成员/u);
  assert.match(input, /朋友会不会带一张明信片/u);
});

test('实时天气只向天气服务查询城市和坐标，无需发送聊天记录', async () => {
  const hosts = [];
  const { handle, upstream } = setup({ fetchWeather: async value => {
    const url = new URL(value);
    hosts.push(url.hostname);
    assert.ok(!url.search.includes('private-context'));
    if (url.pathname === '/v1/search') {
      assert.equal(url.searchParams.get('name'), '福州');
      return Response.json({ results: [{ name: '福州', admin1: '福建省', latitude: 26.08, longitude: 119.29 }] });
    }
    return Response.json({ daily: { temperature_2m_min: [16], temperature_2m_max: [24], weather_code: [3], precipitation_probability_max: [20] }, current: { temperature_2m: 20 } });
  } });
  const body = { messages: [{ role: 'user', content: 'private-context' }, { role: 'assistant', content: '之前的信息' }, { role: 'user', content: '今天福州天气怎么样' }] };
  const result = await (await handle(request({ body }), env)).json();
  assert.match(result.reply, /福建省·福州今天 阴，16–24℃/u);
  assert.deepEqual(hosts, ['geocoding-api.open-meteo.com', 'api.open-meteo.com']);
  assert.equal(upstream.length, 0);
});
