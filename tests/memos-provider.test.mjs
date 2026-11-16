import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemosProvider, encodeEntryContent } from '../src/memos-provider.js';

const now = '2026-11-16T02:00:00Z';
const input = () => ({ type: 'note', title: '', content: '一件小事', occurredAt: now, mood: null, tags: [], media: [] });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function fixture({ author = 'users/one', rawContent, wrongSpace = false, anonymous = false, failMutation = false, html = false, expireOnce = false, version = '26.11.1', publicInstance = false, registrationOpen = false, beforeRequest } = {}) {
  const calls = []; let refreshes = 0; let expired = false;
  const user = { name: 'users/one', username: 'one', displayName: '成员一', role: 'USER' };
  let memo = { name: 'memos/record-1', creator: author, space: wrongSpace ? 'spaces/elsewhere' : 'spaces/together', visibility: 'SPACE', content: rawContent ?? encodeEntryContent(input()), createTime: now, updateTime: now, attachments: [], reactions: [] };
  const fetch = async (path, options) => {
    calls.push({ path, ...options });
    const url = new URL(path, 'https://memory.example.com'); const body = options.body ? JSON.parse(options.body) : {};
    if (beforeRequest) await beforeRequest({ path: url.pathname, options, body });
    if (url.pathname === '/memos.api.AuthService/RefreshToken') { refreshes++; return anonymous ? json({}, 401) : json({ accessToken: `secret-token-${refreshes}`, accessTokenExpireTime: '2099-01-01T00:00:00Z' }); }
    if (url.pathname === '/auth/login') return json({ user, accessToken: 'secret-token-login', accessTokenExpireTime: '2099-01-01T00:00:00Z' });
    if (url.pathname === '/api/instance/profile') return json({ version, accessMode: publicInstance ? 'INSTANCE_ACCESS_MODE_PUBLIC' : 'INSTANCE_ACCESS_MODE_PRIVATE' });
    if (url.pathname === '/api/instance/settings/GENERAL') return json({ generalSetting: { disallowUserRegistration: !registrationOpen } });
    if (url.pathname === '/api/auth/me') return json({ user });
    if (url.pathname === '/memos.api.AuthService/SignOut') return json({});
    if (url.pathname === '/api/spaces/together') return json({ name: 'spaces/together', title: '朝夕', currentUserRole: 'USER' });
    if (url.pathname.endsWith('/members')) return json({ spaceMembers: [{ user: 'users/one', role: 'USER' }] });
    if (url.pathname === '/api/users/one') return json(user);
    if (url.pathname === '/api/memos' && options.method === 'GET') {
      if (expireOnce && !expired) { expired = true; return json({}, 401); }
      if (html) return new Response('<html>wrong proxy</html>', { headers: { 'Content-Type': 'text/html' } });
      return json({ memos: [memo] });
    }
    if (url.pathname.endsWith('/comments')) return json({ comments: [] });
    if (url.pathname === '/api/memos/record-1' && options.method === 'GET') return json(memo);
    if (options.method === 'PATCH' && url.pathname === '/api/memos/record-1') {
      if (failMutation) throw new Error('network was lost');
      memo = { ...memo, ...body, updateTime: new Date(Date.parse(memo.updateTime) + 1000).toISOString() }; return json(memo);
    }
    throw new Error(`Unexpected mock request: ${options.method} ${url.pathname}`);
  };
  const provider = createMemosProvider({ space: 'spaces/together', fetch });
  return { provider, calls, refreshes: () => refreshes, memo: () => memo };
}

