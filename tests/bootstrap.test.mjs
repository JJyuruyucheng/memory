import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBootstrapHandler, capabilityMatches, readJsonLimited, IDENTITIES, MIME_TYPES, BUCKET_ID } from '../supabase/bootstrap/core.mjs';
import { invokeBootstrap, EXPECTED_PROJECT_ORIGIN } from '../supabase/bootstrap/run.mjs';
import retired from '../supabase/bootstrap/retired.ts';

const NOW = 1800000000000;
const CAPABILITY = 'ab'.repeat(32); // Inert test fixture, never a deployment capability.
const DIGEST = createHash('sha256').update(CAPABILITY).digest('hex');
const PASSWORDS = { xbl: 'member-one-fixture', ll: 'member-two-fixture', 'memory-admin': 'admin-fixture-password' };
const IDS = IDENTITIES.map((_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`);
const user = index => ({ id: IDS[index], email: IDENTITIES[index].email, role: 'authenticated', aud: 'authenticated', is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: null });
const validBucket = () => ({ id: BUCKET_ID, name: BUCKET_ID, public: false, file_size_limit: 50000000, allowed_mime_types: [...MIME_TYPES] });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const policy = overrides => ({ enabled: true, prerequisitesVerified: true, projectOrigin: EXPECTED_PROJECT_ORIGIN, capabilitySha256: DIGEST, issuedAt: NOW - 1000, expiresAt: NOW + 599000, ...overrides });
function request({ url = 'https://temporary.invalid/bootstrap', headers = {}, method = 'POST', body = { passwords: PASSWORDS } } = {}) {
  return new Request(url, { method, headers: { Authorization: `Bearer ${CAPABILITY}`, 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
function cloud(options = {}) {
  const state = { users: options.users ? structuredClone(options.users) : [], bucket: options.bucket ? structuredClone(options.bucket) : null, calls: [] };
  async function fetcher(input, init) {
    const url = new URL(input);
    const call = { url: url.href, path: url.pathname, method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect };
    state.calls.push(call);
    if (options.hook) { const response = await options.hook(call, state); if (response) return response; }
    if (call.path === '/auth/v1/admin/users' && call.method === 'GET') return json({ users: state.users }, 200, { 'x-total-count': String(state.users.length) });
    if (call.path === `/storage/v1/bucket/${BUCKET_ID}` && call.method === 'GET') return state.bucket ? json(state.bucket) : json({ statusCode: 404 }, 404);
    if (call.path === '/storage/v1/bucket' && call.method === 'POST') { state.bucket = call.body; return json({ name: BUCKET_ID }); }
    if (call.path === '/auth/v1/admin/users' && call.method === 'POST') {
      const index = IDENTITIES.findIndex(identity => identity.email === call.body.email);
      if (index < 0) throw new Error('unexpected identity');
      const existing = state.users.find(item => item.email === call.body.email);
      if (existing) return json({ code: 'email_exists' }, 422);
      const created = user(index); state.users.push(created); return json(created);
    }
    throw new Error('unexpected endpoint');
  }
  return { state, fetch: fetcher };
}
function setup({ config = {}, server = {}, env = {}, clock = () => NOW } = {}) {
  const api = cloud(server);
  const values = { SUPABASE_URL: EXPECTED_PROJECT_ORIGIN, SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_bootstrap_test_fixture' }), ...env };
  return { ...api, handler: createBootstrapHandler(policy(config), { fetch: api.fetch, env: name => values[name], now: clock }) };
}
const writes = state => state.calls.filter(call => call.method !== 'GET');

test('inert/default/expired/overlong leases never access a project', async () => {
  for (const config of [{ enabled: false }, { prerequisitesVerified: false }, { expiresAt: NOW }, { expiresAt: NOW + 600000 }, { capabilitySha256: '0'.repeat(64) }]) {
    const { handler, state } = setup({ config });
    assert.equal((await handler(request())).status, 410);
    assert.equal(state.calls.length, 0);
  }
  assert.equal((await createBootstrapHandler({})(request())).status, 410);
});

test('capability uses a fixed SHA256 digest and rejects missing, malformed and changed values', async () => {
  assert.equal(await capabilityMatches(CAPABILITY, DIGEST), true);
  assert.equal(await capabilityMatches(`ac${CAPABILITY.slice(2)}`, DIGEST), false);
  for (const header of ['', 'Bearer short', `Bearer ${'cd'.repeat(32)}`]) {
    const { handler, state } = setup();
    assert.equal((await handler(request({ headers: { Authorization: header } }))).status, 401);
    assert.equal(state.calls.length, 0);
  }
});

test('method, browser Origin, query and JSON restrictions reject before upstream activity', async () => {
  for (const [input, status] of [
    [{ method: 'GET' }, 405], [{ headers: { Origin: 'https://untrusted.invalid' } }, 403],
    [{ url: 'https://temporary.invalid/bootstrap?capability=bad' }, 403], [{ headers: { 'Content-Type': 'text/plain' } }, 415], [{ body: '{' }, 400],
  ]) {
    const { handler, state } = setup(); assert.equal((await handler(request(input))).status, status); assert.equal(state.calls.length, 0);
  }
});

test('password shape, five-character member and short admin are rejected without writes', async () => {
  for (const body of [
    { passwords: { ...PASSWORDS, ll: '12345' } }, { passwords: { ...PASSWORDS, 'memory-admin': 'short-admin' } },
    { passwords: { ...PASSWORDS, stranger: 'unused' } }, { passwords: PASSWORDS, email: 'attacker@example.invalid' },
  ]) { const { handler, state } = setup(); assert.equal((await handler(request({ body }))).status, 400); assert.equal(state.calls.length, 0); }
});

test('streaming request size and duration limits do not trust Content-Length', async () => {
  const { handler, state } = setup();
  assert.equal((await handler(request({ body: ' '.repeat(16385) }))).status, 413);
  assert.equal(state.calls.length, 0);
  let canceled = false;
  const stalled = new Response(new ReadableStream({ start() {}, cancel() { canceled = true; } }));
  await assert.rejects(readJsonLimited(stalled, 100, 10), error => error.code === 'BODY_TIMEOUT');
  assert.equal(canceled, true);
});

test('wrong project or malformed secret dictionary fail closed and never fall back silently', async () => {
  for (const env of [
    { SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' },
    { SUPABASE_SECRET_KEYS: '{', SUPABASE_SERVICE_ROLE_KEY: 'legacy.fixture.jwt' },
    { SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: 'legacy.fixture.jwt' },
  ]) { const { handler, state } = setup({ env }); assert.equal((await handler(request())).status, 503); assert.equal(state.calls.length, 0); }
});

test('empty project creates only fixed ordinary Auth users and a strictly private bucket', async () => {
  const { handler, state } = setup();
  const response = await handler(request({ url: 'http://internal-edge-runtime/bootstrap' }));
  assert.equal(response.status, 200); // Public TLS may be terminated before this Request.
  const result = await response.json();
  assert.deepEqual(result.users.map(item => item.id), IDS);
  assert.equal(result.bucket, BUCKET_ID);
  assert.equal(writes(state).length, 4);
  for (const call of state.calls) {
    assert.equal(new URL(call.url).origin, EXPECTED_PROJECT_ORIGIN);
    assert.equal(call.redirect, 'error');
    assert.equal(call.headers.get('apikey'), 'sb_secret_bootstrap_test_fixture');
    assert.equal(call.headers.has('authorization'), false);
    assert.ok(!call.url.includes(CAPABILITY));
  }
  for (const call of writes(state).filter(call => call.path.startsWith('/auth/'))) {
    assert.deepEqual(Object.keys(call.body).sort(), ['email', 'email_confirm', 'password']);
    assert.equal(call.body.email_confirm, true);
  }
  assert.equal(state.bucket.public, false);
  assert.equal(state.bucket.file_size_limit, 50000000);
  assert.deepEqual(state.bucket.allowed_mime_types, [...MIME_TYPES]);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('sb_secret_') && !serialized.includes(CAPABILITY));
  for (const password of Object.values(PASSWORDS)) assert.ok(!serialized.includes(password));
});

test('existing users and bucket are reused without password reset, role update or write', async () => {
  const { handler, state } = setup({ server: { users: IDS.map((_, index) => user(index)), bucket: validBucket() } });
  const response = await handler(request()); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).users.map(item => item.created), [false, false, false]);
  assert.deepEqual(writes(state), []);
});

test('unknown, duplicate, unconfirmed, anonymous or elevated existing accounts stop preflight', async () => {
  const fixtures = [
    [{ ...user(0), email: 'stranger@memory.invalid' }], [user(0), user(0)],
    [{ ...user(0), role: 'service_role' }], [{ ...user(0), aud: 'admin' }],
    [{ ...user(0), is_anonymous: true }], [{ ...user(0), email_confirmed_at: null }], [{ ...user(0), banned_until: 'invalid-date' }],
  ];
  for (const users of fixtures) { const { handler, state } = setup({ server: { users } }); assert.equal((await handler(request())).status, 409); assert.deepEqual(writes(state), []); }
});

test('existing bucket public, size, wildcard MIME and incomplete MIME settings are never overwritten', async () => {
  for (const change of [{ public: true }, { file_size_limit: null }, { allowed_mime_types: ['image/*'] }, { allowed_mime_types: MIME_TYPES.slice(1) }]) {
    const { handler, state } = setup({ server: { bucket: { ...validBucket(), ...change } } });
    assert.equal((await handler(request())).status, 409); assert.deepEqual(writes(state), []);
  }
});

test('lease is rechecked between preflight and first mutation', async () => {
  let current = NOW;
  const { handler, state } = setup({ clock: () => current, server: { hook(call) { if (call.path.startsWith('/storage/')) current = NOW + 600000; } } });
  assert.equal((await handler(request())).status, 410); assert.deepEqual(writes(state), []);
});

test('legacy credential fallback stays on internal headers only', async () => {
  const { handler, state } = setup({ env: { SUPABASE_SECRET_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: 'legacy.fixture.jwt' } });
  const response = await handler(request()); assert.equal(response.status, 200);
  assert.ok(state.calls.every(call => call.headers.get('Authorization') === 'Bearer legacy.fixture.jwt'));
  assert.ok(!(await response.text()).includes('legacy.fixture.jwt'));
});

test('native error bodies and thrown secrets are replaced with generic errors', async () => {
  for (const hook of [() => json({ error: `${CAPABILITY} ${PASSWORDS.ll} sb_secret_do_not_echo` }, 500), () => { throw new Error('sb_secret_do_not_echo'); }]) {
    const { handler } = setup({ server: { hook } }); const response = await handler(request());
    assert.equal(response.status, 503); const body = await response.text();
    assert.ok(!body.includes(CAPABILITY) && !body.includes(PASSWORDS.ll) && !body.includes('sb_secret'));
  }
});

test('partial account creation can be resumed without resetting the first account', async () => {
  let failed = false;
  const api = cloud({ hook(call) {
    if (call.method === 'POST' && call.body?.email === IDENTITIES[1].email && !failed) { failed = true; return json({ error: 'fixture unavailable' }, 500); }
  } });
  const handler = createBootstrapHandler(policy(), { fetch: api.fetch, env: name => ({ SUPABASE_URL: EXPECTED_PROJECT_ORIGIN, SUPABASE_SECRET_KEYS: '{"default":"sb_secret_bootstrap_test_fixture"}' })[name], now: () => NOW });
  assert.equal((await handler(request())).status, 503); assert.equal(api.state.users.length, 1);
  assert.equal((await handler(request())).status, 200); assert.equal(api.state.users.length, 3);
  assert.equal(api.state.calls.filter(call => call.method === 'POST' && call.body?.email === IDENTITIES[0].email).length, 1);
  assert.ok(api.state.calls.every(call => !['PUT', 'PATCH', 'DELETE'].includes(call.method)));
});

test('short response bodies, capped reads and fixed pagination are handled safely', async () => {
  const { handler } = setup({ server: { hook() { return new Response(' '.repeat(131073), { status: 200 }); } } });
  assert.equal((await handler(request())).status, 503);
  const api = setup({ server: { users: IDS.map((_, index) => user(index)), bucket: validBucket(), hook(call) {
    if (call.method === 'GET' && call.path === '/auth/v1/admin/users') {
      const page = Number(new URL(call.url).searchParams.get('page'));
      return json({ users: [user(page - 1)] }, 200, { 'x-total-count': '3', ...(page < 3 ? { link: '<https://attacker.invalid/ignore>; rel="next"' } : {}) });
    }
  } } });
  assert.equal((await api.handler(request())).status, 200);
  assert.ok(api.state.calls.every(call => new URL(call.url).origin === EXPECTED_PROJECT_ORIGIN));
});

test('trusted client refuses wrong host, plaintext URL or query and outputs only UUID/status', async () => {
  for (const endpoint of ['http://ijtrfjehqtoptsmsotin.supabase.co/functions/v1/temp', 'https://attacker.invalid/functions/v1/temp', `${EXPECTED_PROJECT_ORIGIN}/functions/v1/temp?token=bad`]) {
    await assert.rejects(invokeBootstrap({ endpoint, capability: CAPABILITY, passwords: PASSWORDS, fetch: () => { throw new Error('must not fetch'); } }));
  }
  const result = await invokeBootstrap({ endpoint: `${EXPECTED_PROJECT_ORIGIN}/functions/v1/temp`, capability: CAPABILITY, passwords: PASSWORDS, fetch: async (url, init) => {
    assert.equal(init.redirect, 'error'); assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${CAPABILITY}`);
    return json({ users: IDENTITIES.map((identity, index) => ({ username: identity.username, id: IDS[index], created: true, secret: 'must-not-print' })), bucket: BUCKET_ID, password: 'must-not-print' });
  } });
  assert.ok(!JSON.stringify(result).includes('must-not-print'));
});

test('retired endpoint ignores old credentials and all methods with HTTP410', async () => {
  for (const method of ['POST', 'GET', 'OPTIONS']) {
    const response = retired.fetch(new Request('https://temporary.invalid', { method, headers: { Authorization: `Bearer ${CAPABILITY}` } }));
    assert.equal(response.status, 410); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
