import { timingSafeEqual } from 'node:crypto';

export const PROJECT_ORIGIN = 'https://ijtrfjehqtoptsmsotin.supabase.co';
export const BUCKET_ID = 'login-photos';
export const IDENTITIES = Object.freeze([
  { username: 'xbl', email: 'xbl@memory.invalid', slot: 1, role: 'member' },
  { username: 'll', email: 'll@memory.invalid', slot: 2, role: 'member' },
  { username: 'memory-admin', email: 'memory-admin@memory.invalid', slot: 3, role: 'admin' },
]);
export const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), value => value.charCodeAt(0));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MIME = ['image/jpeg', 'image/png', 'image/webp'];
const CHECKS = ['emptyGalleryPreflight', 'bucketConfiguration', 'identitiesAndProfiles', 'anonymousWritesDenied', 'pendingAnonymousDenied', 'readyUnselectedAnonymousDenied', 'partnerStagingDenied', 'anonymousSelectedManifest', 'anonymousSelectedBytes', 'secondMemberEdit', 'memberReorder', 'adminEdit', 'selectedDeleteDenied', 'upsertDenied', 'staleRevisionDenied', 'eightPhotoLimit', 'formatAndSizeLimits', 'replacement', 'retiredFreshReadDenied', 'retiredReuseDenied', 'privateMemoryMediaAnonymousDenied'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
class SafeError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new SafeError(status, code); };
const check = (value, code) => { if (!value) fail(409, code); };
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
function fixedOrigin(value) {
  let url; try { url = new URL(value); } catch { fail(503, 'PROJECT_MISMATCH'); }
  if (url.origin !== PROJECT_ORIGIN || !['', '/'].includes(url.pathname) || url.search || url.hash || url.username || url.password) fail(503, 'PROJECT_MISMATCH');
  return url.origin;
}
async function bytesLimited(message, maximum, timeoutMs = 8000) {
  const declared = message.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) fail(413, 'BODY_TOO_LARGE');
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader(), chunks = []; let total = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(new SafeError(408, 'BODY_TIMEOUT')); reader.cancel().catch(() => {}); }, timeoutMs); });
  try { for (;;) { const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break; total += value.byteLength; if (total > maximum) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); } chunks.push(value); } }
  finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