test('anonymous init preserves a real logged-out state', async () => {
  const { provider, calls } = fixture({ anonymous: true });
  const state = await provider.init();
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.equal(calls.length, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('logout cancels a delayed login response; duplicate login is rejected and cannot revive credentials', async () => {
  const entered = deferred(), release = deferred(); let hold = true;
  const { provider, calls } = fixture({ anonymous: true, beforeRequest: async ({ path }) => {
    if (path === '/auth/login' && hold) { hold = false; entered.resolve(); await release.promise; }
  } });
  const state = await provider.init();
  const login = provider.login('one', 'test-password', 'captcha-one');
  const cancelled = assert.rejects(login, error => error.code === 'AUTH_CANCELLED');
  await entered.promise;
  await assert.rejects(provider.login('two', 'another-test-password', 'captcha-two'), error => error.code === 'AUTH_BUSY');
  assert.equal(calls.filter(call => call.path === '/auth/login').length, 1);
  await provider.logout();
  assert.equal(state.currentUser, null);
  assert.ok(calls.find(call => call.path === '/auth/login').signal.aborted);
  release.resolve(); await cancelled;
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.ok(!calls.some(call => call.path === '/api/instance/profile'), 'a stale login never starts loading private data');
  const fresh = await provider.login('one', 'test-password', 'new-captcha');
  assert.equal(fresh, state); assert.equal(state.currentUser.id, 'users/one', 'a cancelled attempt does not poison the next real login');
  await provider.logout();
});

test('logout during login hydration rejects the late result instead of restoring currentUser or records', async () => {
  const entered = deferred(), release = deferred();
  const { provider, calls } = fixture({ anonymous: true, beforeRequest: async ({ path, options }) => {
    if (path === '/api/memos' && options.method === 'GET') { entered.resolve(); await release.promise; }
  } });
  const state = await provider.init();
  const login = provider.login('one', 'test-password', 'captcha');
  const cancelled = assert.rejects(login, error => error.code === 'AUTH_CANCELLED');
  await entered.promise;
  await provider.logout();
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.equal(calls.find(call => call.path.endsWith('/SignOut')).headers.Authorization, 'Bearer secret-token-login');
  release.resolve(); await cancelled;
  assert.equal(state.currentUser, null); assert.deepEqual(state.users, []); assert.deepEqual(state.entries, []);
});

test('logout wins over a delayed session refresh and never performs a fresh authentication to sign out', async () => {
  const entered = deferred(), release = deferred(); let holdRefresh = false;
  const { provider, calls } = fixture({ beforeRequest: async ({ path }) => {
    if (path.endsWith('/RefreshToken') && holdRefresh) { entered.resolve(); await release.promise; }
  } });
  const state = await provider.login('one', 'test-password', 'captcha');
  holdRefresh = true;
  const refresh = provider.init();
  const cancelled = assert.rejects(refresh, error => error.code === 'AUTH_CANCELLED');
  await entered.promise;
  const privateRequests = calls.filter(call => call.path.startsWith('/api/')).length;
  await provider.logout();
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.equal(calls.filter(call => call.path.endsWith('/RefreshToken')).length, 1, 'logout does not call refresh');
  release.resolve(); await cancelled;
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.equal(calls.filter(call => call.path.startsWith('/api/')).length, privateRequests, 'stale refresh cannot load another private state');
  holdRefresh = false;
  await provider.login('one', 'test-password', 'new-captcha');
  assert.equal(state.currentUser.id, 'users/one');
  await provider.logout();
});

test('a delayed mutation and queued work reject after logout without restoring private state or starting new requests', async () => {
  const entered = deferred(), release = deferred();
  const { provider, calls } = fixture({ beforeRequest: async ({ path, options }) => {
    if (path === '/api/memos/record-1' && options.method === 'PATCH') { entered.resolve(); await release.promise; }
  } });
  const state = await provider.login('one', 'test-password', 'captcha');
  const save = provider.saveEntry({ ...state.entries[0], content: 'late response' });
  const queued = provider.deleteEntry('memos/record-1');
  const cancelledSave = assert.rejects(save, error => error.code === 'AUTH_CANCELLED');
  const cancelledQueued = assert.rejects(queued, error => error.code === 'AUTH_CANCELLED');
  await entered.promise;
  await provider.logout();
  release.resolve(); await Promise.all([cancelledSave, cancelledQueued]);
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.deepEqual(state.users, []);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1, 'queued work never reaches the server after logout');
  assert.ok(!calls.some(call => call.path.endsWith('/RefreshToken')), 'old operations cannot silently reauthenticate');
});

test('failed server sign-out still clears local state and rejects instead of claiming confirmed logout', async () => {
  const { provider } = fixture({ beforeRequest: async ({ path }) => {
    if (path.endsWith('/SignOut')) throw new Error('server connection lost');
  } });
  const state = await provider.login('one', 'test-password', 'captcha');
  await assert.rejects(provider.logout(), error => error.code === 'NETWORK');
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.deepEqual(state.users, []);
});

test('login sends CAPTCHA to the protected gateway and never publishes credentials in state', async () => {
  const { provider, calls } = fixture(); const password = 'should-never-be-stored';
  const state = await provider.login('one', password, 'verified-test-token');
  assert.deepEqual(JSON.parse(calls[0].body), { username: 'one', password, captchaToken: 'verified-test-token' });
  assert.equal(calls[0].path, '/auth/login');
  assert.ok(calls.every(call => call.credentials === 'same-origin'));
  assert.ok(!calls.some(call => call.path.endsWith('/SignIn')));
  assert.ok(!JSON.stringify(state).includes('secret-token')); assert.ok(!JSON.stringify(state).includes(password));
  assert.equal(state.entries[0].content, '一件小事'); assert.equal(state.entries[0].mood, null);
  await provider.logout(); assert.equal(state.currentUser, null); assert.equal(state.entries.length, 0);
});

test('SPACE is checked on returned data as well as the request filter', async () => {
  const { provider, calls } = fixture({ wrongSpace: true });
  await assert.rejects(provider.login('one', 'password', 'verified-test-token'), error => error.code === 'WRONG_SPACE');
  const list = calls.find(call => call.path.startsWith('/api/memos?'));
  assert.equal(new URL(list.path, 'https://example.com').searchParams.get('filter'), 'space == "spaces/together" && visibility == "SPACE"');
});

test('a member cannot edit the other author even if UI is bypassed', async () => {
  const { provider, calls } = fixture({ author: 'users/two' }); await provider.login('one', 'password', 'verified-test-token');
  await assert.rejects(provider.saveEntry({ id: 'memos/record-1', ...input() }), error => error.status === 403);
  assert.ok(!calls.some(call => call.method === 'PATCH'));
});

test('delete and restore are reversible content updates, never physical memo DELETE', async () => {
  const { provider, calls } = fixture(); const state = await provider.login('one', 'password', 'verified-test-token'); const entries = state.entries;
  await provider.deleteEntry('memos/record-1'); assert.ok(state.entries[0].deletedAt);
  await provider.restoreEntry('memos/record-1'); assert.equal(state.entries[0].deletedAt, null); assert.equal(state.entries, entries);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 2);
  assert.ok(!calls.some(call => call.method === 'DELETE'));
});

test('unknown metadata versions stop reads and cannot be silently overwritten', async () => {
  const { provider, calls } = fixture({ rawContent: '<!-- chaoxi-entry:v2:YWJj -->\n\nnew schema' });
  await assert.rejects(provider.login('one', 'password', 'verified-test-token'), error => error.code === 'INVALID_ENVELOPE');
  assert.ok(!calls.some(call => call.method === 'PATCH'));
});

test('one failed native request refreshes the HttpOnly session and retries once', async () => {
  const { provider, calls, refreshes } = fixture({ expireOnce: true }); await provider.login('one', 'password', 'verified-test-token');
  assert.equal(refreshes(), 1);
  const attempts = calls.filter(call => call.path.startsWith('/api/memos?'));
  assert.equal(attempts.length, 2); assert.equal(attempts[1].headers.Authorization, 'Bearer secret-token-1');
});

test('network failures never report successful saves or mutate the visible state', async () => {
  const { provider } = fixture({ failMutation: true }); const state = await provider.login('one', 'password', 'verified-test-token');
  await assert.rejects(provider.saveEntry({ ...state.entries[0], content: '未确认的修改' }), error => error.code === 'NETWORK');
  assert.equal(state.entries[0].content, '一件小事');
});

test('an HTML reverse-proxy fallback is detected instead of treated as empty data', async () => {
  const { provider } = fixture({ html: true });
  await assert.rejects(provider.login('one', 'password', 'verified-test-token'), error => error.code === 'INVALID_RESPONSE');
});

test('ordinary members get an explicit common-settings permission error', async () => {
  const { provider, calls } = fixture(); const state = await provider.login('one', 'password', 'verified-test-token');
  await assert.rejects(provider.saveSettings(state.settings), error => error.status === 403);
  assert.ok(!calls.some(call => call.method === 'PATCH'));
});

test('unverified versions and unsafe instance policies are rejected before loading records', async () => {
  for (const [options, code] of [[{ version: 'main' }, 'UNSUPPORTED_VERSION'], [{ publicInstance: true }, 'PUBLIC_INSTANCE'], [{ registrationOpen: true }, 'REGISTRATION_OPEN']]) {
    const { provider, calls } = fixture(options);
    await assert.rejects(provider.login('one', 'password', 'verified-test-token'), error => error.code === code);
    assert.ok(!calls.some(call => call.path.startsWith('/api/memos?')));
  }
});

test('missing CAPTCHA never sends credentials or loads private data', async () => {
  const { provider, calls } = fixture();
  await assert.rejects(provider.login('one', 'password'), error => error.code === 'CAPTCHA_REQUIRED');
  assert.equal(calls.length, 0);
});
