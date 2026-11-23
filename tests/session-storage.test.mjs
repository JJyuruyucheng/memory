import test from 'node:test';
import assert from 'node:assert/strict';
import { createRememberedSessionStorage } from '../src/session-storage.js';

const KEY = 'test-session';
const PERSISTENT_KEY = `${KEY}-persistent`;
const session = n => JSON.stringify({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, user: { id: 'member' } });
function fixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const create = onExternalChange => createRememberedSessionStorage({ storage, key: KEY, onExternalChange });
  return { values, create, record: () => JSON.parse(values.get(PERSISTENT_KEY)) };
}

test('重新打开和令牌轮换保留同一登录租约，持久记录没有本地到期时间', () => {
  const f = fixture(), first = f.create();
  first.beginSignIn();
  first.setItem(KEY, session(1));
  const leaseId = f.record().leaseId;
  assert.ok(leaseId);
  assert.deepEqual(f.record(), { version: 1, leaseId, session: session(1) });
  assert.equal(f.values.has(KEY), false);

  const refreshed = f.create();
  assert.equal(refreshed.getItem(KEY), session(1));
  refreshed.setItem(KEY, session(2));
  assert.deepEqual(f.record(), { version: 1, leaseId, session: session(2) });
  assert.equal(f.create().getItem(KEY), session(2));
});

test('旧记录即使超过原到期日也会迁移，重新唤醒不会注销或改变租约', async () => {
  const f = fixture(), events = new EventTarget();
  const leaseId = '11111111-1111-4111-8111-111111111111';
  f.values.set(KEY, JSON.stringify({ version: 1, leaseId, expiresAt: Date.UTC(2025, 0, 1), session: session(1) }));
  let changed = 0;
  const migrated = f.create(() => changed++);
  assert.equal(migrated.getItem(KEY), session(1));
  assert.deepEqual(f.record(), { version: 1, leaseId, session: session(1) });
  assert.equal(f.values.has(KEY), false);

  const stop = migrated.watch(events);
  try {
    events.dispatchEvent(new Event('visibilitychange'));
    events.dispatchEvent(new Event('pageshow'));
    migrated.setItem(KEY, session(2));
    assert.equal(f.create().getItem(KEY), session(2));
    assert.deepEqual(f.record(), { version: 1, leaseId, session: session(2) });
    await Promise.resolve();
    assert.equal(changed, 0);
  } finally { stop(); }
});

test('退出删除持久登录，重新登录得到新租约，SDK 键保持不变', () => {
  const f = fixture(), store = f.create();
  store.beginSignIn();
  store.setItem(KEY, session(1));
  const oldLease = f.record().leaseId;
  f.values.set(KEY, JSON.stringify({ version: 1, leaseId: 'older-tab', expiresAt: Date.UTC(2025, 0, 1), session: session(4) }));
  assert.equal(store.getItem(KEY), session(1));
  store.removeItem(KEY);
  assert.equal(store.getItem(KEY), null);
  assert.equal(f.values.has(PERSISTENT_KEY), false);
  assert.equal(f.values.has(KEY), false);
  assert.equal(f.create().getItem(KEY), null);

  store.beginSignIn();
  store.setItem(KEY, session(2));
  assert.notEqual(f.record().leaseId, oldLease);
  store.setItem('unrelated', session(3));
  store.setItem(PERSISTENT_KEY, session(4));
  store.setItem(KEY, JSON.stringify({ password: 'never-store' }));
  assert.equal(store.getItem(KEY), session(2));
  assert.equal(store.getItem(PERSISTENT_KEY), null);
  assert.equal(f.values.has('unrelated'), false);
});

test('损坏的持久记录不能恢复，旧键也只迁移有效的会话封装', () => {
  const f = fixture(), store = f.create();
  const invalid = [
    '{', session(1),
    JSON.stringify({ version: 2, leaseId: 'synthetic', session: session(1) }),
    JSON.stringify({ version: 1, leaseId: '', session: session(1) }),
    JSON.stringify({ version: 1, leaseId: 'synthetic', session: '{}' }),
  ];
  for (const value of invalid) {
    f.values.set(PERSISTENT_KEY, value);
    assert.equal(store.getItem(KEY), null);
    assert.equal(f.values.has(PERSISTENT_KEY), false);
    f.values.set(KEY, value);
    assert.equal(f.create().getItem(KEY), null);
    assert.equal(f.values.has(PERSISTENT_KEY), false);
  }
});

