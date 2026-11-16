import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGateway, createMemoryRateLimitStore, createMemoryReplayStore } from '../deploy/auth-gateway.mjs';

const PUBLIC_ORIGIN = 'https://memory.example.test';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'chaoxi-gateway-test-'));
  await mkdir(path.join(directory, 'src'));
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>登录页</title>');
  await writeFile(path.join(directory, 'src', 'main.js'), 'export const ready = true;');
  await writeFile(path.join(directory, 'assets', 'credits.json'), '[]');
  await writeFile(path.join(directory, '.env'), 'THIS_MUST_NOT_BE_SERVED=1');
  const calls = [];
  const upstreamFetch = async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ target, ...options });
    if (target.hostname === 'challenges.cloudflare.com') return json({ success: true, hostname: 'memory.example.test', action: 'login' });
    if (target.pathname === '/memos.api.AuthService/SignIn') return json({ user: { name: 'users/member-one' }, accessToken: 'fake-short-lived-token', accessTokenExpireTime: '2099-01-01T00:00:00Z' }, 200, { 'Set-Cookie': 'refresh=fake-test-cookie; Path=/; HttpOnly; Secure; SameSite=Lax' });
    return json({ upstream: true }, 200, { 'Set-Cookie': 'refresh=rotated-test-cookie; Path=/; HttpOnly; Secure; SameSite=Lax' });
  };
  const server = createGateway({ publicOrigin: PUBLIC_ORIGIN, siteKey: 'configured-site-key', secretKey: 'configured-server-secret',
    allowedUsers: ['member-one', 'member-two', 'maintenance'], staticDir: directory, upstream: 'http://127.0.0.1:5230',
    fetch: overrides.fetch || upstreamFetch, ...overrides });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const login = (extra = {}, headers = {}) => fetch(`${base}/auth/login`, { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ username: 'member-one', password: 'test-only-password', captchaToken: `fresh-${crypto.randomUUID()}`, ...extra }) });
  return { server, base, calls, login, upstreamFetch };
}

test('unconfigured gateway serves a login shell but never forwards credentials', async t => {
  const { base, login, calls } = await fixture(t, { siteKey: '', secretKey: '' });
  const config = await (await fetch(`${base}/auth/config`)).json();
  assert.deepEqual(config, { configured: false, siteKey: null, action: 'login' });
  assert.equal((await login()).status, 503);
  assert.equal(calls.length, 0);
  const shell = await fetch(base);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-security-policy'), /script-src[^;]+https:\/\/challenges\.cloudflare\.com/);
  assert.match(shell.headers.get('content-security-policy'), /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.equal(shell.headers.get('cache-control'), 'private, no-store');
});

test('public configuration never leaks secrets or account names; production test keys fail closed', async t => {
  const { base } = await fixture(t);
  const config = await (await fetch(`${base}/auth/config`)).json();
  assert.deepEqual(config, { configured: true, siteKey: 'configured-site-key', action: 'login' });
  assert.ok(!JSON.stringify(config).includes('member-one'));
  assert.ok(!JSON.stringify(config).includes('configured-server-secret'));
  const unsafe = await fixture(t, { siteKey: '1x00000000000000000000AA' });
  assert.equal((await (await fetch(`${unsafe.base}/auth/config`)).json()).configured, false);
  assert.equal((await unsafe.login()).status, 503);
  for (const allowedUsers of [[], ['member-one'], ['member-one', 'member-one', 'member-two'], ['user@bad', 'member-two']]) {
    const invalid = await fixture(t, { allowedUsers });
    assert.equal((await invalid.login()).status, 503);
  }
});

test('successful CAPTCHA precedes native Memos credentials; HttpOnly refresh cookie is forwarded', async t => {
  const { login, calls } = await fixture(t);
  const response = await login({ captchaToken: 'valid-test-token' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await response.json()).accessToken, 'fake-short-lived-token');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].target.hostname, 'challenges.cloudflare.com');
  assert.deepEqual(JSON.parse(calls[0].body), { secret: 'configured-server-secret', response: 'valid-test-token' });
  assert.ok(!calls[0].body.includes('test-only-password'));
  assert.equal(calls[1].target.pathname, '/memos.api.AuthService/SignIn');
  assert.deepEqual(JSON.parse(calls[1].body), { passwordCredentials: { username: 'member-one', password: 'test-only-password' } });
  assert.equal(calls[1].headers['X-Forwarded-Proto'], 'https');
});

