import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginPhotosProvider, createDemoLoginPhotosProvider } from '../src/login-photos-provider.js';

const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const P = '10000000-0000-4000-8000-000000000001', Q = '10000000-0000-4000-8000-000000000002';
const blob = () => new Blob(['picture'], { type: 'image/jpeg' });
const photo = id => ({ id, path: `slides/${id}`, mimeType: 'image/jpeg', size: blob().size });
const ok = data => ({ data, error: null });
const fail = (code, status = 400) => ({ data: null, error: { code, status } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Official SDK boundary fixture: authorization/CAS decisions belong to the
// real database and are also exercised by the separate rollback/HTTP checks.
function fixture({ before = async () => {}, user = A, revision = 1, selected = [P], losePublishResponse = false, cleanupFails = false, conflictCode = 'PT409', conflictStatus = 409 } = {}) {
  let identity = user, nextId = 20;
  const listeners = new Set(), calls = [], urls = [], revoked = [];
  const assets = new Map(selected.map(id => [id, { ...photo(id), creator: A, state: 'ready' }]));
  const objects = new Map(selected.map(id => [photo(id).path, blob()]));
  let gallery = { revision, photos: selected.map(photo) };
  const api = {
    auth: {
      getUser: async () => ok({ user: identity ? { id: identity } : null }),
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
    },
    async rpc(name, args) {
      const call = { kind: 'rpc', name, args }; calls.push(call); await before(call);
      if (name === 'get_login_photos') return ok(structuredClone(gallery));
      if (!identity) return fail('42501', 403);
      if (name === 'get_login_photo_cleanup') return ok([...assets.values()].filter(asset => !gallery.photos.some(p => p.id === asset.id) && (asset.creator === identity || asset.state === 'retired')).map(asset => ({ id: asset.id, path: asset.path, status: asset.state, createdAt: '2026-11-16T00:00:00Z' })));
      if (name === 'reserve_login_photo') {
        const id = `20000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
        const asset = { id, path: `slides/${id}`, mimeType: args.p_mime_type, size: args.p_size, creator: identity, state: 'pending' };
        assets.set(id, asset); return ok(asset);
      }
      if (name === 'finalize_login_photo') {
        const asset = assets.get(args.p_photo_id);
        if (!asset || asset.creator !== identity || !objects.has(asset.path)) return fail('42501', 403);
        asset.state = 'ready'; return ok(asset);
      }
      if (name === 'publish_login_photos') {
        if (args.p_expected_revision !== gallery.revision) return fail(conflictCode, conflictStatus);
        const chosen = args.p_photo_ids.map(id => assets.get(id));
        if (chosen.some(asset => !asset || asset.state !== 'ready')) return fail('42501', 403);
        for (const asset of assets.values()) if (gallery.photos.some(p => p.id === asset.id) && !chosen.includes(asset)) asset.state = 'retired';
        gallery = { revision: gallery.revision + 1, photos: chosen.map(({ id, path, mimeType, size }) => ({ id, path, mimeType, size })) };
        if (losePublishResponse) throw new TypeError('Network interrupted after commit');
        return ok(structuredClone(gallery));
      }
      if (name === 'discard_login_photo') {
        const asset = assets.get(args.p_photo_id);
        if (gallery.photos.some(p => p.id === args.p_photo_id) || (asset && objects.has(asset.path))) return fail('23514');
        assets.delete(args.p_photo_id); return ok(null);
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'login-photos', 'public artwork never reads or changes memory-media');
      return {
        async download(path) { const call = { kind: 'download', path }; calls.push(call); await before(call); return ok(objects.get(path)); },
        async upload(path, body, options) { const call = { kind: 'upload', path, options }; calls.push(call); await before(call); assert.equal(options.upsert, false); if (objects.has(path)) return fail('23505', 409); objects.set(path, body); return ok({ path }); },
        async remove(paths) {
          const call = { kind: 'remove', paths }; calls.push(call); await before(call);
          if (cleanupFails) return fail('Unavailable', 503);
          if (paths.some(path => gallery.photos.some(p => p.path === path))) return fail('42501', 403);
          for (const path of paths) objects.delete(path); return ok([]);
        },
      };
    } },
  };
  const provider = createLoginPhotosProvider({ client: api, getCurrentUser: () => identity ? { id: identity } : null, urlAPI: { createObjectURL(value) { assert.ok(value instanceof Blob); const url = `blob:test-${urls.length}`; urls.push(url); return url; }, revokeObjectURL(url) { revoked.push(url); } } });
  return { provider, calls, assets, objects, urls, revoked, gallery: () => gallery, switchUser(id) { identity = id; listeners.forEach(listener => listener('SIGNED_IN', id ? { user: { id } } : null)); }, addStaged(id, owner = A, status = 'ready') { const asset = { ...photo(id), creator: owner, state: status }; assets.set(id, asset); objects.set(asset.path, blob()); } };
}

test('anonymous manifest does not download images until current/next is requested; requests are shared', async () => {
  const { provider, calls } = fixture({ user: null });
  const manifest = await provider.getLoginPhotos();
  assert.equal(manifest.photos[0].url, undefined);
  assert.equal(calls.filter(c => c.kind === 'download').length, 0);
  const [first, second] = await Promise.all([provider.getPhotoUrl(P), provider.getPhotoUrl(P)]);
  assert.equal(first, second); assert.match(first, /^blob:/);
  assert.equal(calls.filter(c => c.kind === 'download').length, 1);
  await assert.rejects(provider.saveLoginPhotos({ revision: 1, photos: [] }), { code: 'UNAUTHENTICATED' });
});

test('image downloads are bounded to two and disposed URLs are revoked', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  let active = 0, maximum = 0;
  const { provider, urls, revoked } = fixture({ selected: ids, before: async call => { if (call.kind === 'download') { active++; maximum = Math.max(active, maximum); await new Promise(resolve => setTimeout(resolve, 5)); active--; } } });
  const result = await provider.getLoginPhotos({ hydrate: true });
  assert.equal(result.photos.length, 8); assert.ok(result.photos.every(p => p.url)); assert.equal(maximum, 2);
  provider.dispose(); assert.deepEqual(revoked, urls);
});

test('manifest cannot inject URLs, creator identifiers, private storage paths or duplicate photos', async () => {
  for (const bad of [{ ...photo(P), path: `${A}/private-entry/${P}` }, { ...photo(P), mimeType: 'image/svg+xml' }, { ...photo(P), size: 6_000_000 }]) {
    const client = { auth: { getUser: () => ok({ user: null }) }, storage: { from() {} }, rpc: async () => ok({ revision: 1, photos: [bad] }) };
    await assert.rejects(createLoginPhotosProvider({ client }).getLoginPhotos(), { code: 'INVALID_RESPONSE' });
  }
  const client = { auth: { getUser: () => ok({ user: null }) }, storage: { from() {} }, rpc: async () => ok({ revision: 1, photos: [{ ...photo(P), url: 'https://untrusted.invalid/', createdBy: A }] }) };
  const manifest = await createLoginPhotosProvider({ client }).getLoginPhotos();
  assert.equal(manifest.photos[0].url, undefined); assert.equal(manifest.photos[0].createdBy, undefined);
});

test('invalid save order, duplicate files, unsupported format and excess count cause no network writes', async () => {
  const { provider, calls } = fixture();
  for (const [photos, files] of [
    [[{ id: P }, { id: P }], []], [[{ fileIndex: 0 }, { fileIndex: 0 }], [blob()]],
    [[{ fileIndex: 1 }], [blob()]], [[{ fileIndex: 0 }], [new Blob(['svg'], { type: 'image/svg+xml' })]],
    [Array.from({ length: 9 }, () => ({ id: P })), []], [[{ id: P }], [blob()]],
  ]) await assert.rejects(provider.saveLoginPhotos({ revision: 1, photos }, files), { code: 'VALIDATION' });
  assert.equal(calls.length, 0);
});

test('both member identities can retain, replace and order selected photos; reserved names contain no original filename', async () => {
  const { provider, calls, objects, gallery } = fixture({ selected: [P, Q], user: B });
  const saved = await provider.saveLoginPhotos({ revision: 1, photos: [{ id: Q }, { fileIndex: 0 }, { id: P }] }, [new File(['picture'], 'GPS-full-name.jpg', { type: 'image/jpeg' })]);
  assert.equal(saved.revision, 2); assert.deepEqual(saved.photos.map(p => p.id), gallery().photos.map(p => p.id));
  assert.equal(saved.photos[0].id, Q); assert.equal(saved.photos[2].id, P); assert.ok(objects.has(saved.photos[1].path));
  assert.equal(JSON.stringify(calls).includes('GPS-full-name'), false);
  const mutation = calls.filter(c => ['upload'].includes(c.kind) || c.kind === 'rpc' && /reserve|finalize|publish/.test(c.name));
  assert.deepEqual(mutation.map(c => c.name || c.kind), ['reserve_login_photo', 'upload', 'finalize_login_photo', 'publish_login_photos']);
});

test('PT409, legacy 40001 and HTTP409 conflicts remove only this attempt uploads and preserve existing public pictures', async t => {
  for (const [conflictCode, conflictStatus] of [['PT409', 409], ['PT409', 0], ['40001', 0], ['legacy-conflict', 409]]) await t.test(`${conflictCode}/${conflictStatus}`, async () => {
    const { provider, objects, assets, gallery } = fixture({ conflictCode, conflictStatus });
    await assert.rejects(provider.saveLoginPhotos({ revision: 0, photos: [{ fileIndex: 0 }] }, [blob()]), { code: 'CONFLICT' });
    assert.deepEqual(gallery().photos.map(p => p.id), [P]); assert.equal(objects.size, 1); assert.equal(assets.size, 1);
  });
});

test('lost publication response cannot delete photos that the server successfully selected', async () => {
  const { provider, objects, gallery } = fixture({ losePublishResponse: true });
  await assert.rejects(provider.saveLoginPhotos({ revision: 1, photos: [{ fileIndex: 0 }] }, [blob()]), { code: 'NETWORK' });
  assert.equal(gallery().revision, 2); assert.ok(objects.has(gallery().photos[0].path));
  const restored = await provider.getLoginPhotos({ hydrate: true }); assert.equal(restored.photos[0].id, gallery().photos[0].id);
});

test('cleanup failure after successful publication returns success with cleanupPending', async () => {
  const { provider, gallery } = fixture({ cleanupFails: true });
  const saved = await provider.saveLoginPhotos({ revision: 1, photos: [] });
  assert.equal(saved.revision, 2); assert.equal(saved.cleanupPending, true); assert.deepEqual(gallery().photos, []);
});

test('automatic cleanup never removes another editor same-account staging files', async () => {
  const { provider, addStaged, objects } = fixture(); addStaged(Q);
  await provider.saveLoginPhotos({ revision: 1, photos: [{ id: P }] });
  assert.ok(objects.has(photo(Q).path));
  const cleaned = await provider.cleanupLoginPhotos({ includeRecent: true });
  assert.equal(cleaned.cleaned, 1); assert.equal(objects.has(photo(Q).path), false);
});

test('account change while upload is in progress prevents finalization and publication', async () => {
  const wait = deferred(), entered = deferred();
  const fx = fixture({ before: async call => { if (call.kind === 'upload') { entered.resolve(); await wait.promise; } } });
  const pending = fx.provider.saveLoginPhotos({ revision: 1, photos: [{ fileIndex: 0 }] }, [blob()]);
  await entered.promise; fx.switchUser(B); wait.resolve();
  await assert.rejects(pending, { code: 'AUTH_CANCELLED' });
  assert.equal(fx.calls.some(c => c.name === 'publish_login_photos' || c.name === 'finalize_login_photo'), false);
});

test('removed public image invalidates its Blob URL and missing or mismatched bytes fail locally', async () => {
  const fx = fixture(); await fx.provider.getLoginPhotos({ hydrate: true });
  await fx.provider.saveLoginPhotos({ revision: 1, photos: [] });
  assert.deepEqual(fx.revoked, fx.urls); await assert.rejects(fx.provider.getPhotoUrl(P), { code: 'NOT_FOUND' });
  const bad = fixture(); bad.objects.set(photo(P).path, new Blob(['different'], { type: 'image/png' }));
  const result = await bad.provider.getLoginPhotos({ hydrate: true });
  assert.equal(result.photos[0].unavailable, true); assert.equal(result.photos[0].url, undefined);
  await assert.rejects(bad.provider.getPhotoUrl(P), { code: 'INVALID_RESPONSE' });
});

test('one unavailable preview does not block editing or removing it while keeping the good photo', async () => {
  const fx = fixture({ selected: [P, Q] }); fx.objects.delete(photo(Q).path);
  const manifest = await fx.provider.getLoginPhotos({ hydrate: true });
  assert.match(manifest.photos[0].url, /^blob:/); assert.equal(manifest.photos[1].unavailable, true);
  const saved = await fx.provider.saveLoginPhotos({ revision: manifest.revision, photos: [{ id: P }] });
  assert.deepEqual(saved.photos.map(p => p.id), [P]); assert.equal(saved.cleanupPending, false);
});

test('demo and live adapters expose the same lazy/read/save shape without uploading demo data', async () => {
  const urls = [], revoked = [];
  const provider = createDemoLoginPhotosProvider({ getCurrentUser: () => ({ id: A }), urlAPI: { createObjectURL() { const value = `blob:demo-${urls.length}`; urls.push(value); return value; }, revokeObjectURL(url) { revoked.push(url); } } });
  assert.deepEqual(await provider.getLoginPhotos(), { revision: 0, photos: [] });
  const saved = await provider.saveLoginPhotos({ revision: 0, photos: [{ fileIndex: 0 }] }, [blob()]);
  assert.equal(await provider.getPhotoUrl(saved.photos[0].id), saved.photos[0].url);
  await assert.rejects(provider.saveLoginPhotos({ revision: 0, photos: [] }), { code: 'CONFLICT' });
  provider.dispose(); assert.deepEqual(revoked, urls);
});
