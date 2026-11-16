import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createVerificationHandler, PROJECT_ORIGIN, IDENTITIES, PNG_BYTES } from '../supabase/verification/core.mjs';
import disabled from '../supabase/verification/index.ts';
import retired from '../supabase/verification/retired.ts';

const NOW = 1_800_000_000_000, CAPABILITY = 'ab'.repeat(32), SECRET = 'sb_secret_verification_fixture_only';
const PUBLIC = 'sb_publishable_verification_fixture_public_key';
const DIGEST = createHash('sha256').update(CAPABILITY).digest('hex');
const IDS = IDENTITIES.map((_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`);
const EXISTING = '99999999-0000-4000-8000-000000000001';
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const user = index => ({ id: IDS[index], email: IDENTITIES[index].email, aud: 'authenticated', role: 'authenticated', is_anonymous: false, email_confirmed_at: '2026-01-01T00:00:00Z' });
const token = index => `fixture.${Buffer.from(IDS[index]).toString('base64url')}.session`;
const policy = overrides => ({ enabled: true, prerequisitesVerified: true, projectOrigin: PROJECT_ORIGIN, publishableKey: PUBLIC, capabilitySha256: DIGEST, issuedAt: NOW - 1000, expiresAt: NOW + 599_000, ...overrides });
const request = ({ method = 'POST', headers = {}, body = { run: true }, url = 'http://internal.invalid/probe' } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${CAPABILITY}`, 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

// The mock verifies credential separation and cleanup scope at actual HTTP
// boundaries. It is not evidence that hosted RLS or password CAPTCHA passed.
function setup({ config = {}, env: extraEnv = {}, users = IDS.map((_, index) => user(index)), hook, after, profileMismatch = false, profileOverrides = {}, cleanupFails = false, randomUUID } = {}) {
  const calls = [], entries = new Map([[EXISTING, { id: EXISTING, authorId: IDS[0], status: 'published', title: 'pre-existing', content: 'must remain unchanged', updatedAt: '2026-01-01T00:00:00Z' }]]), media = new Map(), objects = new Map([['unrelated/existing.png', PNG_BYTES]]), sessions = new Set(), loggedOut = [];
  let serial = 100, ticks = 0;
  const uuid = () => `10000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const env = { SUPABASE_URL: PROJECT_ORIGIN, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }), ...extraEnv };
  const member = headers => { const value = headers.get('authorization'); const index = IDS.findIndex((_, i) => value === `Bearer ${token(i)}`); return index >= 0 && sessions.has(token(index)) ? index : -1; };
  const visible = (row, index) => index >= 0 && (row.status === 'published' || row.authorId === IDS[index]);
  const filtered = (rows, search) => rows.filter(row => [...search].every(([key, value]) => ['select', 'order', 'limit'].includes(key) || (value.startsWith('eq.') ? String(row[key]) === value.slice(3) : value.startsWith('in.(') ? value.slice(4, -1).split(',').includes(row[key]) : true)));
  async function fetcher(input, init) {
    const url = new URL(input), headers = new Headers(init.headers), privileged = headers.get('apikey') === SECRET || headers.get('apikey') === 'legacy.service.fixture';
    assert.equal(url.origin, PROJECT_ORIGIN); assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    const body = init.body instanceof Uint8Array ? new Uint8Array(init.body) : init.body ? JSON.parse(init.body) : undefined;
    const call = { url, path: url.pathname, method: init.method, headers, body, privileged };
    calls.push(call);
    const override = await hook?.(call, { entries, media, objects, sessions, calls }); if (override) return override;
    let result;
    const index = member(headers), actor = IDS[index];
    if (call.path.startsWith('/auth/v1/admin/')) {
      assert.ok(privileged, 'only administrator Auth endpoints receive the server credential');
      if (call.path.endsWith('/users')) result = response({ users }, 200, { 'x-total-count': String(users.length) });
      else {
        assert.equal(call.path, '/auth/v1/admin/generate_link'); assert.equal(body.type, 'magiclink');
        const i = IDENTITIES.findIndex(value => value.email === body.email); assert.ok(i >= 0);
        result = response({ ...user(i), hashed_token: `hash-for-verification-identity-${i}`, action_link: 'https://never-follow.invalid/' });
      }
    } else if (call.path === '/auth/v1/verify') {
      assert.equal(privileged, false); assert.equal(headers.get('apikey'), PUBLIC); assert.equal(headers.get('authorization'), null);
      assert.deepEqual(Object.keys(body).sort(), ['token_hash', 'type']); assert.equal(body.type, 'email');
      const i = Number(body.token_hash.at(-1)); sessions.add(token(i));
      result = response({ access_token: token(i), refresh_token: 'never-return-refresh-token', user: user(i) });
    } else if (call.path === '/auth/v1/user') {
      assert.equal(privileged, false); assert.ok(index >= 0); result = response(user(index));
    } else if (call.path === '/auth/v1/logout') {
      assert.equal(privileged, false); assert.equal(url.searchParams.get('scope'), 'local'); assert.ok(index >= 0);
      sessions.delete(token(index)); loggedOut.push(index); result = new Response(null, { status: 204 });
    } else if (call.path === '/rest/v1/profiles') {
      assert.equal(privileged, false); assert.ok(index >= 0);
      result = response(IDENTITIES.map((identity, i) => ({ id: profileMismatch && i === 0 ? EXISTING : IDS[i], slot: identity.slot, username: identity.username, role: identity.role, ...profileOverrides[i] })));
    } else if (call.path.startsWith('/rest/v1/rpc/')) {
      assert.equal(privileged, false, 'all RPC assertions must use a real user JWT'); assert.equal(headers.get('apikey'), PUBLIC); assert.ok(index >= 0);
      if (call.path.endsWith('/reserve_media')) {
        const parent = entries.get(body.p_entry_id); assert.equal(parent.authorId, actor);
        const id = uuid(), storagePath = `${actor}/${parent.id}/${id}`;
        const raw = { id, entryId: parent.id, authorId: actor, uploadedBy: actor, name: body.p_name, mimeType: body.p_mime_type, size: body.p_size, type: 'image', storagePath, status: 'pending', attached: false };
        media.set(id, raw); result = response(raw);
      } else if (call.path.endsWith('/finalize_media')) {
        const raw = media.get(body.p_media_id); assert.equal(raw.authorId, actor); assert.deepEqual(objects.get(raw.storagePath), PNG_BYTES);
        raw.status = 'ready'; result = response(raw);
      } else {
        assert.ok(call.path.endsWith('/publish_entry')); const parent = entries.get(body.p_entry_id); assert.equal(parent.authorId, actor);
        if (body.p_media_ids.length > 9) result = response({ code: '23514', message: 'too many images' }, 400);
        else {
          assert.equal(parent.updatedAt, body.p_expected_updated_at);
          const selected = body.p_media_ids.map(id => media.get(id)); assert.ok(selected.every(value => value?.entryId === parent.id && value.status === 'ready'));
          for (const raw of media.values()) if (raw.entryId === parent.id) {
            if (body.p_media_ids.includes(raw.id)) raw.attached = true;
            else if (raw.attached) { raw.attached = false; raw.status = 'retired'; }
          }
          parent.status = 'published'; parent.updatedAt = new Date(NOW + ++ticks * 1000).toISOString(); result = response(parent);
        }
      }
    } else if (call.path.startsWith('/rest/v1/')) {
      const table = call.path.slice('/rest/v1/'.length), child = table !== 'entries';
      assert.ok(['entries', 'media', 'comments', 'reactions', 'favorites'].includes(table));
      if (privileged) {
        assert.ok(['GET', 'DELETE'].includes(call.method), 'server REST credential is fixture cleanup only');
        const filter = url.searchParams.get(child ? 'entryId' : 'id'); assert.ok(filter && (call.method !== 'DELETE' || !filter.includes(EXISTING)), 'cleanup never deletes an existing record');
      } else assert.equal(headers.get('apikey'), PUBLIC);
      let rows = child ? table === 'media' ? [...media.values()] : [] : [...entries.values()];
      rows = filtered(rows, url.searchParams);
      if (!privileged && index < 0) result = response({ code: '42501' }, 403);
      else if (call.method === 'GET') result = response(rows.filter(row => privileged || (child ? visible(entries.get(row.entryId), index) && (row.authorId === actor || (row.attached && row.status === 'ready') || index === 2) : visible(row, index))));
      else if (call.method === 'POST') {
        assert.equal(privileged, false); assert.equal(table, 'entries'); assert.equal(body.authorId, undefined);
        if (entries.has(body.id)) result = response({ code: '23505' }, 409);
        else { const row = { ...body, authorId: actor, status: 'draft', updatedAt: new Date(NOW + ++ticks * 1000).toISOString() }; entries.set(row.id, row); result = response([row], 201); }
      } else if (call.method === 'PATCH') {
        assert.equal(privileged, false);
        const changed = rows.filter(row => visible(row, index) && (row.authorId === actor || (row.status === 'published' && index === 2)));
        changed.forEach(row => Object.assign(row, body, { updatedAt: new Date(NOW + ++ticks * 1000).toISOString() })); result = response(changed);
      } else {
        assert.equal(call.method, 'DELETE'); assert.equal(privileged, true);
        rows.forEach(row => (child ? media : entries).delete(row.id)); result = new Response(null, { status: 204 });
      }
    } else if (call.path.startsWith('/storage/v1/object/')) {
      const base = '/storage/v1/object/memory-media', info = '/storage/v1/object/info/memory-media/';
      if (privileged) {
        assert.ok(call.path === base && call.method === 'DELETE' || call.path.startsWith(info) && call.method === 'GET', 'server Storage credential is exact cleanup remove/info only');
        if (call.method === 'DELETE') {
          assert.ok(body.prefixes.length > 0 && body.prefixes.length <= 10);
          for (const path of body.prefixes) { assert.ok(!path.includes('unrelated')); assert.ok([...media.values()].some(value => value.storagePath === path)); }
          if (cleanupFails) result = response({ code: 'InternalError' }, 500);
          else { body.prefixes.forEach(path => objects.delete(path)); result = response(body.prefixes.map(name => ({ name }))); }
        } else {
          const path = call.path.slice(info.length); assert.ok(!path.includes('unrelated'));
          result = objects.has(path) ? response({ name: path, size: PNG_BYTES.length }) : response({ code: 'NoSuchKey', statusCode: '404' }, 400);
        }
      } else if (call.method === 'POST') {
        assert.ok(index >= 0); assert.equal(headers.get('apikey'), PUBLIC); assert.equal(headers.get('Content-Type'), 'image/png');
        const path = call.path.slice(base.length + 1), raw = [...media.values()].find(value => value.storagePath === path);
        assert.equal(raw.authorId, actor);
        if (objects.has(path)) { assert.equal(headers.get('x-upsert'), 'true'); assert.notDeepEqual(body, PNG_BYTES, 'upsert tries different valid PNG bytes'); result = response({ code: 'AccessDenied' }, 403); }
        else { assert.equal(headers.get('x-upsert'), 'false'); objects.set(path, body); result = response({ Key: `memory-media/${path}` }); }
      } else if (call.method === 'DELETE') {
        assert.ok(index >= 0); assert.equal(headers.get('apikey'), PUBLIC);
        assert.ok(body.prefixes.every(path => [...media.values()].some(value => value.storagePath === path && value.attached)));
        result = response([], 200); // RLS-filtered DELETE is not itself proof of safety.
      } else {
        assert.equal(call.method, 'GET'); const path = call.path.slice(base.length + 1), raw = [...media.values()].find(value => value.storagePath === path);
        const parent = raw && entries.get(raw.entryId);
        if (index < 0 || !objects.has(path) || !raw || !(raw.authorId === actor || parent.status === 'published' && raw.attached)) result = response({ statusCode: '404', error: 'not_found' }, 400);
        else result = new Response(objects.get(path), { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
    } else throw new Error('unexpected HTTP endpoint');
    const changed = await after?.(call, result, { entries, media, objects, sessions, calls }); return changed || result;
  }
  const handler = createVerificationHandler(policy(config), { fetch: fetcher, env: key => env[key], now: () => NOW, randomUUID: randomUUID || uuid });
  return { handler, calls, entries, media, objects, sessions, loggedOut };
}

test('default template, retired template and invalid leases never access a project', async () => {
  assert.equal((await disabled.fetch(request())).status, 410);
  for (const method of ['POST', 'GET', 'OPTIONS']) assert.equal((await retired.fetch(new Request('https://temporary.invalid', { method }))).status, 410);
  for (const config of [{ enabled: false }, { prerequisitesVerified: false }, { expiresAt: NOW }, { expiresAt: NOW + 600_000 }, { capabilitySha256: '0'.repeat(64) }, { issuedAt: NOW + 1 }]) {
    const f = setup({ config }); assert.equal((await f.handler(request())).status, 410); assert.equal(f.calls.length, 0);
  }
});

test('capability, Origin, body size and fixed project checks fail before any upstream request', async () => {
  for (const change of [{ headers: { Authorization: 'Bearer wrong' } }, { headers: { Origin: 'https://browser.invalid' } }, { url: 'http://internal.invalid/probe?token=wrong' }, { body: { run: true, passwords: 'must-not-accept' } }, { body: ' '.repeat(1025) }]) {
    const f = setup(); const result = await f.handler(request(change)); assert.ok(result.status >= 400); assert.equal(f.calls.length, 0); assert.ok(!(await result.text()).includes('must-not-accept'));
  }
  for (const env of [{ SUPABASE_URL: 'https://wrongprojectaaaaaaaaa.supabase.co' }, { SUPABASE_SECRET_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }]) {
    const f = setup({ env }); assert.equal((await f.handler(request())).status, 503); assert.equal(f.calls.length, 0);
  }
});

test('fixture PNG is real and its image data and chunk CRCs are valid', () => {
  assert.deepEqual([...PNG_BYTES.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let index = 0; index < 8; index++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  let cursor = 8, image = false;
  while (cursor < PNG_BYTES.length) {
    const view = new DataView(PNG_BYTES.buffer, PNG_BYTES.byteOffset + cursor), size = view.getUint32(0), chunk = PNG_BYTES.subarray(cursor + 4, cursor + 8 + size);
    assert.equal(crc(chunk), view.getUint32(size + 8));
    if (String.fromCharCode(...chunk.subarray(0, 4)) === 'IDAT') { assert.equal(inflateSync(chunk.subarray(4)).length, 3); image = true; }
    cursor += size + 12;
  }
  assert.equal(image, true); assert.equal(cursor, PNG_BYTES.length);
});

test('real-HTTP contract chain separates user credentials and cleans only unique fixtures, returning safe metrics', async () => {
  const f = setup(), result = await f.handler(request()), body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.ok, true); assert.ok(Object.values(body.metrics.checks).every(Boolean));
  assert.equal(body.metrics.authMethod, 'admin-generated-magiclink'); assert.equal(body.metrics.passwordCaptchaTested, false); assert.equal(body.metrics.uploadedObjects, 10);
  assert.deepEqual(body.cleanup, { complete: true, storage: true, rows: true, sessions: true, remainingFixtureIds: [], errors: [] });
  assert.equal(f.entries.size, 1); assert.equal(f.entries.get(EXISTING).content, 'must remain unchanged'); assert.equal(f.media.size, 0);
  assert.deepEqual([...f.objects.keys()], ['unrelated/existing.png']); assert.equal(f.sessions.size, 0); assert.deepEqual(f.loggedOut.sort(), [0, 1, 2]);
  const text = JSON.stringify(body);
  for (const secret of [CAPABILITY, SECRET, PUBLIC, 'never-return-refresh-token', 'memory-verification:', ...IDS.map((_, index) => token(index))]) assert.ok(!text.includes(secret));
  assert.ok(f.calls.every(call => !call.path.includes('/token') && !call.path.includes('/settings')));
});

test('missing or unexpected Auth users stop before generateLink can create any account', async () => {
  for (const users of [IDS.slice(1).map((_, index) => user(index + 1)), [...IDS.map((_, index) => user(index)), { ...user(0), id: EXISTING, email: 'outsider@memory.invalid' }]]) {
    const f = setup({ users }), body = await (await f.handler(request())).json(); assert.equal(body.ok, false); assert.equal(body.error, 'UNEXPECTED_AUTH_STATE');
    assert.ok(!f.calls.some(call => call.path.endsWith('/generate_link'))); assert.equal(f.entries.size, 1);
  }
});

test('profile UUID mismatch signs out all issued sessions before any fixture write', async () => {
  const f = setup({ profileMismatch: true }), result = await f.handler(request()), body = await result.json();
  assert.equal(body.error, 'PROFILE_IDENTITY_MISMATCH'); assert.equal(body.cleanup.complete, true);
  assert.equal(f.entries.size, 1); assert.equal(f.sessions.size, 0); assert.equal(f.loggedOut.length, 3);
});

test('a private renamed admin profile preserves the complete Auth UUID and RLS verification chain', async () => {
  const f = setup({ profileOverrides: { 2: { username: 'private-admin-fixture' } } });
  const result = await f.handler(request()), body = await result.json();
  assert.equal(result.status, 200); assert.equal(body.ok, true);
  assert.ok(Object.values(body.metrics.checks).every(Boolean)); assert.equal(body.cleanup.complete, true);
  assert.equal(f.entries.size, 1); assert.equal(f.sessions.size, 0);
  assert.ok(!JSON.stringify(body).includes('private-admin-fixture'));
});

test('renamed admin validation still rejects invalid profiles and changes to fixed member usernames', async () => {
  for (const profileOverrides of [
    { 2: { username: 'xbl' } }, { 2: { username: 'll' } }, { 2: { username: '' } },
    { 2: { username: 'invalid admin' } }, { 2: { username: 'a'.repeat(41) } },
    { 2: { username: 'private-admin-fixture', id: EXISTING } },
    { 2: { username: 'private-admin-fixture', role: 'member' } },
    { 2: { username: 'private-admin-fixture', slot: 2 } },
    { 0: { username: 'renamed-member' } }, { 1: { username: 'renamed-member' } },
  ]) {
    const f = setup({ profileOverrides }), result = await f.handler(request()), body = await result.json();
    assert.equal(body.error, 'PROFILE_IDENTITY_MISMATCH'); assert.equal(body.cleanup.complete, true);
    assert.equal(f.entries.size, 1); assert.equal(f.sessions.size, 0); assert.equal(f.loggedOut.length, 3);
    assert.ok(!f.calls.some(call => call.path === '/rest/v1/entries' && call.method === 'POST'));
  }
});

test('failed binary upload still cleans pending reservations and any uploaded object through scoped admin cleanup', async () => {
  let uploads = 0;
  const f = setup({ hook(call) { if (!call.privileged && call.path.startsWith('/storage/v1/object/') && call.method === 'POST' && ++uploads === 2) return response({ error: SECRET }, 500); } });
  const result = await f.handler(request()), body = await result.json();
  assert.equal(body.error, 'UPLOAD_FAILED'); assert.equal(body.cleanup.complete, true); assert.equal(f.entries.size, 1); assert.equal(f.media.size, 0); assert.equal(f.objects.size, 1); assert.equal(f.sessions.size, 0);
  assert.ok(!JSON.stringify(body).includes(SECRET));
});

test('lost INSERT response recovers cleanup by exact run marker, author and generated UUID', async () => {
  let lost = false;
  const f = setup({ after(call) { if (call.path === '/rest/v1/entries' && call.method === 'POST' && !lost) { lost = true; throw new Error(SECRET); } } });
  const body = await (await f.handler(request())).json(); assert.equal(body.ok, false); assert.equal(body.cleanup.complete, true); assert.equal(f.entries.size, 1); assert.equal(f.sessions.size, 0);
});

test('cleanup failure preserves fixture metadata and IDs rather than claiming success or dropping object registration', async () => {
  const f = setup({ cleanupFails: true }), body = await (await f.handler(request())).json();
  assert.equal(body.ok, false); assert.equal(body.error, 'CLEANUP_INCOMPLETE'); assert.equal(body.cleanup.complete, false); assert.equal(body.cleanup.storage, false);
  assert.equal(body.cleanup.remainingFixtureIds.length, 1); assert.ok(f.entries.has(body.cleanup.remainingFixtureIds[0])); assert.equal(f.media.size, 10); assert.equal(f.sessions.size, 0);
  assert.equal(f.entries.get(EXISTING).content, 'must remain unchanged');
});

test('an anonymous server error never counts as an authorization denial', async () => {
  const f = setup({ hook(call) { if (call.path === '/rest/v1/entries' && call.method === 'GET' && !call.privileged && !call.headers.has('authorization')) return response({ error: SECRET }, 500); } });
  const body = await (await f.handler(request())).json(); assert.equal(body.error, 'ANONYMOUS_RECORD_ALLOWED'); assert.equal(body.metrics.checks.anonymousDenied, false); assert.equal(body.cleanup.complete, true);
});

test('a wrong generated identity stops before verifying its one-time token and never returns native secrets', async () => {
  const f = setup({ hook(call) { if (call.path.endsWith('/generate_link')) return response({ ...user(0), id: EXISTING, hashed_token: 'do-not-verify-this-secret-hash', secret: SECRET }); } });
  const result = await f.handler(request()), body = await result.json(); assert.equal(body.error, 'UNEXPECTED_AUTH_STATE');
  assert.ok(!f.calls.some(call => call.path === '/auth/v1/verify')); assert.equal(f.entries.size, 1); assert.ok(!JSON.stringify(body).includes(SECRET));
});

test('a closed user RLS guard cannot prevent independently authorized fixture cleanup', async () => {
  let closed = false;
  const f = setup({
    after(call) { if (call.path.endsWith('/finalize_media')) closed = true; },
    hook(call) { if (closed && !call.privileged && /^\/(rest|storage)\//.test(call.path)) return response({ code: '42501' }, 403); },
  });
  const body = await (await f.handler(request())).json(); assert.equal(body.ok, false); assert.equal(body.cleanup.complete, true);
  assert.equal(f.entries.size, 1); assert.equal(f.media.size, 0); assert.equal(f.objects.size, 1); assert.equal(f.sessions.size, 0);
});

test('ambiguous info errors or a missing bucket never count as confirmed object deletion', async () => {
  for (const value of [{ code: 'NoSuchBucket', statusCode: '404' }, { code: 'InvalidJWT', statusCode: '404' }, { statusCode: '400', error: 'unknown' }]) {
    const f = setup({ hook(call) { if (call.privileged && call.path.startsWith('/storage/v1/object/info/')) return response(value, 400); } });
    const body = await (await f.handler(request())).json(); assert.equal(body.cleanup.complete, false); assert.equal(body.cleanup.remainingFixtureIds.length, 1);
    assert.equal(f.media.size, 10, 'keep registrations when absence is uncertain'); assert.equal(f.sessions.size, 0);
  }
});

test('a forged reservation path cannot redirect uploads or administrator cleanup to another object', async () => {
  const f = setup({ after(call, result) {
    if (call.path.endsWith('/reserve_media')) return result.json().then(value => response({ ...value, storagePath: 'unrelated/existing.png' }));
  } });
  const body = await (await f.handler(request())).json(); assert.equal(body.error, 'INVALID_RESERVATION'); assert.equal(body.cleanup.complete, true);
  assert.equal(f.objects.size, 1); assert.ok(f.objects.has('unrelated/existing.png'));
  assert.ok(!f.calls.some(call => call.privileged && call.path.startsWith('/storage/')));
});

test('a generated UUID collision never authorizes cleanup of the existing record or its children', async () => {
  let count = 0;
  const f = setup({ randomUUID: () => ++count === 1 ? '10000000-0000-4000-8000-000000000099' : EXISTING });
  const body = await (await f.handler(request())).json(); assert.equal(body.error, 'FIXTURE_CREATE_FAILED'); assert.equal(body.cleanup.complete, true);
  assert.equal(f.entries.size, 1); assert.equal(f.entries.get(EXISTING).content, 'must remain unchanged');
  assert.ok(!f.calls.some(call => call.privileged && call.method === 'DELETE'));
});