async function readJson(message, maximum, timeoutMs) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytesLimited(message, maximum, timeoutMs))); } catch (error) { if (error instanceof SafeError) throw error; fail(503, 'INVALID_JSON'); } }
function credential(env) {
  const dictionary = env('SUPABASE_SECRET_KEYS');
  if (dictionary) { let value; try { value = JSON.parse(dictionary)?.default; } catch { fail(503, 'SERVER_CREDENTIAL_UNAVAILABLE'); } if (!/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(value ?? '')) fail(503, 'SERVER_CREDENTIAL_UNAVAILABLE'); return { apikey: value }; }
  const value = env('SUPABASE_SERVICE_ROLE_KEY'); if (!JWT.test(value ?? '')) fail(503, 'SERVER_CREDENTIAL_UNAVAILABLE'); return { apikey: value, Authorization: `Bearer ${value}` };
}
function validUser(user, identity, expectedId, time) {
  return object(user) && UUID.test(user.id ?? '') && (!expectedId || user.id === expectedId) && user.email === identity.email && user.role === 'authenticated' && user.aud === 'authenticated' && user.is_anonymous === false && Number.isFinite(Date.parse(user.email_confirmed_at)) && !user.deleted_at && (!user.banned_until || Date.parse(user.banned_until) <= time);
}
function manifest(raw) {
  check(object(raw) && Number.isSafeInteger(raw.revision) && raw.revision >= 0 && Array.isArray(raw.photos) && raw.photos.length <= 8, 'INVALID_MANIFEST');
  for (const value of raw.photos) check(object(value) && Object.keys(value).sort().join(',') === 'id,mimeType,path,size' && UUID.test(value.id ?? '') && value.path === `slides/${value.id}` && MIME.includes(value.mimeType) && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 5_000_000, 'INVALID_MANIFEST');
  check(new Set(raw.photos.map(value => value.id)).size === raw.photos.length, 'INVALID_MANIFEST'); return raw;
}
function validBucket(raw) { return object(raw) && raw.id === BUCKET_ID && raw.name === BUCKET_ID && raw.public === false && Number(raw.file_size_limit) === 5_000_000 && Array.isArray(raw.allowed_mime_types) && raw.allowed_mime_types.length === MIME.length && new Set(raw.allowed_mime_types).size === MIME.length && MIME.every(type => raw.allowed_mime_types.includes(type)) && (raw.type === undefined || raw.type === 'STANDARD'); }
const query = (table, params) => `/rest/v1/${table}?${new URLSearchParams(params)}`;
const storage = (bucket, path) => `/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
const absent = response => !response.ok && (response.data?.code === 'NoSuchKey' || response.status === 404 || response.status === 400 && String(response.data?.statusCode) === '404' && response.data?.error === 'not_found');

// Inert without a short operator lease. This is a one-run administrator probe,
// never a product endpoint or a substitute for password/Turnstile testing.
export function createLoginPhotosVerificationHandler(policy, dependencies = {}) {
  const fixed = Object.freeze({ ...policy }), env = dependencies.env ?? (key => globalThis.Deno?.env.get(key)), fetcher = dependencies.fetch ?? globalThis.fetch, now = dependencies.now ?? Date.now, uuid = dependencies.randomUUID ?? (() => crypto.randomUUID()), subtle = dependencies.subtle ?? crypto.subtle;
  let started = false;
  const lease = () => { const time = now(); if (fixed.enabled !== true || fixed.prerequisitesVerified !== true || !HEX.test(fixed.capabilitySha256 ?? '') || /^0+$/.test(fixed.capabilitySha256) || !Number.isSafeInteger(fixed.issuedAt) || !Number.isSafeInteger(fixed.expiresAt) || fixed.issuedAt <= 0 || fixed.expiresAt - fixed.issuedAt <= 0 || fixed.expiresAt - fixed.issuedAt > 600_000 || time < fixed.issuedAt || time >= fixed.expiresAt) fail(410, 'VERIFICATION_CLOSED'); };
  return async request => {
    const sessions = new Map(), photos = [], metrics = { authMethod: 'admin-generated-magiclink', passwordCaptchaTested: false, checks: Object.fromEntries(CHECKS.map(key => [key, false])), requests: 0, uploadedObjects: 0, bucketCreated: false, uncertainReservation: false, unknownSessionPossible: false };
    const cleanup = { complete: false, gallery: true, storage: true, rows: true, sessions: true, remainingPhotoIds: [], privateFixtureId: null, errors: [] };
    let authorized = false, origin, publicKey, serverHeaders, workDeadline, cleanupDeadline, runId, marker, privateFixture, revision, failure;
    async function api(path, { mode = 'user', username = 'xbl', method = 'GET', body, binary = false, extra = {}, cleaning = false } = {}) {
      lease();
      check(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'), 'INVALID_UPSTREAM_PATH');
      const target = new URL(path, origin); check(target.origin === PROJECT_ORIGIN && !target.hash && !target.username && !target.password, 'INVALID_UPSTREAM_PATH');
      const deadline = cleaning ? cleanupDeadline : workDeadline; if (!Number.isFinite(deadline) || now() >= deadline || !cleaning && request.signal.aborted) fail(408, 'VERIFICATION_TIMEOUT');
      let headers;
      if (mode === 'admin') {
        const authRead = method === 'GET' && target.pathname === '/auth/v1/admin/users';
        const magic = method === 'POST' && target.pathname === '/auth/v1/admin/generate_link' && body?.type === 'magiclink' && IDENTITIES.some(item => item.email === body.email);
        const bucketRead = method === 'GET' && ['/storage/v1/bucket/login-photos', '/storage/v1/bucket/memory-media'].includes(target.pathname);
        const bucketCreate = method === 'POST' && target.pathname === '/storage/v1/bucket' && validBucket(body);
        check(authRead || magic || bucketRead || bucketCreate, 'INVALID_PRIVILEGED_OPERATION'); headers = { ...serverHeaders };
      } else if (mode === 'private-cleanup') {
        check(cleaning && privateFixture?.scoped === true, 'INVALID_CLEANUP_SCOPE');
        if (target.pathname.startsWith('/rest/v1/')) {
          const table = target.pathname.slice('/rest/v1/'.length);
          check(['entries', 'media'].includes(table) && ['GET', 'DELETE'].includes(method) && target.searchParams.get(table === 'entries' ? 'id' : 'entryId') === `eq.${privateFixture.id}`, 'INVALID_CLEANUP_SCOPE');
          if (table === 'entries') check(target.searchParams.get('content') === `eq.${marker}` && target.searchParams.get('authorId') === `eq.${privateFixture.authorId}`, 'INVALID_CLEANUP_SCOPE');
        } else {
          const info = `/storage/v1/object/info/memory-media/`;
          const removing = method === 'DELETE' && target.pathname === '/storage/v1/object/memory-media' && object(body) && Object.keys(body).length === 1 && Array.isArray(body.prefixes) && body.prefixes.length > 0 && body.prefixes.every(value => privateFixture.paths.has(value));
          const inspecting = method === 'GET' && target.pathname.startsWith(info) && privateFixture.paths.has(decodeURIComponent(target.pathname.slice(info.length)));
          check(!target.search && (removing || inspecting), 'INVALID_CLEANUP_SCOPE');
        }
        headers = { ...serverHeaders };
      } else {
        headers = { apikey: publicKey };
        if (mode === 'user') { check(sessions.has(username), 'USER_SESSION_UNAVAILABLE'); headers.Authorization = `Bearer ${sessions.get(username).token}`; }
        else check(mode === 'public', 'INVALID_CREDENTIAL_MODE');
      }
      for (const key of Object.keys(extra)) check(!['authorization', 'apikey', 'cookie'].includes(key.toLowerCase()), 'CREDENTIAL_OVERRIDE_REJECTED');
      headers = { ...headers, ...extra, Accept: binary && method === 'GET' ? 'image/png' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': binary ? 'image/png' : 'application/json' }) };
      metrics.requests++;
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - now(), fixed.expiresAt - now())));
      const response = await fetcher(target.href, { method, redirect: 'error', headers, cache: 'no-store', signal: cleaning ? timeout : AbortSignal.any([timeout, request.signal]), ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }) });
      if (binary && method === 'GET') {
        if (!response.ok) { await response.body?.cancel(); return { status: response.status, ok: false, data: null, headers: response.headers }; }
        return { status: response.status, ok: true, data: await bytesLimited(response, 1024, Math.max(1, deadline - now())), headers: response.headers };
      }
      return { status: response.status, ok: response.ok, data: response.status === 204 ? null : await readJson(response, 65_536, Math.max(1, deadline - now())), headers: response.headers };
    }
    async function data(path, options, code) { const response = await api(path, options); check(response.ok, code); return response.data; }
    async function current(cleaning = false) { return manifest(await data('/rest/v1/rpc/get_login_photos', { mode: 'public', method: 'POST', body: {}, cleaning }, 'MANIFEST_READ_FAILED')); }
    async function publish(ids, username = 'xbl', cleaning = false) {
      check(ids.every(id => photos.some(photo => photo.id === id)) && new Set(ids).size === ids.length, 'INVALID_FIXTURE_SCOPE');
      const raw = manifest(await data('/rest/v1/rpc/publish_login_photos', { username, cleaning, method: 'POST', body: { p_photo_ids: ids, p_expected_revision: revision } }, 'PHOTO_PUBLISH_FAILED'));
      check(raw.revision === revision + 1 && raw.photos.map(photo => photo.id).join(',') === ids.join(','), 'PHOTO_PUBLISH_FAILED'); revision = raw.revision; return raw;
    }
    async function reserve(username) {
      metrics.uncertainReservation = true;
      const response = await api('/rest/v1/rpc/reserve_login_photo', { username, method: 'POST', body: { p_mime_type: 'image/png', p_size: PNG_BYTES.length } });
      // A gateway failure can arrive after the database committed. Without a
      // validated returned ID, do not claim we can account for that reservation.
      if (!response.ok) fail(409, 'PHOTO_RESERVE_FAILED');
      const raw = response.data;
      check(object(raw) && UUID.test(raw.id ?? '') && raw.path === `slides/${raw.id}` && raw.mimeType === 'image/png' && raw.size === PNG_BYTES.length && !photos.some(photo => photo.id === raw.id), 'PHOTO_RESERVE_FAILED');
      const photo = { ...raw, username }; photos.push(photo); metrics.uncertainReservation = false; return photo;
    }
    async function finalize(photo) {
      const ready = await data('/rest/v1/rpc/finalize_login_photo', { username: photo.username, method: 'POST', body: { p_photo_id: photo.id } }, 'PHOTO_FINALIZE_FAILED');
      check(ready?.id === photo.id && ready.path === photo.path && ready.mimeType === 'image/png' && ready.size === PNG_BYTES.length, 'PHOTO_FINALIZE_FAILED');
    }
    async function upload(photo, { complete = true } = {}) {
      const response = await api(storage(BUCKET_ID, photo.path), { username: photo.username, method: 'POST', binary: true, body: PNG_BYTES, extra: { 'x-upsert': 'false', 'cache-control': '0' } }); check(response.ok, 'PHOTO_UPLOAD_FAILED'); metrics.uploadedObjects++;
      if (complete) await finalize(photo);
    }
    async function download(bucket, path, { username, mode = 'public', cleaning = false, publicRoute = false } = {}) {
      const route = publicRoute ? `/storage/v1/object/public/${bucket}/${path}` : storage(bucket, path);
      return api(`${route}?cacheNonce=${encodeURIComponent(uuid())}`, { mode, username, cleaning, binary: true, extra: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } });
    }
    async function denyDownload(photo, username) { const raw = await download(BUCKET_ID, photo.path, { mode: username ? 'user' : 'public', username }); check(!raw.ok && [400, 401, 403, 404].includes(raw.status), 'UNSELECTED_PHOTO_READ_ALLOWED'); }
    async function png(photo) { const raw = await download(BUCKET_ID, photo.path); check(raw.ok && raw.headers.get('content-type')?.split(';')[0] === 'image/png' && raw.data.length === PNG_BYTES.length && raw.data.every((value, index) => value === PNG_BYTES[index]), 'ANONYMOUS_SELECTED_DOWNLOAD_FAILED'); }
    async function denyRpc(name, body, { username, mode = username ? 'user' : 'public', code, status } = {}) { const raw = await api(`/rest/v1/rpc/${name}`, { mode, username, method: 'POST', body }); check(!raw.ok && (code ? raw.data?.code === code : [401, 403].includes(raw.status)) && (status === undefined || raw.status === status), 'RPC_DENIAL_FAILED'); }
    async function cleanupAll() {
      if (photos.length) {
        let selection;
        try {
          selection = await current(true);
          if (selection.photos.some(photo => !photos.some(owned => owned.id === photo.id))) { cleanup.gallery = false; cleanup.errors.push('FOREIGN_SELECTION_PRESERVED'); }
          else if (selection.photos.length) { revision = selection.revision; await publish([], 'memory-admin', true); selection = await current(true); check(!selection.photos.length, 'GALLERY_CLEANUP_UNCONFIRMED'); }
        } catch { cleanup.gallery = false; cleanup.errors.push('GALLERY_CLEANUP_UNCONFIRMED'); }
        for (const photo of photos) {
          try {
            // Use the actual owner JWT, never the server key. If another request
            // selects a fixture after our read, the normal DELETE/RPC guards win.
            const removed = await api(`/storage/v1/object/${BUCKET_ID}`, { username: photo.username, method: 'DELETE', body: { prefixes: [photo.path] }, cleaning: true }); check(removed.ok, 'PHOTO_STORAGE_CLEANUP_FAILED');
            await data('/rest/v1/rpc/discard_login_photo', { username: photo.username, method: 'POST', body: { p_photo_id: photo.id }, cleaning: true }, 'PHOTO_ROW_CLEANUP_FAILED');
            const pending = await data('/rest/v1/rpc/get_login_photo_cleanup', { username: photo.username, method: 'POST', body: {}, cleaning: true }, 'PHOTO_ROW_CLEANUP_FAILED'); check(Array.isArray(pending) && !pending.some(row => row.id === photo.id), 'PHOTO_ROW_CLEANUP_FAILED');
          } catch { cleanup.storage = false; cleanup.rows = false; cleanup.remainingPhotoIds.push(photo.id); }
        }
      }
      if (metrics.uncertainReservation) { cleanup.rows = false; cleanup.errors.push('UNKNOWN_RESERVATION_POSSIBLE'); }
      if (privateFixture) {
        try {
          // Register the exact client-generated entry ID and run marker before
          // the INSERT; re-read them even if that response was lost.
          privateFixture.scoped = true;
          const scope = query('entries', { id: `eq.${privateFixture.id}`, authorId: `eq.${privateFixture.authorId}`, content: `eq.${marker}`, select: 'id,authorId,content' });
          const found = await data(scope, { mode: 'private-cleanup', cleaning: true }, 'PRIVATE_SCOPE_READ_FAILED'); check(Array.isArray(found) && found.length <= 1, 'PRIVATE_SCOPE_READ_FAILED');
          if (found.length) {
            check(found[0].id === privateFixture.id && found[0].authorId === privateFixture.authorId && found[0].content === marker, 'PRIVATE_SCOPE_MISMATCH');
            const rows = await data(query('media', { entryId: `eq.${privateFixture.id}`, select: 'id,entryId,authorId,uploadedBy,storagePath' }), { mode: 'private-cleanup', cleaning: true }, 'PRIVATE_SCOPE_READ_FAILED');
            check(Array.isArray(rows) && rows.length <= 10, 'PRIVATE_SCOPE_READ_FAILED');
            for (const row of rows) { check(UUID.test(row.id ?? '') && row.entryId === privateFixture.id && row.authorId === privateFixture.authorId && row.uploadedBy === privateFixture.authorId && row.storagePath === `${privateFixture.authorId}/${privateFixture.id}/${row.id}`, 'PRIVATE_SCOPE_MISMATCH'); privateFixture.paths.add(row.storagePath); }
            for (const path of privateFixture.paths) {
              await api('/storage/v1/object/memory-media', { mode: 'private-cleanup', method: 'DELETE', body: { prefixes: [path] }, cleaning: true });
              const info = await api(`/storage/v1/object/info/memory-media/${path}`, { mode: 'private-cleanup', cleaning: true }); check(absent(info), 'PRIVATE_STORAGE_CLEANUP_UNCONFIRMED');
            }
            await data(query('media', { entryId: `eq.${privateFixture.id}` }), { mode: 'private-cleanup', method: 'DELETE', cleaning: true }, 'PRIVATE_ROW_CLEANUP_FAILED');
            await data(scope, { mode: 'private-cleanup', method: 'DELETE', cleaning: true }, 'PRIVATE_ROW_CLEANUP_FAILED');
            const remaining = await data(scope, { mode: 'private-cleanup', cleaning: true }, 'PRIVATE_ROW_CLEANUP_FAILED'); check(Array.isArray(remaining) && !remaining.length, 'PRIVATE_ROW_CLEANUP_FAILED');
          } else check(privateFixture.paths.size === 0, 'PRIVATE_SCOPE_READ_FAILED');
        } catch { cleanup.storage = false; cleanup.rows = false; cleanup.privateFixtureId = privateFixture.id; cleanup.errors.push('PRIVATE_FIXTURE_CLEANUP_INCOMPLETE'); }
      }
      for (const [username] of sessions) { try { const raw = await api('/auth/v1/logout?scope=local', { username, method: 'POST', cleaning: true }); check(raw.ok, 'SESSION_REVOCATION_UNCONFIRMED'); } catch { cleanup.sessions = false; } }
      if (metrics.unknownSessionPossible) { cleanup.sessions = false; cleanup.errors.push('UNKNOWN_SESSION_POSSIBLE'); }
      sessions.clear();
      cleanup.complete = cleanup.gallery && cleanup.storage && cleanup.rows && cleanup.sessions;
    }
    try {
      lease(); const incoming = new URL(request.url);
      if (request.method !== 'POST') fail(405, 'POST_REQUIRED');
      if (incoming.search || incoming.hash || request.headers.has('origin') || request.headers.has('cookie')) fail(403, 'TRUSTED_CLIENT_REQUIRED');
      const auth = request.headers.get('authorization') ?? '', capability = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!HEX.test(capability)) fail(401, 'NOT_AUTHORIZED');
      const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(capability))), expected = Uint8Array.from(fixed.capabilitySha256.match(/../g), part => parseInt(part, 16));
      if (!timingSafeEqual(digest, expected)) fail(401, 'NOT_AUTHORIZED');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED');
      const body = await readJson(request, 1024); if (!object(body) || Object.keys(body).length !== 1 || body.run !== true) fail(400, 'INVALID_REQUEST');
      if (started) fail(409, 'ALREADY_RUN');
      origin = fixedOrigin(fixed.projectOrigin); fixedOrigin(env('SUPABASE_URL')); publicKey = fixed.publishableKey;
      if (!/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(publicKey ?? '')) fail(503, 'PUBLIC_KEY_UNAVAILABLE');
      serverHeaders = credential(env);
      if (fixed.expiresAt - now() < 155_000) fail(410, 'INSUFFICIENT_CLEANUP_WINDOW');
      workDeadline = now() + 105_000; cleanupDeadline = now() + 150_000; authorized = true; started = true;
      const initial = await current(); check(initial.photos.length === 0, 'GALLERY_NOT_EMPTY'); revision = initial.revision; metrics.checks.emptyGalleryPreflight = true;
      const users = await api('/auth/v1/admin/users?page=1&per_page=4', { mode: 'admin' });
      check(users.ok && Array.isArray(users.data?.users) && users.data.users.length === 3 && [null, '3'].includes(users.headers.get('x-total-count')) && !/;\s*rel=["']?next["']?/i.test(users.headers.get('link') ?? ''), 'UNEXPECTED_AUTH_STATE');
      const expectedUsers = new Map(); for (const identity of IDENTITIES) { const matches = users.data.users.filter(user => validUser(user, identity, null, now())); check(matches.length === 1, 'UNEXPECTED_AUTH_STATE'); expectedUsers.set(identity.username, matches[0].id); }
      check(new Set(expectedUsers.values()).size === 3, 'UNEXPECTED_AUTH_STATE');
      const existing = await api(`/storage/v1/bucket/${BUCKET_ID}`, { mode: 'admin' });
      if (existing.ok) check(validBucket(existing.data), 'BUCKET_CONFIGURATION_MISMATCH');
      else {
        check(existing.status === 404 || existing.status === 400 && String(existing.data?.statusCode) === '404', 'BUCKET_READ_FAILED');
        const created = await api('/storage/v1/bucket', { mode: 'admin', method: 'POST', body: { id: BUCKET_ID, name: BUCKET_ID, public: false, file_size_limit: 5_000_000, allowed_mime_types: [...MIME] } });
        check(created.ok || [400, 409].includes(created.status), 'BUCKET_CREATE_FAILED');
        const verified = await data(`/storage/v1/bucket/${BUCKET_ID}`, { mode: 'admin' }, 'BUCKET_CREATE_FAILED'); check(validBucket(verified), 'BUCKET_CONFIGURATION_MISMATCH'); metrics.bucketCreated = true;
      }
      const privateBucket = await data('/storage/v1/bucket/memory-media', { mode: 'admin' }, 'PRIVATE_BUCKET_PREFLIGHT_FAILED'); check(privateBucket?.id === 'memory-media' && privateBucket.public === false, 'PRIVATE_BUCKET_CONFIGURATION_CHANGED'); metrics.checks.bucketConfiguration = true;
      for (const identity of IDENTITIES) {
        const raw = await data('/auth/v1/admin/generate_link', { mode: 'admin', method: 'POST', body: { type: 'magiclink', email: identity.email } }, 'LINK_GENERATION_FAILED');
        check(validUser(raw, identity, expectedUsers.get(identity.username), now()) && typeof raw.hashed_token === 'string' && raw.hashed_token.length >= 16 && raw.hashed_token.length <= 512, 'UNEXPECTED_AUTH_STATE');
        metrics.unknownSessionPossible = true;
        const verified = await data('/auth/v1/verify', { mode: 'public', method: 'POST', body: { type: 'email', token_hash: raw.hashed_token } }, 'SESSION_VERIFY_FAILED');
        check(JWT.test(verified?.access_token ?? '') && verified.access_token.length <= 8192, 'SESSION_VERIFY_FAILED'); sessions.set(identity.username, { token: verified.access_token });
        metrics.unknownSessionPossible = false;
        check(validUser(verified.user, identity, expectedUsers.get(identity.username), now()), 'SESSION_IDENTITY_MISMATCH');
        const nativeUser = await data('/auth/v1/user', { username: identity.username }, 'SESSION_IDENTITY_MISMATCH'); check(validUser(nativeUser, identity, expectedUsers.get(identity.username), now()), 'SESSION_IDENTITY_MISMATCH');
      }
      const profiles = await data('/rest/v1/profiles?select=id,slot,username,role&order=slot', { username: 'xbl' }, 'PROFILE_PREFLIGHT_FAILED');
      check(Array.isArray(profiles) && profiles.length === 3 && IDENTITIES.every(identity => profiles.some(value => value.id === expectedUsers.get(identity.username) && value.slot === identity.slot && value.role === identity.role && (identity.slot === 3 ? /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(value.username ?? '') && !['xbl', 'll'].includes(value.username) : value.username === identity.username))), 'PROFILE_PREFLIGHT_FAILED'); metrics.checks.identitiesAndProfiles = true;
      runId = uuid(); check(UUID.test(runId), 'INVALID_FIXTURE_ID'); marker = `login-photo-verification:${runId}`;
      const randomId = uuid();
      for (const [name, args] of [['reserve_login_photo', { p_mime_type: 'image/png', p_size: PNG_BYTES.length }], ['finalize_login_photo', { p_photo_id: randomId }], ['publish_login_photos', { p_photo_ids: [], p_expected_revision: revision }], ['get_login_photo_cleanup', {}], ['discard_login_photo', { p_photo_id: randomId }]]) await denyRpc(name, args);
      metrics.checks.anonymousWritesDenied = true;
      const a1 = await reserve('xbl'); await upload(a1, { complete: false });
      const pendingOwner = await download(BUCKET_ID, a1.path, { mode: 'user', username: 'xbl' });
      check(pendingOwner.ok && pendingOwner.data.length === PNG_BYTES.length && pendingOwner.data.every((value, index) => value === PNG_BYTES[index]), 'PENDING_OWNER_DOWNLOAD_FAILED');
      await denyDownload(a1); metrics.checks.pendingAnonymousDenied = true;
      await finalize(a1); await denyDownload(a1); metrics.checks.readyUnselectedAnonymousDenied = true;
      const b1 = await reserve('ll'); await upload(b1); await denyDownload(b1, 'xbl'); metrics.checks.partnerStagingDenied = true;
      const a2 = await reserve('xbl'); await upload(a2);
      await publish([a1.id]);
      const anon = await current(); check(anon.photos.length === 1 && anon.photos[0].id === a1.id, 'ANONYMOUS_MANIFEST_FAILED'); metrics.checks.anonymousSelectedManifest = true;
      await png(a1); metrics.checks.anonymousSelectedBytes = true;
      await publish([a1.id, b1.id], 'll'); metrics.checks.secondMemberEdit = true;
      await publish([b1.id, a1.id]); metrics.checks.memberReorder = true;
      await publish([a1.id, b1.id], 'memory-admin'); metrics.checks.adminEdit = true;
      const removed = await api(`/storage/v1/object/${BUCKET_ID}`, { username: 'xbl', method: 'DELETE', body: { prefixes: [a1.path] } });
      check(!removed.ok && [400, 401, 403].includes(removed.status) || removed.ok && Array.isArray(removed.data) && removed.data.length === 0, 'SELECTED_DELETE_ALLOWED'); await png(a1); metrics.checks.selectedDeleteDenied = true;
      const overwritten = await api(storage(BUCKET_ID, a1.path), { username: 'xbl', method: 'POST', binary: true, body: PNG_BYTES, extra: { 'x-upsert': 'true' } }); check(!overwritten.ok && [400, 401, 403, 409].includes(overwritten.status), 'UPSERT_ALLOWED'); await png(a1); metrics.checks.upsertDenied = true;
      await denyRpc('publish_login_photos', { p_photo_ids: [a1.id, b1.id], p_expected_revision: revision - 1 }, { username: 'll', code: 'PT409', status: 409 }); metrics.checks.staleRevisionDenied = true;
      const ninth = Array.from({ length: 9 }, () => uuid()); check(new Set(ninth).size === 9 && ninth.every(id => UUID.test(id)), 'INVALID_FIXTURE_ID');
      await denyRpc('publish_login_photos', { p_photo_ids: ninth, p_expected_revision: revision }, { username: 'xbl', code: '22023' }); metrics.checks.eightPhotoLimit = true;
      await denyRpc('reserve_login_photo', { p_mime_type: 'image/svg+xml', p_size: PNG_BYTES.length }, { username: 'xbl', code: '22023' });
      await denyRpc('reserve_login_photo', { p_mime_type: 'image/png', p_size: 5_000_001 }, { username: 'll', code: '22023' }); metrics.checks.formatAndSizeLimits = true;
      await publish([a2.id, b1.id]); await png(a2); await png(b1); metrics.checks.replacement = true;
      await denyDownload(a1); metrics.checks.retiredFreshReadDenied = true;
      await denyRpc('publish_login_photos', { p_photo_ids: [a1.id, b1.id], p_expected_revision: revision }, { username: 'xbl', code: '42501' }); metrics.checks.retiredReuseDenied = true;
      privateFixture = { id: uuid(), authorId: expectedUsers.get('xbl'), paths: new Set(), scoped: false }; check(UUID.test(privateFixture.id), 'INVALID_FIXTURE_ID');
      const saved = await data('/rest/v1/entries', { username: 'xbl', method: 'POST', extra: { Prefer: 'return=representation' }, body: { id: privateFixture.id, type: 'note', title: marker, content: marker, occurredAt: new Date(now()).toISOString(), mood: null, tags: [] } }, 'PRIVATE_FIXTURE_CREATE_FAILED');
      check(Array.isArray(saved) && saved.length === 1 && saved[0].id === privateFixture.id && saved[0].authorId === privateFixture.authorId && saved[0].content === marker && saved[0].status === 'draft', 'PRIVATE_FIXTURE_CREATE_FAILED');
      const privatePhoto = await data('/rest/v1/rpc/reserve_media', { username: 'xbl', method: 'POST', body: { p_entry_id: privateFixture.id, p_name: 'verification.png', p_mime_type: 'image/png', p_size: PNG_BYTES.length } }, 'PRIVATE_RESERVE_FAILED');
      check(UUID.test(privatePhoto?.id ?? '') && privatePhoto.entryId === privateFixture.id && privatePhoto.authorId === privateFixture.authorId && privatePhoto.uploadedBy === privateFixture.authorId && privatePhoto.storagePath === `${privateFixture.authorId}/${privateFixture.id}/${privatePhoto.id}`, 'PRIVATE_RESERVE_FAILED'); privateFixture.paths.add(privatePhoto.storagePath);
      const uploaded = await api(storage('memory-media', privatePhoto.storagePath), { username: 'xbl', method: 'POST', binary: true, body: PNG_BYTES, extra: { 'x-upsert': 'false' } }); check(uploaded.ok, 'PRIVATE_UPLOAD_FAILED'); metrics.uploadedObjects++;
      const owner = await download('memory-media', privatePhoto.storagePath, { mode: 'user', username: 'xbl' }); check(owner.ok && owner.data.length === PNG_BYTES.length, 'PRIVATE_OWNER_DOWNLOAD_FAILED');
      for (const publicRoute of [false, true]) { const raw = await download('memory-media', privatePhoto.storagePath, { publicRoute }); check(!raw.ok && [400, 401, 403, 404].includes(raw.status), 'PRIVATE_ANONYMOUS_DOWNLOAD_ALLOWED'); } metrics.checks.privateMemoryMediaAnonymousDenied = true;
    } catch (error) { failure = error instanceof SafeError ? error : new SafeError(503, 'UPSTREAM_REQUEST_FAILED'); }
    finally { if (authorized) { try { await cleanupAll(); } catch { cleanup.complete = false; cleanup.errors.push('CLEANUP_INTERRUPTED'); } } }
    if (!authorized) return json(failure?.status ?? 503, { error: failure?.code ?? 'VERIFICATION_FAILED' });
    const passed = !failure && Object.values(metrics.checks).every(Boolean) && cleanup.complete;
    return json(passed ? 200 : failure?.status ?? 503, { ok: passed, ...(failure ? { error: failure.code } : {}), runId, metrics, cleanup });
  };
}