test('浏览器禁用存储时仍可在当前标签页登录，重新打开后不恢复', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const a = createRememberedSessionStorage({ storage: blocked, key: KEY });
  a.beginSignIn(); a.setItem(KEY, session(1)); assert.equal(a.getItem(KEY), session(1));
  assert.equal(createRememberedSessionStorage({ storage: blocked, key: KEY }).getItem(KEY), null);
  a.removeItem(KEY); assert.equal(a.getItem(KEY), null);
});

test('没有显式登录不能创建会话；退出或外部删除后的迟到刷新均不能复活', async () => {
  const f = fixture(), a = f.create(), b = f.create();
  a.setItem(KEY, session(1)); assert.equal(f.values.has(PERSISTENT_KEY), false);
  a.beginSignIn(); a.setItem(KEY, session(1)); assert.equal(b.getItem(KEY), session(1));
  a.removeItem(KEY); b.setItem(KEY, session(2)); a.setItem(KEY, session(3));
  assert.equal(f.values.has(PERSISTENT_KEY), false);
  await Promise.resolve();
});

test('外部登录替换租约时旧实例不覆写新账号，正常轮换不误判替换', async () => {
  const f = fixture(), first = f.create(); first.beginSignIn(); first.setItem(KEY, session(1));
  const oldTab = f.create(); assert.equal(oldTab.getItem(KEY), session(1));
  first.setItem(KEY, session(2)); assert.equal(oldTab.getItem(KEY), session(2));
  first.beginSignIn(); first.setItem(KEY, session(3));
  oldTab.setItem(KEY, session(4)); assert.equal(first.getItem(KEY), session(3));
  assert.equal(oldTab.getItem(KEY), null);
  const beforeEvent = f.create(); assert.equal(beforeEvent.getItem(KEY), session(3));
  first.beginSignIn(); first.setItem(KEY, session(5));
  beforeEvent.removeItem(KEY); assert.equal(first.getItem(KEY), session(5), 'stale SDK removal cannot delete the new lease before its storage event arrives');
});

test('原生 storage 事件监视持久键，轮换保持登录，退出则通知失效', async () => {
  const f = fixture(), events = new EventTarget(); let changed = 0;
  const a = f.create(); a.beginSignIn(); a.setItem(KEY, session(1));
  const b = f.create(() => changed++), stop = b.watch(events);
  const signal = key => {
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: key });
    events.dispatchEvent(event);
  };
  try {
    a.setItem(KEY, session(2)); signal(PERSISTENT_KEY); await Promise.resolve(); assert.equal(changed, 0);
    a.removeItem(KEY); signal('unrelated'); await Promise.resolve(); assert.equal(changed, 0);
    signal(PERSISTENT_KEY); await Promise.resolve(); assert.equal(changed, 1);
    b.setItem(KEY, session(3)); assert.equal(f.values.has(PERSISTENT_KEY), false);
  } finally { stop(); }
});

test('运行中配额耗尽后采用新内存令牌并清除旧持久化令牌', () => {
  const values = new Map(); let blocked = false;
  const browser = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (blocked) throw Error('quota'); values.set(key, value); }, removeItem: key => values.delete(key) };
  const store = createRememberedSessionStorage({ storage: browser, key: KEY }); store.beginSignIn(); store.setItem(KEY, session(1));
  blocked = true; store.setItem(KEY, session(2));
  assert.equal(store.getItem(KEY), session(2)); assert.equal(values.has(PERSISTENT_KEY), false);
  blocked = false;
  const other = createRememberedSessionStorage({ storage: browser, key: KEY }); other.beginSignIn(); other.setItem(KEY, session(3));
  store.removeItem(KEY); assert.equal(other.getItem(KEY), session(3), 'memory-only logout must not delete another tab’s newer persistent lease');
});
