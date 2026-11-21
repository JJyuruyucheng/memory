import { ALLOWED_FILE_TYPES, canReadEntry, dayKey, normalizeAnniversaryDate, toUtcIso, validateEntry } from './domain.js';
import { createSampleData } from './sample-data.js';
import { planAttachmentOrder, resolveAttachmentOrder } from './attachment-order.js';

const STORE = 'workspace';
const KEY = 'snapshot';
const SCHEMA_VERSION = 1;
const clone = value => structuredClone(value);
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

function openDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('浏览器未开放 IndexedDB，无法持久保存演示数据。请允许站点存储后重试。')); return; }
    const request = indexedDB.open(name, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开本地演示数据库。'));
    request.onblocked = () => reject(new Error('本地数据库正在被其他页面使用，请关闭旧页面后重试。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

function readSnapshot(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法读取本地演示数据。'));
  });
}

function writeSnapshot(db, snapshot) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('本地保存失败，可能已超出浏览器存储空间。'));
    transaction.objectStore(STORE).put(snapshot, KEY);
  });
}

async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

/** Single-device IndexedDB demo. It never asks for a password or simulates online sync. */
export function createDemoProvider(options = {}) {
  const indexedDB = options.indexedDB ?? globalThis.indexedDB;
  const fetchFile = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const databaseName = options.dbName ?? 'chaoxi-memory-demo-v1';
  const now = () => toUtcIso(options.now?.() ?? new Date());
  const state = { mode: 'demo', currentUser: null, users: [], entries: [], settings: {} };
  let database;
  let workspaceEntries = [];
  let mediaBlobs = new Map();
  const objectUrls = new Map();
  let initialized;
  let queue = Promise.resolve();

  function persistent(next, blobs) {
    const storedState = clone(next);
    storedState.currentUserId = storedState.currentUser?.id ?? null;
    delete storedState.currentUser;
    for (const entry of storedState.entries) {
      for (const media of entry.media) {
        if (blobs.has(media.id)) delete media.url;
      }
    }
    return { schemaVersion: SCHEMA_VERSION, state: storedState, blobs: [...blobs].map(([id, blob]) => ({ id, blob })) };
  }

  function publish(next, blobs) {
    const user = next.users.find(item => item.id === (next.currentUser?.id ?? next.currentUserId)) ?? null;
    workspaceEntries = next.entries;
    const visible = next.entries.filter(entry => canReadEntry(entry, user));
    const visibleMedia = new Set(visible.flatMap(entry => entry.media.map(media => media.id)));
    for (const [id, url] of objectUrls) {
      if (!visibleMedia.has(id) || !blobs.has(id) || mediaBlobs.get(id) !== blobs.get(id)) {
        globalThis.URL?.revokeObjectURL?.(url);
        objectUrls.delete(id);
      }
    }
    for (const entry of visible) {
      for (const media of entry.media) {
        const blob = blobs.get(media.id);
        if (blob) {
          if (!objectUrls.has(media.id)) objectUrls.set(media.id, URL.createObjectURL(blob));
          media.url = objectUrls.get(media.id);
          media.size = blob.size;
        }
      }
    }
    state.mode = 'demo';
    state.users.splice(0, state.users.length, ...next.users);
    state.entries.splice(0, state.entries.length, ...visible);
    state.settings = next.settings;
    state.currentUser = state.users.find(user => user.id === (next.currentUser?.id ?? next.currentUserId)) ?? null;
    mediaBlobs = blobs;
  }

  async function seed() {
    const next = options.createSeed?.() ?? createSampleData();
    const blobs = new Map();
    // Seed assets are bundled locally, then copied into IndexedDB as real Blob objects.
    await Promise.all(next.entries.flatMap(entry => entry.media.map(async media => {
      if (!fetchFile) return;
      try {
        const response = await fetchFile(media.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size || !ALLOWED_FILE_TYPES[blob.type]) throw new Error('无效的示例图片');
        blobs.set(media.id, blob);
        media.size = blob.size;
      } catch {
        // Keep the bundled source as a fallback. Export refuses to silently omit it.
      }
    })));
    return { next, blobs };
  }

  function init() {
    if (!initialized) initialized = (async () => {
      database = await openDatabase(indexedDB, databaseName);
      const snapshot = await readSnapshot(database);
      if (snapshot) {
        if (snapshot.schemaVersion !== SCHEMA_VERSION || !Array.isArray(snapshot.state?.entries) || !Array.isArray(snapshot.state?.users)) throw new Error('本地演示数据版本不兼容，请先导出或使用原版本打开。');
        publish(snapshot.state, new Map((snapshot.blobs ?? []).map(item => [item.id, item.blob])));
      } else {
        const { next, blobs } = await seed();
        await writeSnapshot(database, persistent(next, blobs));
        publish(next, blobs);
      }
      return state;
    })();
    return initialized;
  }

  function enqueue(action) {
    const pending = queue.then(async () => { await init(); return action(); });
    queue = pending.catch(() => {});
    return pending;
  }

  async function commit(next, blobs = new Map(mediaBlobs)) {
    const used = new Set(next.entries.flatMap(entry => entry.media.map(media => media.id)));
    for (const id of blobs.keys()) if (!used.has(id)) blobs.delete(id);
    await writeSnapshot(database, persistent(next, blobs));
    publish(next, blobs);
  }

  // Keep the complete demo workspace private to the provider so switching an
  // identity cannot expose whispers through album/search/statistics/export.
  function nextState() { return { ...clone(state), entries: clone(workspaceEntries) }; }

  function currentUser() {
    if (!state.currentUser) throw new Error('请先选择一个演示身份。');
    return state.currentUser;
  }

  function findEntry(next, id, { mutation = false, allowDeleted = false } = {}) {
    const user = currentUser();
    const entry = next.entries.find(item => item.id === id);
    if (!entry || !canReadEntry(entry, user) || (entry.deletedAt && !allowDeleted)) throw new Error('这条记录不存在，或已放入回收站。');
    if (mutation && entry.authorId !== user.id && user.role !== 'admin') throw new Error('只有作者或管理员可以修改、删除及恢复这条记录。');
    return entry;
  }

  return {
    init,
    saveEntry(input, files = []) {
      return enqueue(async () => {
        const user = currentUser();
        const next = nextState();
        if (!input || typeof input !== 'object' || !Array.isArray(files)) throw new Error('记录或附件格式无效。');
        const existing = input.id ? findEntry(next, input.id, { mutation: true }) : null;
        let keptMedia = existing?.media ?? [];
        if (input.media !== undefined) {
          if (!Array.isArray(input.media)) throw new Error('附件格式无效。');
          const existingIds = new Set(keptMedia.map(media => media.id));
          if (input.media.some(media => !media || !existingIds.has(media.id)) || new Set(input.media.map(media => media.id)).size !== input.media.length) throw new Error('附件只能来自本条记录；添加附件请使用文件上传。');
          keptMedia = input.media.map(media => keptMedia.find(item => item.id === media.id));
        }
        const candidate = {
          ...(existing ?? {}), type: input.type ?? existing?.type ?? 'note',
          title: input.title ?? existing?.title ?? '', content: input.content ?? existing?.content ?? '',
          occurredAt: input.occurredAt ?? existing?.occurredAt ?? now(),
          mood: input.mood === undefined ? (existing?.mood ?? null) : input.mood,
          tags: input.tags ?? existing?.tags ?? [], media: keptMedia,
        };
        const validation = validateEntry(candidate, files, options.config);
        if (!validation.valid) throw new Error(validation.errors.join('\n'));
        const order = planAttachmentOrder(keptMedia, files.length, input.mediaOrder);
        const blobs = new Map(mediaBlobs);
        const addedMedia = [];
        for (const file of files) {
          if (typeof file.arrayBuffer !== 'function') throw new Error('无法读取这个附件，请重新选择文件。');
          const id = uid('media');
          const blob = file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: file.type });
          blobs.set(id, blob);
          addedMedia.push({ id, type: ALLOWED_FILE_TYPES[file.type], url: '', name: String(file.name ?? '未命名附件'), size: blob.size });
        }
        candidate.media = resolveAttachmentOrder(order, keptMedia, addedMedia);
        Object.assign(candidate, {
          id: existing?.id ?? uid('entry'), authorId: existing?.authorId ?? user.id,
          title: candidate.title.trim(), content: candidate.content.trim(), occurredAt: toUtcIso(candidate.occurredAt),
          tags: [...new Set(candidate.tags.map(tag => tag.trim()).filter(Boolean))],
          createdAt: existing?.createdAt ?? now(), updatedAt: now(), deletedAt: null,
          comments: existing?.comments ?? [], reactionBy: existing?.reactionBy ?? [], favoriteBy: existing?.favoriteBy ?? [],
        });
        if (existing) next.entries.splice(next.entries.indexOf(existing), 1, candidate);
        else next.entries.unshift(candidate);
        await commit(next, blobs);
        return state.entries.find(entry => entry.id === candidate.id);
      });
    },
    deleteEntry(id) {
      return enqueue(async () => {
        const next = nextState();
        const entry = findEntry(next, id, { mutation: true });
        entry.deletedAt = now(); entry.updatedAt = entry.deletedAt;
        await commit(next);
      });
    },
    restoreEntry(id) {
      return enqueue(async () => {
        const next = nextState();
        const entry = findEntry(next, id, { mutation: true, allowDeleted: true });
        entry.deletedAt = null; entry.updatedAt = now();
        await commit(next);
      });
    },
    toggleReaction(id) { return toggleUserList(id, 'reactionBy'); },
    toggleFavorite(id) { return toggleUserList(id, 'favoriteBy'); },
    addComment(id, text) {
      return enqueue(async () => {
        const user = currentUser();
        const content = typeof text === 'string' ? text.trim() : '';
        if (!content || content.length > 5000) throw new Error('回应不能为空，且最多 5000 个字符。');
        const next = nextState();
        const entry = findEntry(next, id);
        const comment = { id: uid('comment'), authorId: user.id, content, createdAt: now() };
        entry.comments.push(comment);
        await commit(next);
        return comment;
      });
    },
    saveSettings(settings) {
      return enqueue(async () => {
        currentUser();
        if (!settings || typeof settings !== 'object') throw new Error('设置格式无效。');
        const value = { ...state.settings, ...settings };
        if (typeof value.spaceName !== 'string' || !value.spaceName.trim() || value.spaceName.trim().length > 60) throw new Error('空间名称为 1 至 60 个字符。');
        if (typeof value.subtitle !== 'string' || value.subtitle.length > 300) throw new Error('副标题最多 300 个字符。');
        if (typeof value.startDate !== 'string' || dayKey(value.startDate) !== value.startDate) throw new Error('开始日期无效。');
        if (!Array.isArray(value.anniversaries) || value.anniversaries.length > 100) throw new Error('纪念日格式无效，最多保存 100 个。');
        value.anniversaries = value.anniversaries.map(item => {
          const date = normalizeAnniversaryDate(item);
          if (!date || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 || typeof item.yearly !== 'boolean') throw new Error('请填写真实的纪念日日期、标题和重复方式。');
          return { id: item.id || uid('anniversary'), title: item.title.trim(), ...date, yearly: item.yearly };
        });
        value.spaceName = value.spaceName.trim();
        const next = nextState(); next.settings = value;
        await commit(next);
        return state.settings;
      });
    },
    exportData(scope = 'all') {
      return enqueue(async () => {
        const user = currentUser();
        if (!['all', 'mine'].includes(scope)) throw new Error('导出范围无效。');
        const entries = clone(state.entries.filter(entry => scope === 'all' || entry.authorId === user.id));
        for (const entry of entries) {
          for (const media of entry.media) {
            let blob = mediaBlobs.get(media.id);
            if (!blob && fetchFile && media.url && !media.url.startsWith('blob:')) {
              const response = await fetchFile(media.url);
              if (response.ok) blob = await response.blob();
            }
            if (!blob?.size) throw new Error(`无法读取附件“${media.name}”，导出已停止，避免生成不完整备份。`);
            media.data = await base64(blob);
            media.mimeType = blob.type;
            media.size = blob.size;
            delete media.url;
          }
        }
        return new Blob([JSON.stringify({
          format: 'chaoxi-memory', version: 1, mode: 'demo', exportedAt: now(), scope,
          users: clone(state.users), settings: clone(state.settings), entries,
          mediaEncoding: 'base64', note: '包含回收站记录。全部人物及初始记录均为虚构示例；演示数据只保存在当前浏览器。',
        }, null, 2)], { type: 'application/json;charset=utf-8' });
      });
    },
    login() { return Promise.reject(new Error('演示模式不接收账号密码，请直接切换示例身份。')); },
    logout() {
      return enqueue(async () => { const next = nextState(); next.currentUser = null; await commit(next); });
    },
    switchUser(id) {
      return enqueue(async () => {
        const user = state.users.find(item => item.id === id);
        if (!user) throw new Error('示例身份不存在。');
        const next = nextState(); next.currentUser = clone(user);
        await commit(next);
        return state.currentUser;
      });
    },
    resetDemo() {
      return enqueue(async () => {
        const { next, blobs } = await seed();
        await commit(next, blobs);
        return state;
      });
    },
  };

  function toggleUserList(id, field) {
    return enqueue(async () => {
      const user = currentUser();
      const next = nextState();
      const entry = findEntry(next, id);
      const list = entry[field];
      entry[field] = list.includes(user.id) ? list.filter(item => item !== user.id) : [...list, user.id];
      await commit(next);
      return state.entries.find(item => item.id === id);
    });
  }
}
