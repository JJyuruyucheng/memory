import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createMemosProvider } from '../src/memos-provider.js';
import { initialize } from '../deploy/init.mjs';

function cookieFetch() {
  let cookie = '';
  return async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
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
  const child = spawn(process.env.MEMOS_BINARY, ['--addr', '127.0.0.1', '--port', String(port), '--data', directory, '--instance-url', base, '--config-apply', 'off'], { stdio: 'ignore', windowsHide: true });
  let processError; child.on('error', error => { processError = error; });
  const providers = [];
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
    const members = [{ username: 'test-one', name: '小满', password }, { username: 'test-two', name: '阿辰', password }];
    const options = { base, admin, members, startDate: '2020-01-01' };
    const initialized = await initialize(options);
    assert.equal(initialized.privateAccess, true); assert.equal(initialized.members.length, 3);
    assert.equal((await initialize(options)).registrationClosed, true, 'initialization can be rerun without resetting credentials');
    const makeProvider = () => {
      const provider = createMemosProvider({ apiBase: base, space: 'spaces/together', fetch: cookieFetch() });
      providers.push(provider); return provider;
    };
    const first = makeProvider();
    assert.equal((await first.init()).currentUser, null);
    const state = await first.login(members[0].username, password); const entriesReference = state.entries;
    assert.equal(state.users.length, 3);
    const png = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z3L8AAAAASUVORK5CYII=', 'base64')], '微小图片.png', { type: 'image/png' });
    const entry = await first.saveEntry({ type: 'event', title: '真实 API 测试', content: '<script>untrusted text</script>\n今天很开心。', occurredAt: '2026-11-15T03:00:00Z', mood: 'happy', tags: ['测试'] }, [png]);
    assert.equal(state.entries, entriesReference); assert.equal(state.entries[0].id, entry.id);
    assert.equal(entry.media.length, 1); assert.ok(entry.media[0].url.startsWith('blob:'));
    const second = makeProvider(); const secondState = await second.login(members[1].username, password);
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
    const maintenance = makeProvider(); const adminState = await maintenance.login(admin.username, password);
    await maintenance.saveSettings({ ...adminState.settings, spaceName: '我们的小屋', subtitle: '真实设置', anniversaries: [{ id: 'anniversary', title: '初见', date: '2020-01-01', yearly: true }] });
    await maintenance.saveEntry({ ...adminState.entries[0], title: '管理员维护标题' });
    const exported = JSON.parse(await (await maintenance.exportData()).text());
    assert.equal(exported.entries[0].title, '管理员维护标题');
    assert.equal(exported.entries[0].authorId, 'users/test-one');
    assert.equal(exported.entries[0].media[0].data, Buffer.from(await png.arrayBuffer()).toString('base64'));
    assert.equal(exported.entries[0].media[0].mimeType, 'image/png');
    assert.ok(!JSON.stringify(exported).includes(password)); assert.ok(!JSON.stringify(exported).includes('accessToken'));
    const unauthenticated = await fetch(`${base}/file/attachments/${entry.media[0].id.slice(12)}/${encodeURIComponent(entry.media[0].name)}`);
    assert.ok([401, 403, 404].includes(unauthenticated.status), 'a guessed attachment URL is insufficient');
    await first.logout(); assert.equal(state.currentUser, null); assert.equal(state.entries.length, 0);
    console.log('Verified against official Memos 26.11.1 release: two member logins, SPACE isolation, PNG upload/download, native comments, independent heart/star reactions, administrator edits/settings, complete media export, soft-delete/restore and anonymous media denial.');
  } finally {
    for (const provider of providers) provider.dispose();
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
    // This is the unique temporary directory created by this test, never a user data directory.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
});
