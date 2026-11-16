import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createMemosProvider } from '../src/memos-provider.js';
import { initialize } from '../deploy/init.mjs';
import { createGateway } from '../deploy/auth-gateway.mjs';
import { bootstrapHosted, hostedConfig, verifyHostedInstance } from '../deploy/hosted-start.mjs';

function cookieFetch(origin) {
  let cookie = '';
  return async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
    const value = response.headers.get('set-cookie'); if (value) cookie = value.split(';')[0];
    return response;
  };
}

async function availablePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}

test('official Memos 26.11.1: accounts, SPACE, media, comments, reactions, export, soft deletion', { skip: !process.env.MEMOS_BINARY, timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaoxi-memos-test-'));
  const port = await availablePort(); const base = `http://127.0.0.1:${port}`;
  const gatewayPort = await availablePort(); const publicOrigin = `http://127.0.0.1:${gatewayPort}`;
  const child = spawn(process.env.MEMOS_BINARY, ['--addr', '127.0.0.1', '--port', String(port), '--data', directory, '--instance-url', publicOrigin, '--config-apply', 'off'], { stdio: 'ignore', windowsHide: true });
  let processError; child.on('error', error => { processError = error; });
  const providers = []; let gateway;
  try {
    let ready = false;
    for (let index = 0; index < 100; index++) {
      if (processError) throw processError;
      try { if ((await fetch(`${base}/api/instance/profile`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'official server must become ready');
    const password = `Integration-${crypto.randomUUID()}-1A`;
    const admin = { username: 'test-admin', name: '维护者', password };
    const members = [{ username: 'test-one', name: '小满', password: crypto.randomUUID().slice(0, 6) }, { username: 'test-two', name: '阿辰', password: crypto.randomUUID().slice(0, 6) }];
    const options = { base, admin, members, startDate: '2020-01-01' };
    const hosted = { ...hostedConfig({ PUBLIC_ORIGIN: publicOrigin, MEMORY_ADMIN_USERNAME: admin.username, MEMORY_ADMIN_PASSWORD: admin.password, MEMORY_MEMBER_ONE_USERNAME: members[0].username, MEMORY_MEMBER_ONE_PASSWORD: members[0].password, MEMORY_MEMBER_TWO_USERNAME: members[1].username, MEMORY_MEMBER_TWO_PASSWORD: members[1].password, MEMORY_DATA_DIR: directory }), memosOrigin: base };
    let interruptOnce = true;
    await assert.rejects(bootstrapHosted(hosted, async (url, init) => {
      if (interruptOnce && /\/invitations\/[^/]+:accept$/.test(new URL(url).pathname) && init.method === 'POST') { interruptOnce = false; throw new Error('simulated first-initialization interruption'); }
      return fetch(url, init);
    }), /simulated first-initialization interruption/);
    const pendingMarker = await readFile(join(directory, '.chaoxi-bootstrap-v1.json'), 'utf8');
    assert.equal(JSON.parse(pendingMarker).status, 'pending');
    assert.ok(!pendingMarker.includes(password)); assert.ok(!pendingMarker.includes(admin.username));
    await bootstrapHosted(hosted); await verifyHostedInstance(hosted);
    assert.equal(JSON.parse(await readFile(join(directory, '.chaoxi-bootstrap-v1.json'), 'utf8')).status, 'complete');
    await bootstrapHosted({ ...hosted, members: members.map(value => ({ ...value, password: crypto.randomUUID().slice(0, 6) })) });
    const initialized = await initialize(options);
    assert.equal(initialized.privateAccess, true); assert.equal(initialized.members.length, 3);
    assert.equal((await initialize(options)).registrationClosed, true, 'initialization can be rerun without resetting credentials');
    gateway = createGateway({ publicOrigin, upstream: base, staticDir: directory, siteKey: 'integration-public-key', secretKey: 'integration-secret-key', allowedUsers: [members[0].username, members[1].username, admin.username], production: false, fetch: async (url, init) => String(url) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' ? new Response(JSON.stringify({ success: true, hostname: '127.0.0.1', action: 'login' }), { headers: { 'Content-Type': 'application/json' } }) : fetch(url, init) });
    await new Promise(resolve => gateway.listen(gatewayPort, '127.0.0.1', resolve));
    const captcha = () => `integration-${crypto.randomUUID()}`;
    assert.equal((await fetch(`${publicOrigin}/api/memos`)).status, 401);
    assert.ok([403, 404].includes((await fetch(`${publicOrigin}/memos.api.AuthService/SignIn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status), 'native sign-in is blocked at the public gateway');
    const makeProvider = () => {
      const provider = createMemosProvider({ apiBase: publicOrigin, space: 'spaces/together', fetch: cookieFetch(publicOrigin) });
      providers.push(provider); return provider;
    };
    const first = makeProvider();
    assert.equal((await first.init()).currentUser, null);
    const state = await first.login(members[0].username, members[0].password, captcha()); const entriesReference = state.entries;
    assert.equal(state.users.length, 3);
    const png = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z3L8AAAAASUVORK5CYII=', 'base64')], '微小图片.png', { type: 'image/png' });
    const entry = await first.saveEntry({ type: 'event', title: '真实 API 测试', content: '<script>untrusted text</script>\n今天很开心。', occurredAt: '2026-11-15T03:00:00Z', mood: 'happy', tags: ['测试'] }, [png]);
    assert.equal(state.entries, entriesReference); assert.equal(state.entries[0].id, entry.id);
    assert.equal(entry.media.length, 1); assert.ok(entry.media[0].url.startsWith('blob:'));
    const second = makeProvider(); const secondState = await second.login(members[1].username, members[1].password, captcha());
    assert.equal(secondState.entries[0].content, '<script>untrusted text</script>\n今天很开心。');
    await assert.rejects(second.saveEntry({ ...secondState.entries[0], content: '试图改对方记录' }), error => error.status === 403);
    await second.toggleReaction(entry.id); const favored = await second.toggleFavorite(entry.id);
    assert.deepEqual(favored.reactionBy, ['users/test-two']); assert.deepEqual(favored.favoriteBy, ['users/test-two']);
    const unhearted = await second.toggleReaction(entry.id);
    assert.deepEqual(unhearted.reactionBy, []); assert.deepEqual(unhearted.favoriteBy, ['users/test-two']);
    await second.toggleReaction(entry.id);
    const comment = await second.addComment(entry.id, '一起记下来 <b>不是 HTML</b>');
    assert.equal(comment.authorId, 'users/test-two');
    const refreshed = await first.init(); assert.equal(refreshed, state); assert.equal(refreshed.entries[0].comments.length, 1);
    await assert.rejects(first.saveSettings(state.settings), error => error.status === 403);
    await first.deleteEntry(entry.id); assert.ok(state.entries[0].deletedAt);
    const rawStillExists = await second.init(); assert.ok(rawStillExists.entries[0].deletedAt);
    await first.restoreEntry(entry.id); assert.equal(state.entries[0].deletedAt, null);
    const maintenance = makeProvider(); const adminState = await maintenance.login(admin.username, password, captcha());
    await maintenance.saveSettings({ ...adminState.settings, spaceName: '我们的小屋', subtitle: '真实设置', anniversaries: [{ id: 'anniversary', title: '初见', date: '2020-01-01', yearly: true }] });
    await maintenance.saveEntry({ ...adminState.entries[0], title: '管理员维护标题' });
    const exported = JSON.parse(await (await maintenance.exportData()).text());
    assert.equal(exported.entries[0].title, '管理员维护标题');
    assert.equal(exported.entries[0].authorId, 'users/test-one');
    assert.equal(exported.entries[0].media[0].data, Buffer.from(await png.arrayBuffer()).toString('base64'));
    assert.equal(exported.entries[0].media[0].mimeType, 'image/png');
    assert.ok(!JSON.stringify(exported).includes(password)); assert.ok(!JSON.stringify(exported).includes('accessToken'));
    const unauthenticated = await fetch(`${publicOrigin}/file/attachments/${entry.media[0].id.slice(12)}/${encodeURIComponent(entry.media[0].name)}`);
    assert.ok([401, 403, 404].includes(unauthenticated.status), 'a guessed attachment URL is insufficient');
    await first.logout(); assert.equal(state.currentUser, null); assert.equal(state.entries.length, 0);
    console.log('Verified through the public auth gateway against official Memos 26.11.1: server-verified CAPTCHA flow, real password authentication, refresh cookies, SPACE, media, comments, heart/star reactions, administrator maintenance, full export and soft-delete/restore. Only Cloudflare Siteverify is a test double.');
  } finally {
    for (const provider of providers) provider.dispose();
    if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
    // This is the unique temporary directory created by this test, never a user data directory.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
});
