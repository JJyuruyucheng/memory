import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseProvider } from '../src/supabase-provider.js';

const U1 = '00000000-0000-4000-8000-000000000001', U2 = '00000000-0000-4000-8000-000000000002', ADMIN = '00000000-0000-4000-8000-000000000003';
const ENTRY = '10000000-0000-4000-8000-000000000001', MEDIA = '20000000-0000-4000-8000-000000000001';
const NOW = '2026-11-16T02:00:00.000Z';
const identities = { xbl: 'xbl@memory.invalid', ll: 'll@memory.invalid', 'memory-admin': 'memory-admin@memory.invalid' };
const input = () => ({ type: 'note', title: '', content: '普通的一天', occurredAt: NOW, mood: null, tags: [] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const file = (name = 'photo.png', body = 'picture', type = 'image/png') => new File([body], name, { type });
const ok = data => ({ data, error: null });

// A narrow SDK boundary fixture, not a second provider. It enforces server
// ownership, immutable fields and reservation/upload/finalization sequencing.
function fixture({ before = async () => {}, author = U1, initialMedia = false, profiles: customProfiles, onSessionChanged, initialSessionUserId = null } = {}) {
  const calls = [], listeners = new Set(), urls = [], revoked = [];
  let session = initialSessionUserId ? { access_token: 'never-export-restored-jwt', user: { id: initialSessionUserId } } : null, serial = 10, tick = 0;
  const generated = prefix => `${prefix}0000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const tables = {
    profiles: customProfiles || [
      { id: ADMIN, slot: 3, username: 'memory-admin', name: '维护账号', role: 'admin', color: 'stone' },
      { id: U2, slot: 2, username: 'll', name: '晚晚', role: 'member', color: 'rose' },
      { id: U1, slot: 1, username: 'xbl', name: '林间', role: 'member', color: 'sage' },
    ],
    entries: [{ id: ENTRY, authorId: author, ...input(), status: 'published', createdAt: NOW, updatedAt: NOW, deletedAt: null }],
    comments: [], reactions: [], favorites: [],
    settings: [{ id: 1, spaceName: '朝夕', subtitle: '两个人的小事', startDate: '2026-01-01', anniversaries: [], updatedAt: NOW }],
    media: [],
  };
  const objects = new Map();
  if (initialMedia) {
    const blob = file(); const storagePath = `${author}/${ENTRY}/${MEDIA}`;
    tables.media.push({ id: MEDIA, entryId: ENTRY, authorId: author, uploadedBy: author, name: blob.name, mimeType: blob.type, size: blob.size, type: 'image', storagePath, position: 0, status: 'ready', attached: true, createdAt: NOW });
    objects.set(storagePath, blob);
  }
  const user = () => session?.user?.id;
  const isAdmin = () => user() === ADMIN;
  const owns = entryId => isAdmin() || tables.entries.some(entry => entry.id === entryId && entry.authorId === user());
  class Builder {
    constructor(table, action = 'select', payload) { Object.assign(this, { table, action, payload, filters: [], orders: [], offset: 0, end: Infinity, cardinality: 'many' }); }
    select() { return this; }
    insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
    update(payload) { this.action = 'update'; this.payload = payload; return this; }
    delete() { this.action = 'delete'; return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }
    order(field) { this.orders.push(field); return this; }
    range(offset, end) { this.offset = offset; this.end = end; return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    single() { this.cardinality = 'one'; return this; }
    maybeSingle() { this.cardinality = 'maybe'; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      const call = { kind: 'table', table: this.table, action: this.action, payload: this.payload, filters: [...this.filters], signal: this.signal, offset: this.offset }; calls.push(call); await before(call);
      if (!user()) return { data: null, error: { status: 401 } };
      let selected = tables[this.table].filter(row => this.filters.every(([field, value]) => row[field] === value));
      if (this.action === 'insert') {
        const payload = structuredClone(this.payload);
        if (['profiles', 'media'].includes(this.table)) return { data: null, error: { code: '42501', status: 403 } };
        if (this.table === 'entries') {
          assert.equal(payload.authorId, undefined, 'author identity is assigned by the database');
          selected = [{ id: generated('1'), authorId: user(), ...payload, status: 'draft', createdAt: NOW, updatedAt: NOW, deletedAt: null }];
        } else if (this.table === 'comments') selected = [{ id: generated('3'), authorId: user(), createdAt: NOW, ...payload }];
        else selected = [{ ...payload, userId: user(), createdAt: NOW }];
        tables[this.table].push(...selected);
      } else if (this.action === 'update') {
        if (this.table === 'entries' && selected.some(row => !owns(row.id)) || this.table === 'settings' && !isAdmin()) return { data: null, error: { code: '42501', status: 403 } };
        if (this.table === 'entries') assert.ok(Object.keys(this.payload).every(key => ['type', 'title', 'content', 'occurredAt', 'mood', 'tags', 'deletedAt'].includes(key)), 'no immutable entry field is sent');
        selected.forEach(row => Object.assign(row, this.payload, { updatedAt: new Date(Date.parse(NOW) + ++tick * 1000).toISOString() }));
      } else if (this.action === 'delete') {
        assert.ok(['reactions', 'favorites'].includes(this.table), 'records are never physically deleted');
        assert.ok(selected.every(row => row.userId === user()), 'only the current user reaction is removed');
        tables[this.table] = tables[this.table].filter(row => !selected.includes(row));
      }
      for (const key of [...this.orders].reverse()) selected = [...selected].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      selected = selected.slice(this.offset, this.end + 1);
      return ok(structuredClone(this.cardinality === 'many' ? selected : selected[0] || null));
    }
  }
  const client = {
    auth: {
      async getSession() { const call = { kind: 'auth', action: 'getSession' }; calls.push(call); await before(call); return ok({ session }); },
      async getUser() { const call = { kind: 'auth', action: 'getUser' }; calls.push(call); await before(call); return ok({ user: session?.user || null }); },
      async signInWithPassword(credentials) {
        const call = { kind: 'auth', action: 'login', credentials }; calls.push(call); await before(call);
        const username = Object.keys(identities).find(key => identities[key] === credentials.email);
        if (!username || credentials.password !== 'test-password' || !credentials.options?.captchaToken) return { data: null, error: { status: 400, code: 'invalid_credentials' } };
        const profile = tables.profiles.find(value => value.slot === ({ xbl: 1, ll: 2, 'memory-admin': 3 })[username]);
        session = { access_token: 'never-export-this-jwt', refresh_token: 'never-export-this-refresh', user: { id: profile.id, user_metadata: { role: 'admin' } } };
        listeners.forEach(listener => listener('SIGNED_IN', session)); return ok({ user: session.user, session });
      },
      async signOut(options) { const call = { kind: 'auth', action: 'logout', options }; calls.push(call); await before(call); session = null; listeners.forEach(listener => listener('SIGNED_OUT', null)); return { error: null }; },
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
      startAutoRefresh() {}, stopAutoRefresh() {},
    },
    from: table => new Builder(table),
    rpc(name, args) {
      return { abortSignal(signal) { return { then(resolve, reject) { return (async () => {
        const call = { kind: 'rpc', name, args, signal }; calls.push(call); await before(call);
        if (!user()) return { data: null, error: { status: 401 } };
        if (name === 'publish_entry') {
          assert.ok(owns(args.p_entry_id));
          const entry = tables.entries.find(value => value.id === args.p_entry_id);
          if (entry.updatedAt !== args.p_expected_updated_at) return { data: null, error: { code: '40001', status: 409 } };
          const selected = args.p_media_ids.map(mediaId => tables.media.find(value => value.id === mediaId));
          assert.ok(selected.every(value => value?.entryId === entry.id && value.status === 'ready'));
          assert.ok(selected.filter(value => value.type === 'image').length <= 9);
          assert.ok(entry.content || entry.title || selected.length);
          for (const raw of tables.media.filter(value => value.entryId === entry.id)) {
            if (args.p_media_ids.includes(raw.id)) { raw.attached = true; raw.position = args.p_media_ids.indexOf(raw.id); }
            else if (raw.attached) { raw.attached = false; raw.status = 'retired'; }
          }
          entry.status = 'published'; return ok(structuredClone(entry));
        }
        if (name === 'reserve_media') {
          if (!owns(args.p_entry_id)) return { data: null, error: { code: '42501', status: 403 } };
          if (args.p_mime_type.startsWith('image/') && tables.media.filter(value => value.entryId === args.p_entry_id && !value.attached && value.type === 'image').length >= 9) return { data: null, error: { status: 400, code: '23514' } };
          const entry = tables.entries.find(value => value.id === args.p_entry_id), mediaId = generated('2');
          const raw = { id: mediaId, entryId: entry.id, authorId: entry.authorId, uploadedBy: user(), name: args.p_name, mimeType: args.p_mime_type, size: args.p_size, type: args.p_mime_type.startsWith('image/') ? 'image' : 'video', position: tables.media.filter(value => value.entryId === entry.id).length, status: 'pending', attached: false, createdAt: NOW };
          raw.storagePath = `${entry.authorId}/${entry.id}/${mediaId}`; tables.media.push(raw); return ok(structuredClone(raw));
        }
        const raw = tables.media.find(value => value.id === args.p_media_id);
        if (!raw || !owns(raw.entryId)) return { data: null, error: { code: '42501', status: 403 } };
        if (name === 'finalize_media') {
          const blob = objects.get(raw.storagePath); assert.equal(blob?.size, raw.size); assert.equal(blob?.type, raw.mimeType);
          raw.status = 'ready'; return ok(structuredClone(raw));
        }
        assert.equal(name, 'discard_media'); assert.ok(!objects.has(raw.storagePath), 'physical removal must precede metadata discard');
        assert.equal(raw.attached, false, 'attached originals cannot be discarded');
        tables.media.splice(tables.media.indexOf(raw), 1); return ok(null);
      })().then(resolve, reject); } }; } };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'memory-media');
      return {
        async download(path, options, transport) { const call = { kind: 'storage', action: 'download', path, options, transport }; calls.push(call); await before(call); if (!user()) return { data: null, error: { status: 401 } }; if (!objects.has(path)) return { data: null, error: { status: 404 } }; return ok(objects.get(path)); },
        async upload(path, blob, options) { const call = { kind: 'storage', action: 'upload', path, options }; calls.push(call); await before(call); assert.equal(options.upsert, false); assert.ok(tables.media.some(value => value.storagePath === path && value.status === 'pending')); objects.set(path, blob); return ok({ path }); },
        async remove(paths) { const call = { kind: 'storage', action: 'remove', paths }; calls.push(call); await before(call); paths.forEach(path => objects.delete(path)); return ok(paths.map(name => ({ name }))); },
      };
    } },
  };
  const provider = createSupabaseProvider({ client, loginIdentities: identities, onSessionChanged, now: () => NOW, urlAPI: { createObjectURL(blob) { const url = `blob:private-${urls.length + 1}`; urls.push({ url, blob }); return url; }, revokeObjectURL(url) { revoked.push(url); } } });
  return { provider, client, tables, objects, calls, urls, revoked, session: () => session, emitAuth(event, userId) { session = event === 'SIGNED_OUT' ? null : { access_token: 'never-export-switched-jwt', user: { id: userId } }; listeners.forEach(listener => listener(event, session)); }, signIn: (username = 'xbl') => provider.login(username, 'test-password', 'valid-test-captcha') };
}

test('missing client fails closed; anonymous init loads no private tables', async () => {
  assert.throws(() => createSupabaseProvider(), error => error.code === 'CONFIG');
  const f = fixture(); const state = await f.provider.init();
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.deepEqual(f.calls.map(value => value.action), ['getSession']);
});

test('login uses native captchaToken and fixed email mapping, ignores user_metadata roles, and preserves mutable state', async () => {
  const f = fixture(); const state = await f.provider.init(), users = state.users, entries = state.entries, settings = state.settings;
  assert.equal(await f.signIn(), state);
  assert.deepEqual(f.calls.find(value => value.action === 'login').credentials, { email: identities.xbl, password: 'test-password', options: { captchaToken: 'valid-test-captcha' } });
  assert.equal(state.currentUser.role, 'member', 'user-editable metadata never grants an admin role');
  assert.deepEqual(state.users.map(value => value.username), ['xbl', 'll', 'memory-admin']);
  assert.equal(state.users, users); assert.equal(state.entries, entries); assert.equal(state.settings, settings);
  assert.ok(!/test-password|never-export/.test(JSON.stringify(state)));
  await f.provider.logout(); assert.deepEqual(state.entries, []); assert.equal(state.currentUser, null);
  assert.deepEqual(f.calls.find(value => value.action === 'logout').options, { scope: 'local' });
});

test('missing captcha, unmatched login names and failed native passwords cannot load private records', async () => {
  const f = fixture(); await f.provider.init();
  await assert.rejects(f.provider.login('xbl', 'test-password'), error => error.code === 'CAPTCHA_REQUIRED');
  assert.ok(!f.calls.some(value => value.action === 'login'));
  await assert.rejects(f.provider.login('stranger', 'test-password', 'captcha'), error => error.code === 'LOGIN_FAILED');
  assert.equal(f.calls.find(value => value.action === 'login').credentials.email, identities['memory-admin']);
  assert.ok(f.calls.filter(value => value.kind === 'table').every(value => value.table === 'profiles' && value.filters.length === 1 && value.filters[0][0] === 'id' && value.filters[0][1] === ADMIN));
  assert.equal(f.session(), null, 'an authenticated password with the wrong login name must leave no SDK session');
  await assert.rejects(f.provider.login('xbl', 'wrong-password', 'captcha'), error => error.code === 'LOGIN_FAILED');
  assert.ok(!f.calls.some(value => value.kind === 'table' && value.table !== 'profiles'));
});

test('a renamed administrator uses its protected profile while both member accounts still hydrate the space', async () => {
  const f = fixture(); f.tables.profiles[0].username = 'private-admin-42';
  let state = await f.signIn('private-admin-42');
  assert.equal(state.currentUser.id, ADMIN); assert.equal(state.currentUser.role, 'admin');
  assert.deepEqual(state.users.map(value => value.username), ['xbl', 'll', 'private-admin-42']);
  assert.equal(f.calls.find(value => value.action === 'login').credentials.email, identities['memory-admin']);
  const ownLookup = f.calls.find(value => value.kind === 'table');
  assert.equal(ownLookup.table, 'profiles'); assert.deepEqual(ownLookup.filters, [['id', ADMIN]]);
  for (const member of ['xbl', 'll']) {
    await f.provider.logout(); state = await f.signIn(member);
    assert.equal(state.currentUser.username, member); assert.equal(state.currentUser.role, 'member');
    assert.deepEqual(state.users.map(value => value.username), ['xbl', 'll', 'private-admin-42']);
  }
});

test('old administrator and other aliases cannot hydrate records even with the valid administrator password', async () => {
  for (const username of ['memory-admin', 'another-admin', 'PRIVATE-ADMIN-42']) {
    const f = fixture(); f.tables.profiles[0].username = 'private-admin-42';
    const state = await f.provider.init();
    await assert.rejects(f.signIn(username), error => error.code === 'LOGIN_FAILED');
    assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.equal(f.session(), null);
    assert.ok(f.calls.some(value => value.action === 'logout'));
    assert.ok(f.calls.filter(value => value.kind === 'table').every(value => value.table === 'profiles' && value.filters[0]?.[1] === ADMIN));
    assert.ok(!f.calls.some(value => value.kind === 'storage' || value.kind === 'rpc'));
    assert.equal((await f.provider.init()).currentUser, null, 'a rejected alias cannot restore its authenticated session');
  }
});

test('invalid login name syntax is rejected before native authentication', async () => {
  const f = fixture();
  for (const username of ['admin@example.invalid', '_admin', 'admin name', 'a'.repeat(41)]) {
    await assert.rejects(f.signIn(username), error => error.code === 'LOGIN_FAILED');
  }
  assert.ok(!f.calls.some(value => value.action === 'login' || value.kind === 'table'));
});

test('logout during the protected login-name check cannot start private hydration', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ before: async call => {
    if (call.kind === 'table' && call.table === 'profiles' && call.filters.length) { entered.resolve(); await release.promise; }
  } });
  const state = await f.provider.init(), pending = f.signIn();
  const rejected = assert.rejects(pending, error => error.code === 'AUTH_CANCELLED');
  await entered.promise; await f.provider.logout(); release.resolve(); await rejected;
  assert.equal(state.currentUser, null); assert.equal(f.session(), null); assert.deepEqual(state.entries, []);
  assert.ok(f.calls.filter(value => value.kind === 'table').every(value => value.table === 'profiles' && value.filters.length === 1));
});

test('a different-account auth event immediately clears old private state and URLs before dispatching UI restoration', async () => {
  for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
    let changed = 0; const dispatched = [];
    const f = fixture({ initialMedia: true, onSessionChanged: payload => { changed++; dispatched.push(payload); } }); f.tables.entries[0].type = 'whisper';
    const state = await f.signIn(), entries = state.entries;
    f.emitAuth(event, U1); await Promise.resolve();
    assert.equal(state.currentUser.id, U1); assert.equal(changed, 0, 'normal same-user token refresh preserves the loaded view');
    f.emitAuth(event, U2);
    assert.equal(state.currentUser, null); assert.deepEqual(entries, []); assert.deepEqual(state.users, []);
    assert.deepEqual(f.revoked, ['blob:private-1']); assert.equal(changed, 0, 'SDK callback does not synchronously call restoration');
    await Promise.resolve(); assert.equal(changed, 1); assert.deepEqual(dispatched, [{ restore: true }]);
    f.tables.entries.splice(0); f.tables.media.splice(0); // New identity receives correct empty RLS result.
    const restored = await f.provider.init();
    assert.equal(restored.currentUser.id, U2); assert.equal(restored.entries, entries);
    assert.deepEqual(restored.entries, []);
  }
});

test('a cross-tab sign-out clears private state and tells the UI not to restore a session', async () => {
  const dispatched = [];
  const f = fixture({ initialMedia: true, onSessionChanged: payload => dispatched.push(payload) }), state = await f.signIn();
  f.emitAuth('SIGNED_OUT');
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.deepEqual(f.revoked, ['blob:private-1']);
  assert.deepEqual(dispatched, []); await Promise.resolve(); assert.deepEqual(dispatched, [{ restore: false }]);
  const before = f.calls.length; await f.provider.init(); assert.equal(f.calls.length, before, 'an explicit sign-out cannot implicitly restore');
});

test('a late previous-account mutation cannot restore its state after a cross-tab account change', async () => {
  const entered = deferred(), release = deferred(); let hold = false, changed = 0;
  const f = fixture({ onSessionChanged: () => { changed++; }, before: async call => { if (hold && call.table === 'entries' && call.action === 'update') { entered.resolve(); await release.promise; } } });
  const state = await f.signIn(); hold = true;
  const mutation = f.provider.saveEntry({ id: ENTRY, content: 'old-account-pending' }), rejected = assert.rejects(mutation, error => error.code === 'AUTH_CANCELLED');
  await entered.promise; f.emitAuth('TOKEN_REFRESHED', U2); release.resolve(); await rejected;
  assert.equal(changed, 1); assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.equal(f.session().user.id, U2, 'cancelling old work cannot log out the new identity');
});

test('restoration cannot commit an old identity if another tab changes accounts during getUser or table hydration', async () => {
  for (const stage of ['getUser', 'tables']) {
    const entered = deferred(), release = deferred(), dispatched = []; let held = false;
    const f = fixture({ initialSessionUserId: ADMIN, onSessionChanged: payload => dispatched.push(payload), before: async call => {
      if (!held && (stage === 'getUser' ? call.action === 'getUser' : call.kind === 'table' && call.table === 'entries')) { held = true; entered.resolve(); await release.promise; }
    } });
    const pending = f.provider.init(), rejected = assert.rejects(pending, error => error.code === 'AUTH_CANCELLED');
    await entered.promise; f.emitAuth('TOKEN_REFRESHED', U2);
    const restored = await f.provider.init();
    assert.equal(restored.currentUser.id, U2); assert.equal(restored.currentUser.role, 'member');
    release.resolve(); await rejected;
    assert.equal(restored.currentUser.id, U2, 'the stale administrator load cannot replace the new member view');
    assert.deepEqual(dispatched, [{ restore: true }]); assert.equal(f.session().user.id, U2);
  }
});

test('password login is cancelled if another tab changes accounts during the name check or table hydration', async () => {
  for (const stage of ['name', 'tables']) {
    const entered = deferred(), release = deferred(), dispatched = []; let held = false;
    const f = fixture({ onSessionChanged: payload => dispatched.push(payload), before: async call => {
      if (!held && call.kind === 'table' && (stage === 'name' ? call.table === 'profiles' && call.filters.length : call.table === 'entries')) { held = true; entered.resolve(); await release.promise; }
    } });
    const pending = f.signIn('memory-admin'), rejected = assert.rejects(pending, error => error.code === 'AUTH_CANCELLED');
    await entered.promise; f.emitAuth('SIGNED_IN', U1);
    const restored = await f.provider.init(); assert.equal(restored.currentUser.id, U1); assert.equal(restored.currentUser.role, 'member');
    release.resolve(); await rejected;
    assert.equal(restored.currentUser.id, U1); assert.equal(f.session().user.id, U1);
    assert.ok(!f.calls.some(call => call.action === 'logout'), 'an obsolete login cannot sign out the newer identity');
    assert.deepEqual(dispatched, [{ restore: true }]);
  }
});

test('cross-tab sign-out cancels pending restoration and pending password hydration before they can commit', async () => {
  for (const mode of ['init', 'login']) {
    const entered = deferred(), release = deferred(), dispatched = []; let held = false;
    const f = fixture({ initialSessionUserId: mode === 'init' ? ADMIN : null, onSessionChanged: payload => dispatched.push(payload), before: async call => {
      if (!held && call.kind === 'table' && call.table === 'entries') { held = true; entered.resolve(); await release.promise; }
    } });
    const pending = mode === 'init' ? f.provider.init() : f.signIn('memory-admin'), rejected = assert.rejects(pending, error => error.code === 'AUTH_CANCELLED');
    await entered.promise; f.emitAuth('SIGNED_OUT'); release.resolve(); await rejected;
    const restored = await f.provider.init();
    assert.equal(restored.currentUser, null); assert.deepEqual(restored.entries, []); assert.equal(f.session(), null);
    assert.deepEqual(dispatched, [{ restore: false }]);
  }
});

test('private downloads create Blob URLs; logout revokes them and export has original bytes without credentials', async () => {
  const f = fixture({ initialMedia: true }), state = await f.signIn();
  assert.equal(state.entries[0].media[0].url, 'blob:private-1');
  const download = f.calls.find(value => value.action === 'download'); assert.equal(download.transport.cache, 'no-store'); assert.ok(download.transport.signal instanceof AbortSignal);
  const exported = JSON.parse(await (await f.provider.exportData('mine')).text());
  assert.equal(exported.entries[0].media[0].data, Buffer.from('picture').toString('base64'));
  assert.equal(exported.entries[0].media[0].mimeType, 'image/png'); assert.equal(exported.entries[0].media[0].url, undefined);
  assert.ok(!/test-password|never-export/.test(JSON.stringify(exported)));
  await f.provider.logout(); assert.deepEqual(f.revoked, ['blob:private-1']);
});

test('author saves and exports a whisper with the actual backend type rather than a local hidden flag', async () => {
  const f = fixture(), state = await f.signIn();
  const saved = await f.provider.saveEntry({ ...input(), type: 'whisper', content: 'author private fixture' }, [file('private.png', 'private-bytes')]);
  assert.equal(saved.type, 'whisper'); assert.equal(saved.authorId, U1);
  assert.equal(f.calls.find(call => call.table === 'entries' && call.action === 'insert').payload.type, 'whisper');
  assert.ok(state.entries.some(entry => entry.id === saved.id));
  const exported = JSON.parse(await (await f.provider.exportData('mine')).text());
  assert.equal(exported.entries.find(entry => entry.id === saved.id).media[0].data, Buffer.from('private-bytes').toString('base64'));
});

test('administrator can hydrate and maintain a published whisper from either author', async () => {
  for (const author of [U1, U2]) {
    const f = fixture({ author, initialMedia: true }); f.tables.entries[0].type = 'whisper';
    const state = await f.signIn('memory-admin');
    assert.equal(state.entries[0].type, 'whisper'); assert.equal(state.entries[0].media.length, 1);
    const saved = await f.provider.saveEntry({ id: ENTRY, content: 'maintained whisper' });
    assert.equal(saved.type, 'whisper'); assert.equal(saved.authorId, author);
  }
});

test('unexpected hidden whisper rows fail closed before a partner can download, render or export them', async () => {
  // This SDK fixture deliberately returns a row that correct RLS would hide;
  // the live SQL verification separately proves actual database authorization.
  const f = fixture({ author: U2, initialMedia: true }); f.tables.entries[0].type = 'whisper';
  const state = await f.provider.init();
  await assert.rejects(f.signIn('xbl'), error => error.code === 'INVALID_RESPONSE');
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.equal(f.session(), null); assert.ok(!f.calls.some(call => call.kind === 'storage'));
  await assert.rejects(f.provider.exportData(), error => error.code === 'UNAUTHENTICATED');
});

test('administrator cannot hydrate a leaked unpublished whisper draft from another author', async () => {
  const f = fixture({ author: U1, initialMedia: true }); Object.assign(f.tables.entries[0], { type: 'whisper', status: 'draft' });
  await assert.rejects(f.signIn('memory-admin'), error => error.code === 'INVALID_RESPONSE');
  assert.ok(!f.calls.some(call => call.kind === 'storage'));
});

test('a whisper cannot become shared in the same save that removes or adds private attachments', async () => {
  for (const [patch, files] of [[{ media: [] }, []], [{}, [file('new-private.png')]]]) {
    const f = fixture({ initialMedia: true }); f.tables.entries[0].type = 'whisper';
    const state = await f.signIn(), start = f.calls.length;
    await assert.rejects(f.provider.saveEntry({ id: ENTRY, type: 'note', ...patch }, files), error => error.code === 'PRIVATE_MEDIA_CHANGE');
    assert.equal(f.calls.length, start, 'privacy validation precedes every write and upload');
    assert.equal(f.tables.entries[0].type, 'whisper'); assert.equal(state.entries[0].media[0].id, MEDIA);
  }
});

test('private attachment edits can be saved first, followed by an explicit shared-type save retaining the final media', async () => {
  const f = fixture({ initialMedia: true }); f.tables.entries[0].type = 'whisper';
  const state = await f.signIn();
  const cleaned = await f.provider.saveEntry({ id: ENTRY, type: 'whisper', media: [] });
  assert.equal(cleaned.type, 'whisper'); assert.deepEqual(cleaned.media, []);
  assert.ok(!f.objects.size);
  const shared = await f.provider.saveEntry({ id: ENTRY, type: 'note' });
  assert.equal(shared.type, 'note'); assert.deepEqual(shared.media, []);
  assert.equal(state.entries[0], shared);
  const keeping = fixture({ initialMedia: true }); keeping.tables.entries[0].type = 'whisper';
  await keeping.signIn(); const direct = await keeping.provider.saveEntry({ id: ENTRY, type: 'event', title: 'Explicitly shared event' });
  assert.equal(direct.type, 'event'); assert.equal(direct.media[0].id, MEDIA, 'unchanged private photos can be explicitly shared');
});

test('edits retain attachments by default; explicit replacement confirms new media before removing old media', async () => {
  const f = fixture({ initialMedia: true }), state = await f.signIn();
  await f.provider.saveEntry({ id: ENTRY, content: '保留原图的修改' });
  assert.equal(state.entries[0].media[0].id, MEDIA); assert.ok(!f.calls.some(value => value.action === 'remove'));
  await f.provider.saveEntry({ id: ENTRY, media: [], content: '新照片' }, [file('new.png', 'new-image')]);
  const order = f.calls.filter(value => value.kind === 'rpc' || value.kind === 'storage').map(value => value.name || value.action);
  assert.ok(order.indexOf('finalize_media') < order.indexOf('remove'));
  assert.ok(order.indexOf('remove') < order.indexOf('discard_media'));
  assert.equal(state.entries[0].media.length, 1); assert.notEqual(state.entries[0].media[0].id, MEDIA);
  assert.equal(state.entries[0].media[0].name, 'new.png'); assert.deepEqual(f.revoked, ['blob:private-1']);
});

test('invalid attachment injection, ten images and 50MB overflow fail before any mutation', async () => {
  const f = fixture(), state = await f.signIn(); const count = f.calls.length;
  await assert.rejects(f.provider.saveEntry({ id: ENTRY, media: [{ id: MEDIA, type: 'image', size: 1 }] }), error => error.code === 'VALIDATION');
  await assert.rejects(f.provider.saveEntry(input(), Array.from({ length: 10 }, () => file())), error => error.code === 'VALIDATION');
  await assert.rejects(f.provider.saveEntry(input(), Array.from({ length: 11 }, () => file('clip.mp4', 'video', 'video/mp4'))), error => error.code === 'VALIDATION');
  await assert.rejects(f.provider.saveEntry(input(), [{ name: 'large.mp4', type: 'video/mp4', size: 50_000_001 }]), error => error.code === 'VALIDATION');
  assert.equal(f.calls.length, count); assert.equal(state.entries.length, 1);
});

test('nine images plus one video are accepted at the ten-attachment boundary', async () => {
  const f = fixture(), state = await f.signIn();
  const saved = await f.provider.saveEntry(input(), [...Array.from({ length: 9 }, (_, index) => file(`${index}.png`, `image-${index}`)), file('clip.mp4', 'video', 'video/mp4')]);
  assert.equal(saved.media.length, 10); assert.equal(saved.media.filter(value => value.type === 'image').length, 9);
  assert.equal(state.entries.find(value => value.id === saved.id), saved);
});

test('member ownership is enforced before mutation; admin settings and soft delete preserve row identity', async () => {
  const f = fixture({ author: U2 }); await f.signIn();
  await assert.rejects(f.provider.deleteEntry(ENTRY), error => error.status === 403);
  await assert.rejects(f.provider.saveSettings(f.tables.settings[0]), error => error.status === 403);
  assert.ok(!f.calls.some(value => value.kind === 'table' && value.action !== 'select'));
  await f.provider.logout(); const state = await f.signIn('memory-admin'), entries = state.entries;
  await f.provider.deleteEntry(ENTRY); assert.equal(state.entries[0].deletedAt, NOW);
  await f.provider.restoreEntry(ENTRY); assert.equal(state.entries[0].deletedAt, null); assert.equal(state.entries, entries);
  await f.provider.saveSettings({ ...state.settings, spaceName: '我们的日子' }); assert.equal(state.settings.spaceName, '我们的日子');
  assert.ok(!f.calls.some(value => value.table === 'entries' && value.action === 'delete'));
});

test('comments, heart and favorite stay separate and only toggle the current user', async () => {
  const f = fixture(), state = await f.signIn();
  const comment = await f.provider.addComment(ENTRY, ' 一起记住 '); assert.equal(comment.content, '一起记住'); assert.equal(comment.authorId, U1);
  await f.provider.toggleReaction(ENTRY); await f.provider.toggleFavorite(ENTRY);
  assert.deepEqual(state.entries[0].reactionBy, [U1]); assert.deepEqual(state.entries[0].favoriteBy, [U1]);
  await f.provider.toggleReaction(ENTRY); assert.deepEqual(state.entries[0].reactionBy, []); assert.deepEqual(state.entries[0].favoriteBy, [U1]);
});

test('failed upload cleans its own reservation and preserves existing photos; network failure never reports success', async () => {
  const f = fixture({ initialMedia: true, before: async call => { if (call.action === 'upload') throw new Error('connection lost'); } });
  const state = await f.signIn(), oldEntry = structuredClone(state.entries[0]);
  await assert.rejects(f.provider.saveEntry({ id: ENTRY, content: '可能部分保存', media: [] }, [file()]), error => error.code === 'PARTIAL_SAVE' && error.causeCode === 'NETWORK');
  assert.deepEqual(state.entries[0], oldEntry); assert.equal(f.tables.media.length, 1); assert.equal(f.tables.media[0].id, MEDIA);
  assert.equal(f.objects.size, 1); assert.ok(f.calls.some(value => value.name === 'discard_media'));
});

test('optimistic updatedAt condition detects another editor instead of overwriting', async () => {
  const f = fixture(), state = await f.signIn();
  f.tables.entries[0].updatedAt = '2026-11-16T03:00:00.000Z'; f.tables.entries[0].content = 'other editor';
  await assert.rejects(f.provider.saveEntry({ ...state.entries[0], content: 'stale edit' }), error => error.code === 'CONFLICT');
  assert.equal(f.tables.entries[0].content, 'other editor');
});

test('logout waits for an unabortable delayed SDK login, clears SDK session, and rejects duplicate attempts', async () => {
  const entered = deferred(), release = deferred(); let hold = true;
  const f = fixture({ before: async call => { if (call.action === 'login' && hold) { hold = false; entered.resolve(); await release.promise; } } });
  const state = await f.provider.init(), login = f.signIn(), rejected = assert.rejects(login, error => error.code === 'AUTH_CANCELLED');
  await entered.promise; await assert.rejects(f.signIn('ll'), error => error.code === 'AUTH_BUSY');
  const logout = f.provider.logout(); assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  release.resolve(); await Promise.all([rejected, logout]);
  assert.equal(f.session(), null); assert.equal(state.currentUser, null); assert.ok(!f.calls.some(value => value.kind === 'table'));
  assert.equal((await f.provider.init()).currentUser, null, 'explicit logout never restores a late session');
  await f.signIn(); assert.equal(state.currentUser.id, U1);
});

test('late hydration and queued mutations cannot revive state or URLs after logout', async () => {
  const entered = deferred(), release = deferred(); let hold = false;
  const f = fixture({ initialMedia: true, before: async call => { if (call.table === 'entries' && call.action === 'update' && hold) { entered.resolve(); await release.promise; } } });
  const state = await f.signIn(); hold = true;
  const save = f.provider.saveEntry({ id: ENTRY, content: 'late mutation' }), queued = f.provider.deleteEntry(ENTRY);
  const a = assert.rejects(save, error => error.code === 'AUTH_CANCELLED'), b = assert.rejects(queued, error => error.code === 'AUTH_CANCELLED');
  await entered.promise; await f.provider.logout(); release.resolve(); await Promise.all([a, b]);
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.deepEqual(f.revoked, ['blob:private-1']);
  assert.equal(f.calls.filter(value => value.table === 'entries' && value.action === 'update').length, 1);
});

test('invalid fixed member profiles fail closed and an empty interrupted-upload note remains readable and deletable', async () => {
  const f = fixture(); f.tables.profiles.find(value => value.slot === 2).username = 'unapproved-member';
  await assert.rejects(f.signIn(), error => error.code === 'INVALID_RESPONSE');
  const empty = fixture(); empty.tables.entries[0].content = '';
  const state = await empty.signIn(); assert.equal(state.entries[0].content, '');
  await empty.provider.deleteEntry(ENTRY); assert.ok(state.entries[0].deletedAt);
});

test('unconfirmed remote logout still clears local state and blocks init restoration', async () => {
  const f = fixture({ before: async call => { if (call.action === 'logout') throw new Error('offline'); } });
  const state = await f.signIn(); await assert.rejects(f.provider.logout(), error => error.code === 'NETWORK');
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []);
  assert.ok(f.session(), 'the SDK fixture intentionally keeps its old session on network failure');
  assert.equal((await f.provider.init()).currentUser, null, 'no implicit reauthentication after an explicit logout');
});

test('new records publish only after attachment finalization; failed drafts never enter the shared state', async () => {
  const f = fixture(), state = await f.signIn();
  const saved = await f.provider.saveEntry({ ...input(), content: '' }, [file('only-photo.png')]);
  assert.equal(saved.media.length, 1); assert.ok(state.entries.some(value => value.id === saved.id));
  const stages = f.calls.filter(value => value.kind === 'rpc').map(value => value.name);
  assert.deepEqual(stages, ['reserve_media', 'finalize_media', 'publish_entry']);
  const failing = fixture({ before: async call => { if (call.action === 'upload') throw new Error('offline'); } });
  const otherState = await failing.signIn();
  await assert.rejects(failing.provider.saveEntry({ ...input(), content: '' }, [file()]), error => error.code === 'PARTIAL_SAVE');
  assert.equal(failing.tables.entries.filter(value => value.status === 'draft').length, 1);
  await failing.provider.refresh(); assert.equal(otherState.entries.length, 1, 'unpublished upload placeholders stay out of the UI');
});

test('nine-image replacement stages the new image and atomically publishes before retiring an original', async () => {
  const f = fixture(), state = await f.signIn();
  await f.provider.saveEntry({ id: ENTRY }, Array.from({ length: 9 }, (_, index) => file(`${index}.png`, `image-${index}`)));
  assert.equal(state.entries[0].media.length, 9);
  const before = f.calls.length, keep = state.entries[0].media.slice(1), removed = state.entries[0].media[0].id;
  await f.provider.saveEntry({ id: ENTRY, media: keep }, [file('replacement.png')]);
  assert.equal(state.entries[0].media.length, 9); assert.ok(!state.entries[0].media.some(value => value.id === removed));
  const order = f.calls.slice(before).filter(value => value.kind === 'rpc' || value.kind === 'storage').map(value => value.name || value.action);
  assert.ok(order.indexOf('reserve_media') < order.indexOf('publish_entry'));
  assert.ok(order.indexOf('publish_entry') < order.indexOf('remove'));
  assert.ok(order.indexOf('remove') < order.indexOf('discard_media'));
});

test('one missing private object degrades only its attachment and makes complete export fail explicitly', async () => {
  const f = fixture({ initialMedia: true }); f.objects.clear();
  const state = await f.signIn();
  assert.equal(state.currentUser.id, U1); assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].media[0].id, MEDIA); assert.equal(state.entries[0].media[0].url, ''); assert.match(state.entries[0].media[0].error, /无法读取/);
  await assert.rejects(f.provider.exportData('mine'), error => error.code === 'MISSING_MEDIA');
  await f.provider.saveEntry({ id: ENTRY, media: [], content: '清理损坏附件' }); assert.deepEqual(state.entries[0].media, []);
});

test('late private download never creates a Blob URL after logout', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ initialMedia: true, before: async call => { if (call.action === 'download') { entered.resolve(); await release.promise; } } });
  const state = await f.provider.init(), login = f.signIn(), rejected = assert.rejects(login, error => error.code === 'AUTH_CANCELLED');
  await entered.promise; await f.provider.logout(); release.resolve(); await rejected;
  assert.equal(state.currentUser, null); assert.deepEqual(state.entries, []); assert.deepEqual(f.urls, []);
});

test('pagination does not silently omit records beyond the API page size', async () => {
  const f = fixture(); const template = f.tables.entries[0];
  for (let index = 2; index <= 503; index++) f.tables.entries.push({ ...template, id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}` });
  const state = await f.signIn(); assert.equal(state.entries.length, 503);
  assert.deepEqual(f.calls.filter(value => value.table === 'entries').map(value => value.offset), [0, 500]);
});

