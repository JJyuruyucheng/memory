import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLoginPhotosVerificationHandler, PROJECT_ORIGIN, IDENTITIES, PNG_BYTES } from '../supabase/login-photos-verification/core.mjs';
import disabled from '../supabase/login-photos-verification/index.ts';
import retired from '../supabase/login-photos-verification/retired.ts';

const NOW = 1_800_000_000_000, CAP = 'ab'.repeat(32), DIGEST = createHash('sha256').update(CAP).digest('hex');
const SECRET = 'sb_secret_login_photo_probe_fixture', PUBLIC = 'sb_publishable_login_photo_probe_fixture_public';
const IDS = IDENTITIES.map((_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`), FOREIGN = '99999999-0000-4000-8000-000000000001';
const token = i => `fixture.${Buffer.from(IDS[i]).toString('base64url')}.session`;
const user = i => ({ id: IDS[i], email: IDENTITIES[i].email, aud: 'authenticated', role: 'authenticated', is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z' });
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const policy = extra => ({ enabled: true, prerequisitesVerified: true, projectOrigin: PROJECT_ORIGIN, publishableKey: PUBLIC, capabilitySha256: DIGEST, issuedAt: NOW - 1000, expiresAt: NOW + 599_000, ...extra });
const request = ({ headers = {}, body = { run: true }, url = 'http://internal.invalid/probe' } = {}) => new Request(url, { method: 'POST', headers: { authorization: `Bearer ${CAP}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

// Injection tests inspect HTTP credential/scope boundaries. These are not a
// second hosted database and cannot establish real RLS behavior.
function setup({ initialPhotos = [], bucket, hook, after, config } = {}) {
  const calls = [], assets = new Map(), objects = new Map(), entries = new Map([[FOREIGN, { id: FOREIGN, authorId: IDS[0], content: 'pre-existing private entry', status: 'published' }]]), media = new Map(), sessions = new Set(), loggedOut = [];
  let serial = 100, gallery = { revision: 0, photos: initialPhotos }, currentBucket = bucket === undefined ? null : bucket;
  const uuid = () => `10000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const member = headers => IDS.findIndex((_, i) => headers.get('authorization') === `Bearer ${token(i)}` && sessions.has(token(i)));
  const publicPhoto = asset => ({ id: asset.id, path: asset.path, mimeType: asset.mimeType, size: asset.size });
  const rpcError = (code = '42501', status = 403) => response({ code }, status);
  const state = { calls, assets, objects, entries, media, sessions, loggedOut, gallery: () => gallery, setGallery(value) { gallery = value; } };
  async function fetcher(input, init) {
    const url = new URL(input), headers = new Headers(init.headers), privileged = headers.get('apikey') === SECRET, index = member(headers);
    assert.equal(url.origin, PROJECT_ORIGIN); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
    const body = init.body instanceof Uint8Array ? init.body : init.body ? JSON.parse(init.body) : undefined;
    const call = { path: url.pathname, url, method: init.method, body, headers, privileged, index }; calls.push(call);
    const injected = await hook?.(call, state); if (injected) return injected;
    let out;
    if (call.path === '/auth/v1/admin/users') { assert.ok(privileged); assert.equal(init.method, 'GET'); out = response({ users: IDS.map((_, i) => user(i)) }, 200, { 'x-total-count': '3' }); }
    else if (call.path === '/auth/v1/admin/generate_link') { assert.ok(privileged); assert.equal(body.type, 'magiclink'); const i = IDENTITIES.findIndex(v => v.email === body.email); assert.ok(i >= 0); out = response({ ...user(i), hashed_token: `test-hash-for-identity-${i}` }); }
    else if (call.path === '/auth/v1/verify') { assert.equal(privileged, false); assert.equal(headers.get('authorization'), null); const i = Number(body.token_hash.at(-1)); sessions.add(token(i)); out = response({ access_token: token(i), user: user(i) }); }
    else if (call.path === '/auth/v1/user') { assert.ok(index >= 0); assert.equal(privileged, false); out = response(user(index)); }
    else if (call.path === '/auth/v1/logout') { assert.equal(privileged, false); assert.equal(url.searchParams.get('scope'), 'local'); assert.ok(index >= 0); sessions.delete(token(index)); loggedOut.push(index); out = new Response(null, { status: 204 }); }
    else if (call.path.startsWith('/storage/v1/bucket')) {
      assert.ok(privileged);
      if (init.method === 'POST') { assert.equal(call.path, '/storage/v1/bucket'); assert.equal(currentBucket, null); currentBucket = structuredClone(body); out = response({ name: 'login-photos' }); }
      else if (call.path.endsWith('/memory-media')) out = response({ id: 'memory-media', public: false });
      else out = currentBucket ? response(currentBucket) : response({ statusCode: '404', error: 'not_found' }, 400);
    } else if (call.path === '/rest/v1/profiles') { assert.equal(privileged, false); assert.ok(index >= 0); out = response(IDENTITIES.map((identity, i) => ({ ...identity, id: IDS[i] }))); }
    else if (call.path.startsWith('/rest/v1/rpc/')) {
      assert.equal(privileged, false, 'RLS assertions never receive server credential'); assert.equal(headers.get('apikey'), PUBLIC);
      const name = call.path.split('/').at(-1);
      if (name === 'get_login_photos') out = response(gallery);
      else if (index < 0) out = rpcError();
      else if (name === 'reserve_login_photo') {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(body.p_mime_type) || body.p_size > 5_000_000) out = rpcError('22023', 400);
        else { const id = uuid(), asset = { id, path: `slides/${id}`, mimeType: body.p_mime_type, size: body.p_size, status: 'pending', owner: index }; assets.set(id, asset); out = response(publicPhoto(asset)); }
      } else if (name === 'finalize_login_photo') { const asset = assets.get(body.p_photo_id); assert.equal(asset.owner, index); assert.ok(objects.has(asset.path)); asset.status = 'ready'; out = response(publicPhoto(asset)); }
      else if (name === 'publish_login_photos') {
        if (body.p_photo_ids.length > 8) out = rpcError('22023', 400);
        else if (body.p_expected_revision !== gallery.revision) out = rpcError('PT409', 409);
        else {
          const selected = body.p_photo_ids.map(id => assets.get(id));
          if (selected.some(asset => !asset || asset.status !== 'ready' || asset.owner !== index && !gallery.photos.some(p => p.id === asset.id))) out = rpcError();
          else { for (const old of gallery.photos) if (!body.p_photo_ids.includes(old.id) && assets.has(old.id)) assets.get(old.id).status = 'retired'; gallery = { revision: gallery.revision + 1, photos: selected.map(publicPhoto) }; out = response(gallery); }
        }
      } else if (name === 'get_login_photo_cleanup') out = response([...assets.values()].filter(asset => !gallery.photos.some(p => p.id === asset.id) && (asset.owner === index || asset.status === 'retired')).map(asset => ({ id: asset.id, path: asset.path, status: asset.status })));
      else if (name === 'discard_login_photo') { const asset = assets.get(body.p_photo_id); if (gallery.photos.some(p => p.id === body.p_photo_id) || asset && objects.has(asset.path)) out = rpcError('23514', 400); else { assets.delete(body.p_photo_id); out = new Response(null, { status: 204 }); } }
      else if (name === 'reserve_media') { const parent = entries.get(body.p_entry_id); assert.equal(parent.authorId, IDS[index]); const id = uuid(), row = { id, entryId: parent.id, authorId: parent.authorId, uploadedBy: parent.authorId, storagePath: `${parent.authorId}/${parent.id}/${id}` }; media.set(id, row); out = response(row); }
      else throw new Error(`Unexpected RPC ${name}`);
    } else if (call.path.startsWith('/rest/v1/')) {
      const table = call.path.slice('/rest/v1/'.length), store = table === 'entries' ? entries : media;
      assert.ok(['entries', 'media'].includes(table));
      const rows = [...store.values()].filter(row => [...url.searchParams].every(([key, value]) => key === 'select' || value.startsWith('eq.') && String(row[key]) === value.slice(3)));
      if (init.method === 'POST') { assert.equal(privileged, false); const row = { ...body, authorId: IDS[index], status: 'draft' }; entries.set(row.id, row); out = response([row], 201); }
      else if (init.method === 'DELETE') { assert.ok(privileged); assert.equal(rows.some(row => row.id === FOREIGN), false); rows.forEach(row => store.delete(row.id)); out = new Response(null, { status: 204 }); }
      else { assert.ok(privileged); out = response(rows); }
    } else if (call.path.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(call.path.slice('/storage/v1/object/'.length));
      if (rest.startsWith('info/memory-media/')) { assert.ok(privileged); const path = rest.slice('info/memory-media/'.length); out = objects.has(path) ? response({ size: PNG_BYTES.length }) : response({ code: 'NoSuchKey' }, 404); }
      else if (init.method === 'DELETE') {
        const isPrivate = rest === 'memory-media'; if (isPrivate) assert.ok(privileged); else assert.equal(privileged, false);
        const removed = []; for (const path of body.prefixes) { if (!isPrivate && gallery.photos.some(p => p.path === path)) continue; const asset = [...assets.values()].find(a => a.path === path); if (!isPrivate && asset && asset.owner !== index && asset.status !== 'retired') continue; if (objects.delete(path)) removed.push({ name: path }); } out = response(removed);
      } else {
        const publicRoute = rest.startsWith('public/'), simple = publicRoute ? rest.slice(7) : rest, slash = simple.indexOf('/'), bucketName = simple.slice(0, slash), path = simple.slice(slash + 1);
        const asset = [...assets.values()].find(a => a.path === path);
        if (init.method === 'POST') {
          assert.equal(privileged, false); assert.ok(index >= 0);
          if (headers.get('x-upsert') === 'true' || objects.has(path)) out = rpcError();
          else { if (bucketName === 'login-photos') assert.equal(asset.owner, index); objects.set(path, PNG_BYTES); out = response({ Key: `${bucketName}/${path}` }); }
        } else if (!objects.has(path) || publicRoute || bucketName === 'memory-media' && index < 0 || bucketName === 'login-photos' && !gallery.photos.some(p => p.path === path) && asset?.owner !== index) out = response({ error: 'not_found', statusCode: '404' }, 400);
        else out = new Response(objects.get(path), { headers: { 'Content-Type': 'image/png' } });
      }
    } else throw new Error(`Unexpected route ${call.path}`);
    await after?.(call, state); return out;
  }
  const env = { SUPABASE_URL: PROJECT_ORIGIN, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) };
  const handler = createLoginPhotosVerificationHandler(policy(config), { env: key => env[key], fetch: fetcher, now: () => NOW, randomUUID: uuid });
  return { handler, ...state };
}

test('disabled and retired templates return 410 without touching credentials or upstream', async () => {
  assert.equal((await disabled.fetch(request())).status, 410); assert.equal((await retired.fetch(request())).status, 410);
  const fx = setup({ config: { expiresAt: NOW - 1 } }); assert.equal((await fx.handler(request())).status, 410); assert.equal(fx.calls.length, 0);
});

test('capability, fixed origin, small request and no browser Origin protect activation', async () => {
  for (const [req, config] of [[request({ headers: { authorization: 'Bearer invalid' } }), {}], [request({ headers: { Origin: 'https://memory-awv.pages.dev' } }), {}], [request({ body: { run: true, extra: true } }), {}], [request(), { projectOrigin: 'https://other.invalid' }], [request(), { expiresAt: NOW + 700_000 }]]) {
    const fx = setup({ config }); assert.notEqual((await fx.handler(req)).status, 200); assert.equal(fx.calls.length, 0);
  }
});

test('complete probe exercises credential separation, both members/admin, public selected bytes and precise cleanup', async () => {
  const fx = setup(); const result = await (await fx.handler(request())).json();
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(Object.values(result.metrics.checks).every(Boolean), true); assert.equal(result.metrics.uploadedObjects, 4); assert.equal(result.metrics.passwordCaptchaTested, false);
  assert.equal(result.cleanup.complete, true); assert.equal(fx.gallery().photos.length, 0); assert.equal(fx.assets.size, 0); assert.equal(fx.objects.size, 0); assert.equal(fx.media.size, 0); assert.equal(fx.entries.size, 1); assert.equal(fx.entries.get(FOREIGN).content, 'pre-existing private entry'); assert.deepEqual(fx.loggedOut, [0, 1, 2]);
  assert.equal(fx.calls.some(call => call.method === 'PATCH' || call.path.includes('/admin/users/') || call.path.includes('/settings')), false);
  assert.equal(JSON.stringify(result).includes(SECRET), false); assert.equal(JSON.stringify(result).includes(token(0)), false);
  const replay = await fx.handler(request()); assert.equal(replay.status, 409); assert.equal((await replay.json()).error, 'ALREADY_RUN');
});

test('existing login selection or mismatched bucket stops without altering it or creating sessions', async () => {
  const existingPhoto = { id: FOREIGN, path: `slides/${FOREIGN}`, mimeType: 'image/png', size: PNG_BYTES.length };
  const fx = setup({ initialPhotos: [existingPhoto] }); const result = await (await fx.handler(request())).json();
  assert.equal(result.error, 'GALLERY_NOT_EMPTY'); assert.deepEqual(fx.gallery().photos, [existingPhoto]); assert.equal(fx.calls.length, 1);
  const bad = setup({ bucket: { id: 'login-photos', name: 'login-photos', public: true, file_size_limit: 5_000_000, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] } });
  const rejected = await (await bad.handler(request())).json(); assert.equal(rejected.error, 'BUCKET_CONFIGURATION_MISMATCH'); assert.equal(bad.calls.some(c => c.method !== 'GET' && c.path.startsWith('/storage/v1/bucket')), false); assert.equal(bad.sessions.size, 0);
});

test('anonymous staging leak fails and removes only known generated reservations', async () => {
  const fx = setup({ hook(call) { if (call.path.startsWith('/storage/v1/object/login-photos/slides/') && call.method === 'GET' && !call.headers.has('authorization')) return new Response(PNG_BYTES, { headers: { 'Content-Type': 'image/png' } }); } });
  const result = await (await fx.handler(request())).json(); assert.equal(result.error, 'UNSELECTED_PHOTO_READ_ALLOWED'); assert.equal(result.cleanup.complete, true); assert.equal(fx.assets.size, 0); assert.equal(fx.objects.size, 0); assert.equal(fx.sessions.size, 0);
});

test('unexpected foreign selection is preserved and selected fixtures are reported rather than removed', async () => {
  const fx = setup({ after(call, state) { if (call.path === '/rest/v1/entries' && call.method === 'POST') { const gallery = state.gallery(); state.setGallery({ ...gallery, revision: gallery.revision + 1, photos: [...gallery.photos, { id: FOREIGN, path: `slides/${FOREIGN}`, mimeType: 'image/png', size: PNG_BYTES.length }] }); } } });
  const result = await (await fx.handler(request())).json(); assert.equal(result.ok, false); assert.equal(result.cleanup.gallery, false); assert.ok(result.cleanup.errors.includes('FOREIGN_SELECTION_PRESERVED')); assert.ok(fx.gallery().photos.some(photo => photo.id === FOREIGN)); assert.equal(result.cleanup.remainingPhotoIds.length, 2); assert.equal(fx.entries.size, 1); assert.equal(fx.sessions.size, 0);
});

test('lost reserve or native session response is reported as uncertain instead of false cleanup success', async () => {
  const reservation = setup({ after(call) { if (call.path.endsWith('/reserve_login_photo') && call.index >= 0) throw new TypeError('lost reserve response'); } });
  const first = await (await reservation.handler(request())).json(); assert.equal(first.metrics.uncertainReservation, true); assert.equal(first.cleanup.complete, false); assert.ok(first.cleanup.errors.includes('UNKNOWN_RESERVATION_POSSIBLE')); assert.equal(reservation.assets.size, 1);
  const session = setup({ after(call) { if (call.path === '/auth/v1/verify') throw new TypeError('lost verify response'); } });
  const second = await (await session.handler(request())).json(); assert.equal(second.metrics.unknownSessionPossible, true); assert.equal(second.cleanup.sessions, false); assert.ok(second.cleanup.errors.includes('UNKNOWN_SESSION_POSSIBLE'));
});

test('a gateway 503 after reservation commit is not treated as known rollback', async () => {
  const unknown = '88888888-0000-4000-8000-000000000001';
  const fx = setup({ hook(call, state) {
    if (call.path.endsWith('/reserve_login_photo') && call.index >= 0) {
      state.assets.set(unknown, { id: unknown, path: `slides/${unknown}`, owner: call.index, status: 'pending', mimeType: 'image/png', size: PNG_BYTES.length });
      return response({ code: 'gateway_unavailable' }, 503);
    }
  } });
  const result = await (await fx.handler(request())).json();
  assert.equal(result.error, 'PHOTO_RESERVE_FAILED'); assert.equal(result.metrics.uncertainReservation, true); assert.equal(result.cleanup.rows, false); assert.equal(fx.assets.has(unknown), true);
  assert.equal(fx.calls.some(call => call.path.endsWith('/discard_login_photo') && call.index >= 0), false, 'never expand cleanup to an unknown upload');
});
