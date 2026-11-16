import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProvider } from '../src/demo-provider.js';
import { createSampleData } from '../src/sample-data.js';

// Minimal asynchronous IndexedDB test surface; production always uses browser IndexedDB.
// Browser QA separately verifies persistence and Blob URLs against a real browser engine.
function memoryIndexedDB() {
  const databases = new Map();
  return {
    open(name) {
      const request = {};
      setTimeout(() => {
        const isNew = !databases.has(name);
        if (isNew) databases.set(name, new Map());
        const stores = databases.get(name);
        request.result = {
          objectStoreNames: { contains: key => stores.has(key) },
          createObjectStore: key => stores.set(key, new Map()), close() {},
          transaction(storeName) {
            const transaction = {};
            transaction.objectStore = () => ({
              get(key) {
                const read = {};
                setTimeout(() => { read.result = structuredClone(stores.get(storeName).get(key)); read.onsuccess?.(); }, 0);
                return read;
              },
              put(value, key) {
                const snapshot = structuredClone(value);
                setTimeout(() => { stores.get(storeName).set(key, snapshot); transaction.oncomplete?.(); }, 0);
              },
            });
            return transaction;
          },
        };
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

function emptyMediaSeed() {
  const seed = createSampleData();
  for (const entry of seed.entries) entry.media = [];
  return seed;
}

function fixture(extra = {}) {
  const options = { indexedDB: memoryIndexedDB(), dbName: 'test-memory', createSeed: emptyMediaSeed, now: () => '2026-11-16T04:00:00Z', ...extra };
  return { provider: createDemoProvider(options), options };
}

const draft = (extra = {}) => ({ type: 'note', title: '', content: '新增记录', occurredAt: '2026-11-16', mood: null, tags: [], ...extra });

test('text and real Blob attachments survive opening a fresh provider; export embeds exact bytes', async () => {
  const { provider, options } = fixture();
  const state = await provider.init();
  const file = new File([new Uint8Array([255, 216, 7, 42])], '示例上传.jpg', { type: 'image/jpeg' });
  const entry = await provider.saveEntry(draft(), [file]);
  assert.equal(entry.authorId, 'demo-linjian');
  assert.equal(entry.occurredAt, '2026-11-16T04:00:00.000Z');
  assert.equal(entry.media[0].size, 4);
  assert.match(entry.media[0].url, /^blob:/);
  assert.ok(state.entries.some(item => item.id === entry.id), 'init state stays live after mutations');

  const reopened = createDemoProvider(options);
  const restored = await reopened.init();
  const restoredEntry = restored.entries.find(item => item.id === entry.id);
  assert.equal(restoredEntry.content, '新增记录');
  assert.notEqual(restoredEntry.media[0].url, entry.media[0].url, 'object URLs are regenerated, never persisted');
  const exported = JSON.parse(await (await reopened.exportData()).text());
  const exportedEntry = exported.entries.find(item => item.id === entry.id);
  assert.equal(exportedEntry.media[0].data, '/9gHKg==');
  assert.equal(exportedEntry.media[0].mimeType, 'image/jpeg');
  assert.equal('url' in exportedEntry.media[0], false);
  assert.equal(exported.settings.startDate, '2025-05-20');
  assert.equal(exported.users.length, 3);
});

test('author permissions are enforced in the provider and admin can maintain both authors', async () => {
  const { provider } = fixture();
  const state = await provider.init();
  const other = state.entries.find(item => item.authorId === 'demo-wanwan');
  await assert.rejects(provider.saveEntry({ id: other.id, content: '擅自改写' }), /只有作者或管理员/);
  await assert.rejects(provider.deleteEntry(other.id), /只有作者或管理员/);
  await provider.switchUser('demo-admin');
  const updated = await provider.saveEntry({ id: other.id, content: '管理员维护文本', authorId: 'demo-admin' });
  assert.equal(updated.authorId, 'demo-wanwan', 'a caller cannot rewrite authorship');
  await provider.deleteEntry(other.id);
  assert.equal(state.entries.find(item => item.id === other.id).deletedAt, '2026-11-16T04:00:00.000Z');
  await provider.switchUser('demo-linjian');
  await assert.rejects(provider.restoreEntry(other.id), /只有作者或管理员/);
  await provider.switchUser('demo-wanwan');
  await provider.restoreEntry(other.id);
  assert.equal(state.entries.find(item => item.id === other.id).deletedAt, null);
});

test('favorites and reactions belong to each user; comments preserve plain text', async () => {
  const { provider } = fixture();
  const state = await provider.init();
  const id = 'demo-entry-7';
  await provider.toggleFavorite(id);
  await provider.toggleReaction(id);
  await provider.switchUser('demo-wanwan');
  assert.deepEqual(state.entries.find(item => item.id === id).favoriteBy, ['demo-linjian']);
  await provider.toggleFavorite(id);
  await provider.toggleReaction(id);
  const comment = await provider.addComment(id, '  <script>只是文字</script>  ');
  assert.equal(comment.authorId, 'demo-wanwan');
  assert.equal(comment.content, '<script>只是文字</script>');
  await provider.toggleFavorite(id);
  assert.deepEqual(state.entries.find(item => item.id === id).favoriteBy, ['demo-linjian']);
  assert.deepEqual(state.entries.find(item => item.id === id).reactionBy, ['demo-linjian', 'demo-wanwan']);
  await assert.rejects(provider.addComment(id, '   '), /不能为空/);
});

test('soft deletion retains content and original bytes for recovery and export', async () => {
  const { provider } = fixture();
  const state = await provider.init();
  const entry = await provider.saveEntry(draft(), [new File(['original'], 'photo.png', { type: 'image/png' })]);
  await provider.deleteEntry(entry.id);
  await assert.rejects(provider.addComment(entry.id, '回收站不应可评论'), /回收站/);
  const exported = JSON.parse(await (await provider.exportData('mine')).text());
  const record = exported.entries.find(item => item.id === entry.id);
  assert.ok(record.deletedAt);
  assert.equal(atob(record.media[0].data), 'original');
  await provider.restoreEntry(entry.id);
  assert.match(state.entries.find(item => item.id === entry.id).media[0].url, /^blob:/);
  assert.equal(state.entries.find(item => item.id === entry.id).deletedAt, null);
});

test('invalid writes and spoofed attachment references never reach persisted state', async () => {
  const { provider, options } = fixture();
  const state = await provider.init();
  const initial = state.entries.length;
  await assert.rejects(provider.saveEntry(draft({ content: '' })), /写一点文字/);
  await assert.rejects(provider.saveEntry(draft({ occurredAt: '2026-02-30' })), /发生日期无效/);
  await assert.rejects(provider.saveEntry(draft(), [new File(['bad'], 'a.svg', { type: 'image/svg+xml' })]), /不支持附件/);
  await assert.rejects(provider.saveEntry(draft({ media: [{ id: 'stolen', type: 'image', size: 5, url: 'https://example.com' }] })), /本条记录/);
  assert.equal(state.entries.length, initial);
  const reopened = await createDemoProvider(options).init();
  assert.equal(reopened.entries.length, initial);
  const entry = await provider.saveEntry(draft({ authorId: 'demo-wanwan' }));
  assert.equal(entry.authorId, 'demo-linjian');
});

test('demo rejects passwords, requires an identity, persists settings and can reset explicitly', async () => {
  const { provider, options } = fixture();
  await provider.init();
  await assert.rejects(provider.login('user', 'do-not-store'), /不接收账号密码/);
  await provider.saveSettings({ spaceName: '我们的示例空间', subtitle: '只保存在当前浏览器', startDate: '2025-05-20' });
  await assert.rejects(provider.saveSettings({ startDate: '2026-02-30' }), /开始日期无效/);
  await provider.logout();
  await assert.rejects(provider.saveEntry(draft()), /演示身份/);
  const reopened = createDemoProvider(options);
  const state = await reopened.init();
  assert.equal(state.currentUser, null);
  assert.equal(state.settings.spaceName, '我们的示例空间');
  await reopened.switchUser('demo-wanwan');
  await reopened.saveEntry(draft());
  assert.equal(state.entries.length, 8);
  await reopened.resetDemo();
  assert.equal(state.entries.length, 7);
  assert.equal(state.currentUser.id, 'demo-linjian');
  assert.equal(state.settings.spaceName, '林间与晚晚');
});

test('bundled sample media are fetched once and copied into IndexedDB, not left as volatile URLs', async () => {
  let fetches = 0;
  const { provider, options } = fixture({ createSeed: createSampleData, fetch: async () => { fetches += 1; return new Response(new Blob(['seed-photo'], { type: 'image/jpeg' })); } });
  const state = await provider.init();
  assert.equal(fetches, 4);
  assert.equal(state.entries.flatMap(entry => entry.media).filter(media => media.url.startsWith('blob:')).length, 4);
  const reopened = createDemoProvider({ ...options, fetch: async () => { throw new Error('offline'); } });
  await reopened.init();
  const exported = JSON.parse(await (await reopened.exportData()).text());
  assert.equal(exported.entries.flatMap(entry => entry.media).length, 4);
  assert.ok(exported.entries.flatMap(entry => entry.media).every(media => atob(media.data) === 'seed-photo'));
});