test('failed atomic publication preserves the old attached original and reports partial completion', async () => {
  const f = fixture({ initialMedia: true, before: async call => { if (call.name === 'publish_entry') throw new Error('publication response lost'); } });
  const state = await f.signIn();
  await assert.rejects(f.provider.saveEntry({ id: ENTRY, media: [], content: '换一张照片' }, [file('replacement.png', 'replacement')]), error => error.code === 'PARTIAL_SAVE');
  const original = f.tables.media.find(value => value.id === MEDIA);
  assert.equal(original.attached, true); assert.equal(original.status, 'ready'); assert.ok(f.objects.has(original.storagePath));
  assert.ok(!f.calls.some(value => value.action === 'remove'), 'an ambiguous publication never deletes originals or staged bytes');
  await f.provider.refresh(); assert.deepEqual(state.entries[0].media.map(value => value.id), [MEDIA]);
});

test('retired-file cleanup failure reports a warning while preserving a confirmed successful publication', async () => {
  const f = fixture({ initialMedia: true, before: async call => { if (call.action === 'remove') throw new Error('cleanup offline'); } });
  await f.signIn();
  const saved = await f.provider.saveEntry({ id: ENTRY, media: [], content: '确认发布' }, [file('replacement.png', 'replacement')]);
  assert.equal(saved.content, '确认发布'); assert.equal(saved.media.length, 1); assert.notEqual(saved.media[0].id, MEDIA);
  assert.equal(saved.cleanupPending, true); assert.match(saved.cleanupWarning, /内容已保存/);
  const original = f.tables.media.find(value => value.id === MEDIA);
  assert.equal(original.attached, false); assert.equal(original.status, 'retired'); assert.ok(f.objects.has(original.storagePath));
});

test('entry compare-and-swap keeps the exact server timestamp including microseconds', async () => {
  const f = fixture(); f.tables.entries[0].updatedAt = '2026-11-16T02:00:00.123456+00:00';
  const state = await f.signIn(); assert.equal(state.entries[0].updatedAt, '2026-11-16T02:00:00.123Z');
  await f.provider.saveEntry({ ...state.entries[0], content: 'precise edit' });
  const update = f.calls.find(value => value.table === 'entries' && value.action === 'update');
  assert.deepEqual(update.filters.find(([key]) => key === 'updatedAt'), ['updatedAt', '2026-11-16T02:00:00.123456+00:00']);
});
