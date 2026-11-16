import test from 'node:test';
import assert from 'node:assert/strict';
import { createRememberedSessionStorage, REMEMBER_FOR_MS } from '../src/session-storage.js';

const KEY = 'test-session';
const session = n => JSON.stringify({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, user: { id: 'member' } });
function fixture() {
  const values = new Map(); let clock = 1_800_000_000_000, expired = 0;
  const browser = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const create = () => createRememberedSessionStorage({ storage: browser, key: KEY, now: () => clock, onExpired: () => expired++ });
  return { values, create, advance: n => { clock += n; }, expired: () => expired };
}
test('刷新和令牌轮换恢复同一登录，30天从首次登录起算，不滚动续期', async () => {
  const f = fixture(); const first = f.create(); first.beginSignIn(); first.setItem(KEY, session(1));
  const deadline = JSON.parse(f.values.get(KEY)).expiresAt;
  f.advance(29 * 24 * 60 * 60 * 1000);
  const refreshed = f.create(); assert.equal(refreshed.getItem(KEY), session(1));
  refreshed.setItem(KEY, session(2)); assert.equal(JSON.parse(f.values.get(KEY)).expiresAt, deadline);
  f.advance(24 * 60 * 60 * 1000);
  assert.equal(f.create().getItem(KEY), null); assert.equal(f.values.has(KEY), false);
  await Promise.resolve(); assert.equal(f.expired(), 1);
});
test('退出删除登录信息，下一次登录得到新的30天；无关键和密码不会持久化', () => {
  const f = fixture(), store = f.create(); store.beginSignIn(); store.setItem(KEY, session(1));
  const old = JSON.parse(f.values.get(KEY)).expiresAt;
  store.removeItem(KEY); assert.equal(store.getItem(KEY), null);
  f.advance(1000); store.beginSignIn(); store.setItem(KEY, session(2));
  assert.equal(JSON.parse(f.values.get(KEY)).expiresAt, old + 1000);
  store.setItem('unrelated', session(3)); store.setItem(KEY, JSON.stringify({ password: 'never-store' }));
  assert.equal(store.getItem(KEY), session(2)); assert.equal(f.values.has('unrelated'), false);
});
test('损坏、旧格式、异常未来日期的持久化内容均拒绝恢复', () => {
  const f = fixture(), store = f.create();
  for (const value of ['{', session(1), JSON.stringify({ version: 1, leaseId: 'synthetic', expiresAt: Date.now() + 100 * REMEMBER_FOR_MS, session: session(1) }), JSON.stringify({ version: 1, leaseId: 'synthetic', expiresAt: 1_800_000_000_001, session: '{}' })]) {
    f.values.set(KEY, value); assert.equal(store.getItem(KEY), null); assert.equal(f.values.has(KEY), false);
  }
});
test('浏览器禁用存储时仍可在当前标签页登录，重新打开后不恢复', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const a = createRememberedSessionStorage({ storage: blocked, key: KEY });
  a.beginSignIn(); a.setItem(KEY, session(1)); assert.equal(a.getItem(KEY), session(1));
  assert.equal(createRememberedSessionStorage({ storage: blocked, key: KEY }).getItem(KEY), null);
  a.removeItem(KEY); assert.equal(a.getItem(KEY), null);
});
test('超过30天的迟到刷新不能延长登录，只有新的显式登录才能重新起算', async () => {
  const f = fixture(), store = f.create(); store.beginSignIn(); store.setItem(KEY, session(1));
  f.advance(REMEMBER_FOR_MS + 1); store.setItem(KEY, session(2));
  assert.equal(store.getItem(KEY), null); assert.equal(f.values.has(KEY), false);
  await Promise.resolve(); assert.equal(f.expired(), 1);
  store.beginSignIn(); store.setItem(KEY, session(3));
  assert.equal(store.getItem(KEY), session(3));
});
test('没有显式登录不能创建会话；退出或外部删除后的迟到刷新均不能复活', async () => {
  const f = fixture(), a = f.create(), b = f.create();
  a.setItem(KEY, session(1)); assert.equal(f.values.has(KEY), false);
  a.beginSignIn(); a.setItem(KEY, session(1)); assert.equal(b.getItem(KEY), session(1));
  a.removeItem(KEY); b.setItem(KEY, session(2)); a.setItem(KEY, session(3));
  assert.equal(f.values.has(KEY), false);
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
test('原生storage事件在没有BroadcastChannel时也通知失效，同用户轮换不重载', async () => {
  const values = new Map(), events = new EventTarget(); let changed = 0;
  const browser = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const a = createRememberedSessionStorage({ storage: browser, key: KEY }); a.beginSignIn(); a.setItem(KEY, session(1));
  const b = createRememberedSessionStorage({ storage: browser, key: KEY, onExternalChange: () => changed++ });
  const stop = b.watch(events);
  const signal = () => { const event = new Event('storage'); Object.defineProperty(event, 'key', { value: KEY }); events.dispatchEvent(event); };
  try {
    a.setItem(KEY, session(2)); signal(); await Promise.resolve(); assert.equal(changed, 0);
    a.removeItem(KEY); signal(); await Promise.resolve(); assert.equal(changed, 1);
    b.setItem(KEY, session(3)); assert.equal(values.has(KEY), false);
  } finally { stop(); }
});
test('运行中配额耗尽后采用新内存令牌并清除旧持久化令牌', () => {
  const values = new Map(); let blocked = false;
  const browser = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (blocked) throw Error('quota'); values.set(key, value); }, removeItem: key => values.delete(key) };
  const store = createRememberedSessionStorage({ storage: browser, key: KEY }); store.beginSignIn(); store.setItem(KEY, session(1));
  blocked = true; store.setItem(KEY, session(2));
  assert.equal(store.getItem(KEY), session(2)); assert.equal(values.has(KEY), false);
  blocked = false;
  const other = createRememberedSessionStorage({ storage: browser, key: KEY }); other.beginSignIn(); other.setItem(KEY, session(3));
  store.removeItem(KEY); assert.equal(other.getItem(KEY), session(3), 'memory-only logout must not delete another tab’s newer persistent lease');
});