test('missing CAPTCHA, wrong Origin and oversized requests never send a password upstream', async t => {
  const { base, login, calls } = await fixture(t);
  assert.equal((await login({ captchaToken: '' })).status, 401);
  assert.equal((await login({}, { Origin: 'https://evil.example.test' })).status, 403);
  assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await login({ password: 'a'.repeat(18000) })).status, 413);
  assert.equal(calls.length, 0);
});

test('failed, wrong-host and wrong-action CAPTCHA cannot reach native login', async t => {
  for (const verification of [
    { success: false, hostname: 'memory.example.test', action: 'login' },
    { success: true, hostname: 'evil.example.test', action: 'login' },
    { success: true, hostname: 'memory.example.test', action: 'register' },
  ]) {
    let nativeLogins = 0;
    const { login } = await fixture(t, { fetch: async url => {
      if (new URL(url).hostname === 'challenges.cloudflare.com') return json(verification);
      nativeLogins += 1; return json({});
    } });
    assert.equal((await login()).status, 401);
    assert.equal(nativeLogins, 0);
  }
});

test('CAPTCHA timeout fails closed before native password authentication', async t => {
  let nativeLogins = 0;
  const { login } = await fixture(t, { verifyTimeoutMs: 10, fetch: (url, options) => {
    if (new URL(url).hostname !== 'challenges.cloudflare.com') { nativeLogins++; return Promise.resolve(json({})); }
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  assert.equal((await login()).status, 503);
  assert.equal(nativeLogins, 0);
});

test('unknown, wrong-case and wrong-password accounts have the same public error', async t => {
  const attempts = [];
  const { login } = await fixture(t, { fetch: async (url, options) => {
    if (new URL(url).hostname === 'challenges.cloudflare.com') return json({ success: true, hostname: 'memory.example.test', action: 'login' });
    attempts.push(JSON.parse(options.body).passwordCredentials.username);
    return json({ message: 'untrusted account-specific message' }, 401);
  } });
  const first = await login({ username: 'unknown-user' });
  const second = await login({ username: 'Member-One' });
  const third = await login({ username: 'member-one' });
  assert.equal(first.status, 401); assert.equal(second.status, 401); assert.equal(third.status, 401);
  assert.equal(await first.text(), await third.text());
  assert.deepEqual(attempts, ['member-one']);
});

test('parallel replay is blocked locally before a second remote verification or password attempt', async t => {
  const { login, calls } = await fixture(t);
  const responses = await Promise.all([login({ captchaToken: 'same-one-time-token' }), login({ captchaToken: 'same-one-time-token' })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  assert.equal(calls.filter(call => call.target.hostname === 'challenges.cloudflare.com').length, 1);
  assert.equal(calls.filter(call => call.target.pathname.endsWith('/SignIn')).length, 1);
});

test('rate limits use normalized accounts and socket IP rather than spoofable forwarded headers', async t => {
  const byIp = await fixture(t, { rateLimits: { ip: { limit: 1, windowMs: 60000 } } });
  assert.equal((await byIp.login({}, { 'X-Forwarded-For': '1.2.3.4' })).status, 200);
  const ipBlocked = await byIp.login({}, { 'X-Forwarded-For': '5.6.7.8', 'CF-Connecting-IP': '9.9.9.9' });
  assert.equal(ipBlocked.status, 429);
  assert.ok(Number(ipBlocked.headers.get('retry-after')) > 0);
  const byAccount = await fixture(t, { rateLimits: { account: { limit: 1, windowMs: 60000 } } });
  assert.equal((await byAccount.login({ username: 'member-one' })).status, 200);
  assert.equal((await byAccount.login({ username: 'MEMBER-ONE' })).status, 429);
  const global = await fixture(t, { rateLimits: { global: { limit: 1, windowMs: 60000 } } });
  assert.equal((await global.login({ username: 'member-one' })).status, 200);
  assert.equal((await global.login({ username: 'member-two' })).status, 429);
});

test('memory stores enforce bounded cardinality, atomic replay and expiry; persistent stores can be injected', async t => {
  let time = 0;
  const replay = createMemoryReplayStore({ maxEntries: 1, now: () => time });
  assert.equal(replay.consume('a', 100), true);
  assert.equal(replay.consume('a', 100), false);
  assert.equal(replay.consume('b', 100), false);
  time = 101;
  assert.equal(replay.consume('b', 200), true);
  const rate = createMemoryRateLimitStore({ maxEntries: 1 });
  assert.equal(rate.consume('a', { limit: 1, windowMs: 100, now: 0 }).allowed, true);
  assert.equal(rate.consume('b', { limit: 1, windowMs: 100, now: 0 }).allowed, false);
  assert.equal(rate.consume('b', { limit: 1, windowMs: 100, now: 101 }).allowed, true);
  const consumed = [];
  const { login } = await fixture(t, { tokenStore: { consume: async (key, expiresAt) => { consumed.push({ key, expiresAt }); return false; } } });
  assert.equal((await login({ captchaToken: 'must-be-hashed' })).status, 401);
  assert.match(consumed[0].key, /^[a-f0-9]{64}$/);
  assert.ok(!consumed[0].key.includes('must-be-hashed'));
});

test('raw login, registration, alternate Connect and share paths cannot bypass the gateway', async t => {
  const { base, calls } = await fixture(t);
  for (const endpoint of ['/api/auth/signin', '/api/auth/signup', '/api/v1/auth/signin', '/api/users', '/memos.api.AuthService/SignIn', '/memos.api.AuthService/SignUp', '/memos.api.UserService/CreateUser']) {
    const response = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, Authorization: 'Bearer fake', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403, endpoint);
  }
  for (const endpoint of ['/api/shares/token/memo', '/api/memos/test/shares', '/file/attachments/test/photo.jpg?share_token=secret']) {
    assert.equal((await fetch(`${base}${endpoint}`, { headers: { Authorization: 'Bearer fake' } })).status, 403, endpoint);
  }
  assert.equal(calls.length, 0);
});

test('ordinary API/media need Bearer auth; approved session refresh forwards cookies and Origin', async t => {
  const { base, calls } = await fixture(t);
  assert.equal((await fetch(`${base}/api/memos`)).status, 401);
  assert.equal((await fetch(`${base}/file/attachments/id/picture.jpg`)).status, 401);
  const api = await fetch(`${base}/api/memos?pageSize=3`, { headers: { Authorization: 'Bearer member-token' } });
  assert.equal(api.status, 200);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer member-token');
  assert.equal(calls.at(-1).target.search, '?pageSize=3');
  const session = await fetch(`${base}/memos.api.AuthService/RefreshToken`, { method: 'POST', headers: { Origin: PUBLIC_ORIGIN, Cookie: 'refresh=existing', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 200);
  assert.match(session.headers.get('set-cookie'), /rotated-test-cookie/);
  assert.equal(calls.at(-1).headers.cookie, 'refresh=existing');
  assert.equal((await fetch(`${base}/api/memos`, { method: 'POST', headers: { Authorization: 'Bearer member-token', Origin: 'https://evil.example.test' }, body: '{}' })).status, 403);
});

test('proxy streams authorized media and preserves Range without caching private content', async t => {
  let forwarded;
  const { base } = await fixture(t, { fetch: async (url, options) => { forwarded = options; return new Response(new Uint8Array([3, 4]), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-3/8', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=999' } }); } });
  const response = await fetch(`${base}/file/attachments/test/video.mp4`, { headers: { Authorization: 'Bearer a-token', Range: 'bytes=2-3' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-3/8');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [3, 4]);
  assert.equal(forwarded.headers.range, 'bytes=2-3');
});

test('client disconnection cancels the private-media upstream stream', async t => {
  let aborted = false;
  const { base } = await fixture(t, { fetch: async (url, options) => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      options.signal.addEventListener('abort', () => { aborted = true; controller.error(new Error('cancelled')); }, { once: true });
    } });
    return new Response(body, { headers: { 'Content-Type': 'video/mp4' } });
  } });
  const controller = new AbortController();
  const response = await fetch(`${base}/file/attachments/test/video.mp4`, { headers: { Authorization: 'Bearer a-token' }, signal: controller.signal });
  assert.equal(response.status, 200);
  controller.abort();
  for (let attempt = 0; attempt < 20 && !aborted; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(aborted, true);
});

test('only built static assets are served, including explicit credits JSON', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/src/main.js`)).status, 200);
  assert.equal((await fetch(`${base}/assets/credits.json`)).status, 200);
  for (const endpoint of ['/.env', '/deploy/auth-gateway.mjs', '/src/main.js.map', '/package.json', '/assets/unknown.json', '/%252e%252e/.env']) {
    assert.ok([400, 404].includes((await fetch(`${base}${endpoint}`)).status), endpoint);
  }
});

test('proxy trust is rejected until a platform boundary has actually been verified', () => {
  assert.throws(() => createGateway({ publicOrigin: PUBLIC_ORIGIN, trustProxy: true }), /可信代理边界/);
  assert.throws(() => createGateway({ publicOrigin: 'http://public.example.test' }), /HTTPS/);
});
