import { timingSafeEqual } from 'node:crypto';

// This temporary administrator tool is deliberately separate from browser login.
// Never log requests, native responses, tokens, magic-link hashes or fixture text.
export const PROJECT_ORIGIN = 'https://ijtrfjehqtoptsmsotin.supabase.co';
export const BUCKET_ID = 'memory-media';
export const IDENTITIES = Object.freeze([
  Object.freeze({ username: 'xbl', email: 'xbl@memory.invalid', slot: 1, role: 'member' }),
  Object.freeze({ username: 'll', email: 'll@memory.invalid', slot: 2, role: 'member' }),
  Object.freeze({ username: 'memory-admin', email: 'memory-admin@memory.invalid', slot: 3, role: 'admin' }),
]);
// Valid 1x1 grayscale/alpha PNG, including PNG chunk CRCs. No external asset fetch.
export const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), value => value.charCodeAt(0));
const DIFFERENT_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP8/x8AAwMCAHwG0LwAAAAASUVORK5CYII='), value => value.charCodeAt(0));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CHECKS = ['identitiesAndProfiles', 'draftIsolation', 'crossAuthorUpdateDenied', 'pngPipeline', 'memberDownloads', 'anonymousDenied', 'attachedDeleteDenied', 'upsertDenied', 'nineImageLimit', 'atomicReplacement', 'adminPublishedUpdate'];
class SafeError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(status, code) { throw new SafeError(status, code); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equalBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} });
function exactOrigin(value) {
  let url; try { url = new URL(value); } catch { fail(503, 'PROJECT_MISMATCH'); }
  if (url.origin !== PROJECT_ORIGIN || !['', '/'].includes(url.pathname) || url.search || url.hash || url.username || url.password) fail(503, 'PROJECT_MISMATCH');
  return url.origin;
}
async function bytesLimited(message, maximum, timeoutMs = 8000) {
  const length = message.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) fail(413, 'BODY_TOO_LARGE');
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader(), chunks = []; let total = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(new SafeError(408, 'BODY_TIMEOUT')); reader.cancel().catch(() => {}); }, timeoutMs); });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function readJson(message, maximum, timeoutMs) {
  const bytes = await bytesLimited(message, maximum, timeoutMs);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(503, 'INVALID_JSON'); }
}
async function matches(capability, digest, subtle) {
  if (!HEX.test(capability) || !HEX.test(digest)) return false;
  const actual = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(capability)));
  return timingSafeEqual(actual, Uint8Array.from(digest.match(/../g), part => Number.parseInt(part, 16)));
}
function serverCredential(env) {
  const dictionary = env('SUPABASE_SECRET_KEYS');
  if (dictionary) {
    let value; try { value = JSON.parse(dictionary)?.default; } catch { fail(503, 'SERVER_CREDENTIAL_UNAVAILABLE'); }
    if (typeof value !== 'string' || !/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(value)) fail(503, 'SERVER_CREDENTIAL_UNAVAILABLE');
    return { apikey: value }; // A new secret key is not a JWT.
  }
  const value = env('SUPABASE_SERVICE_ROLE_KEY');
  if (typeof value !== 'string' || !JWT.test(value)) fail(503, 'SERVER_CREDENTIAL_UNAVAILABLE');
  return { apikey: value, Authorization: `Bearer ${value}` };
}
function check(condition, code) { if (!condition) fail(409, code); }
function validUser(user, identity, expectedId, current) {
  return object(user) && UUID.test(user.id ?? '') && (!expectedId || user.id === expectedId)
    && user.email === identity.email && user.role === 'authenticated' && user.aud === 'authenticated'
    && user.is_anonymous === false && typeof user.email_confirmed_at === 'string' && Number.isFinite(Date.parse(user.email_confirmed_at))
    && !user.deleted_at && (!user.banned_until || (Number.isFinite(Date.parse(user.banned_until)) && Date.parse(user.banned_until) <= current));
}
function one(value, code) { check(Array.isArray(value) && value.length === 1, code); return value[0]; }
function query(table, pairs) {
  const url = new URL(`/rest/v1/${table}`, PROJECT_ORIGIN);
  for (const [key, value] of Object.entries(pairs)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}
function mediaPath(value, entry, author) {
  check(UUID.test(value?.id ?? '') && value.entryId === entry && value.authorId === author && value.uploadedBy === author
    && value.storagePath === `${author}/${entry}/${value.id}` && value.mimeType === 'image/png' && value.size === PNG_BYTES.length
    && value.type === 'image' && value.status === 'pending' && value.attached === false, 'INVALID_RESERVATION');
  return value.storagePath;
}
const storagePath = path => `/storage/v1/object/${BUCKET_ID}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Inert unless an operator supplies a short lease and verified prerequisites. */
export function createVerificationHandler(policy, dependencies = {}) {
  const fixed = Object.freeze({ ...policy });
  const env = dependencies.env ?? (key => globalThis.Deno?.env.get(key));
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const subtle = dependencies.subtle ?? globalThis.crypto.subtle;
  function lease() {
    const time = now();
    if (fixed.enabled !== true || fixed.prerequisitesVerified !== true || !HEX.test(fixed.capabilitySha256 ?? '') || /^0+$/.test(fixed.capabilitySha256)
      || !Number.isSafeInteger(fixed.issuedAt) || !Number.isSafeInteger(fixed.expiresAt) || fixed.issuedAt <= 0
      || fixed.expiresAt - fixed.issuedAt <= 0 || fixed.expiresAt - fixed.issuedAt > 600_000 || time < fixed.issuedAt || time >= fixed.expiresAt) fail(410, 'VERIFICATION_CLOSED');
  }
  return async function verification(request) {
    let authorized = false;
    const sessions = new Map(), fixtures = [], objects = new Map(), cleanupEligible = new Set();
    const metrics = { authMethod: 'admin-generated-magiclink', passwordCaptchaTested: false, checks: Object.fromEntries(CHECKS.map(key => [key, false])), requests: 0, uploadedObjects: 0 };
    const cleanup = { complete: false, storage: false, rows: false, sessions: false, remainingFixtureIds: [], errors: [] };
    let origin, privileged, marker, runId, workDeadline, cleanupDeadline, publicKey, failure;
    let httpStatus = 200;
    // An explicit mode creates independent headers: test traffic can never
    // accidentally inherit an administrator credential from a reused client.
    async function api(path, { mode = 'user', username, method = 'GET', body, binary = false, extra = {}, cleaning = false } = {}) {
      lease();
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) fail(503, 'INVALID_UPSTREAM_PATH');
      const target = new URL(path, origin);
      if (target.origin !== PROJECT_ORIGIN || target.hash || target.username || target.password) fail(503, 'INVALID_UPSTREAM_PATH');
      const deadline = cleaning ? cleanupDeadline : workDeadline;
      if (!Number.isFinite(deadline) || now() >= deadline || (!cleaning && request.signal.aborted)) fail(408, 'VERIFICATION_TIMEOUT');
      let headers;
      if (mode === 'admin-auth' || mode === 'cleanup' || mode === 'cleanup-storage') {
        if (mode === 'admin-auth' && !['/auth/v1/admin/users', '/auth/v1/admin/generate_link'].includes(target.pathname)) fail(503, 'INVALID_PRIVILEGED_OPERATION');
        if (mode === 'cleanup') {
          if (!cleaning || !['GET', 'DELETE'].includes(method) || !['/rest/v1/entries', '/rest/v1/media', '/rest/v1/comments', '/rest/v1/reactions', '/rest/v1/favorites'].includes(target.pathname)) fail(503, 'INVALID_PRIVILEGED_OPERATION');
          const filter = target.searchParams.get(target.pathname === '/rest/v1/entries' ? 'id' : 'entryId') || '';
          const ids = filter.startsWith('eq.') ? [filter.slice(3)] : /^in\.\(.+\)$/.test(filter) ? filter.slice(4, -1).split(',') : [];
          if (!ids.length || ids.some(value => !fixtures.some(item => item.id === value)) || (method === 'DELETE' && ids.some(value => !cleanupEligible.has(value)))) fail(503, 'INVALID_CLEANUP_SCOPE');
        }
        if (mode === 'cleanup-storage') {
          const infoPrefix = `/storage/v1/object/info/${BUCKET_ID}/`;
          const safePath = path => objects.has(path) && cleanupEligible.has(objects.get(path).id);
          const removing = method === 'DELETE' && target.pathname === `/storage/v1/object/${BUCKET_ID}` && object(body)
            && Object.keys(body).length === 1 && Array.isArray(body.prefixes) && body.prefixes.length > 0 && body.prefixes.length <= 10
            && new Set(body.prefixes).size === body.prefixes.length && body.prefixes.every(safePath);
          const inspecting = method === 'GET' && target.pathname.startsWith(infoPrefix) && safePath(decodeURIComponent(target.pathname.slice(infoPrefix.length)));
          if (!cleaning || target.search || (!removing && !inspecting)) fail(503, 'INVALID_CLEANUP_SCOPE');
        }
        headers = { ...privileged };
      } else {
        headers = { apikey: publicKey };
        if (mode === 'user') {
          const session = sessions.get(username); if (!session) fail(503, 'USER_SESSION_UNAVAILABLE');
          headers.Authorization = `Bearer ${session.token}`;
        } else if (mode !== 'public') fail(503, 'INVALID_CREDENTIAL_MODE');
      }
      for (const key of Object.keys(extra)) if (['authorization', 'apikey', 'cookie'].includes(key.toLowerCase())) fail(503, 'CREDENTIAL_OVERRIDE_REJECTED');
      headers = { ...headers, ...extra, Accept: binary && method === 'GET' ? 'image/png' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': binary ? 'image/png' : 'application/json' }) };
      const signal = AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - now(), fixed.expiresAt - now())));
      metrics.requests++;
      const response = await fetcher(target.href, {
        method, redirect: 'error', headers,
        ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
        signal: cleaning ? signal : AbortSignal.any([request.signal, signal]), cache: 'no-store',
      });
      const remaining = Math.max(1, Math.min(8000, deadline - now()));
      if (binary && method === 'GET') {
        if (!response.ok) { await response.body?.cancel(); return { status: response.status, ok: false, data: null, headers: response.headers }; }
        return { status: response.status, ok: true, data: await bytesLimited(response, 1024, remaining), headers: response.headers };
      }
      if (response.status === 204) return { status: response.status, ok: response.ok, data: null, headers: response.headers };
      const data = await readJson(response, 65_536, remaining);
      return { status: response.status, ok: response.ok, data, headers: response.headers };
    }
    async function data(path, options, code) {
      const response = await api(path, options); check(response.ok, code); return response.data;
    }
    const fixtureQuery = fixture => query('entries', { id: `eq.${fixture.id}`, select: 'id,authorId,content,title,status,updatedAt' });
    async function entry(fixture, username, cleaning = false) {
      return one(await data(fixtureQuery(fixture), { username, cleaning }, 'FIXTURE_READ_FAILED'), 'FIXTURE_READ_FAILED');
    }
    async function publish(fixture, ids, cleaning = false) {
      const current = await entry(fixture, fixture.username, cleaning);
      check(current.id === fixture.id && current.authorId === fixture.authorId && current.content === marker, 'FIXTURE_SCOPE_MISMATCH');
      const value = await data('/rest/v1/rpc/publish_entry', { username: fixture.username, cleaning, method: 'POST', body: { p_entry_id: fixture.id, p_media_ids: ids, p_expected_updated_at: current.updatedAt } }, 'PUBLISH_FAILED');
      check(value?.id === fixture.id && value.status === 'published', 'PUBLISH_FAILED'); return value;
    }
    async function download(path, username, mode = 'user', cleaning = false) {
      return api(storagePath(path), { username, mode, binary: true, cleaning });
    }
    async function assertPng(path, username) {
      const response = await download(path, username);
      check(response.ok && response.headers.get('content-type')?.split(';')[0] === 'image/png' && equalBytes(response.data, PNG_BYTES), 'PRIVATE_DOWNLOAD_FAILED');
    }
    async function upload(fixture) {
      const value = await data('/rest/v1/rpc/reserve_media', { username: fixture.username, method: 'POST', body: { p_entry_id: fixture.id, p_name: 'verification.png', p_mime_type: 'image/png', p_size: PNG_BYTES.length } }, 'RESERVE_FAILED');
      const path = mediaPath(value, fixture.id, fixture.authorId); objects.set(path, fixture);
      const uploaded = await api(storagePath(path), { username: fixture.username, method: 'POST', binary: true, body: PNG_BYTES, extra: { 'x-upsert': 'false', 'cache-control': '0' } });
      check(uploaded.ok, 'UPLOAD_FAILED'); metrics.uploadedObjects++;
      const ready = await data('/rest/v1/rpc/finalize_media', { username: fixture.username, method: 'POST', body: { p_media_id: value.id } }, 'FINALIZE_FAILED');
      check(ready?.id === value.id && ready.entryId === fixture.id && ready.storagePath === path && ready.status === 'ready' && ready.attached === false, 'FINALIZE_FAILED');
      return { id: value.id, path };
    }
    async function cleanupAll() {
      const removable = [];
      let storageOkay = true, rowsOkay = true, sessionsOkay = true;
      for (const fixture of fixtures) {
        try {
          // Even a lost INSERT response is cleaned only when its random UUID,
          // author and exact run marker all match. A UUID collision is untouched.
          const scope = query('entries', { id: `eq.${fixture.id}`, authorId: `eq.${fixture.authorId}`, content: `eq.${marker}`, select: 'id,authorId,content,status,updatedAt' });
          const found = await data(scope, { mode: 'cleanup', cleaning: true }, 'CLEANUP_SCOPE_READ_FAILED');
          check(Array.isArray(found) && found.length <= 1, 'CLEANUP_SCOPE_READ_FAILED');
          if (!found.length) {
            if ([...objects.values()].includes(fixture)) throw new SafeError(503, 'CLEANUP_SCOPE_READ_FAILED');
            continue;
          }
          check(found[0].id === fixture.id && found[0].authorId === fixture.authorId && found[0].content === marker, 'CLEANUP_SCOPE_MISMATCH');
          cleanupEligible.add(fixture.id);
          const paths = [...objects].filter(([, owner]) => owner === fixture).map(([path]) => path);
          if (paths.length) {
            // Explicitly authorized administrator fixture cleanup, independent of
            // the user-JWT RLS assertions. A guard/policy failure must not strand
            // this run's files. Never list a bucket or inspect unrelated paths.
            try { await api(`/storage/v1/object/${BUCKET_ID}`, { mode: 'cleanup-storage', method: 'DELETE', body: { prefixes: paths }, cleaning: true }); } catch { /* Independently inspect every exact path below. */ }
            for (const path of paths) {
              const response = await api(`/storage/v1/object/info/${BUCKET_ID}/${path}`, { mode: 'cleanup-storage', cleaning: true });
              const code = response.data?.code;
              const absent = !response.ok && (code === 'NoSuchKey' || (code == null && (response.status === 404 || (response.status === 400 && String(response.data?.statusCode) === '404' && response.data?.error === 'not_found'))));
              check(absent, 'STORAGE_CLEANUP_UNCONFIRMED');
            }
          }
          removable.push(fixture);
        } catch { storageOkay = false; rowsOkay = false; cleanup.remainingFixtureIds.push(fixture.id); }
      }
      if (removable.length) {
        const ids = `in.(${removable.map(value => value.id).join(',')})`;
        try {
          for (const table of ['comments', 'reactions', 'favorites', 'media']) await data(query(table, { entryId: ids }), { mode: 'cleanup', method: 'DELETE', cleaning: true }, 'FIXTURE_ROW_CLEANUP_FAILED');
          await data(query('entries', { id: ids, content: `eq.${marker}`, authorId: `in.(${removable.map(value => value.authorId).join(',')})` }), { mode: 'cleanup', method: 'DELETE', cleaning: true }, 'FIXTURE_ROW_CLEANUP_FAILED');
          const remaining = await data(query('entries', { id: ids, content: `eq.${marker}`, select: 'id' }), { mode: 'cleanup', cleaning: true }, 'FIXTURE_ROW_CLEANUP_FAILED');
          check(Array.isArray(remaining) && remaining.length === 0, 'FIXTURE_ROW_CLEANUP_FAILED');
        } catch { rowsOkay = false; cleanup.remainingFixtureIds.push(...removable.map(value => value.id)); }
      }
      for (const [username] of sessions) {
        try { const response = await api('/auth/v1/logout?scope=local', { username, method: 'POST', cleaning: true }); if (!response.ok) sessionsOkay = false; }
        catch { sessionsOkay = false; }
      }
      sessions.clear(); objects.clear();
      cleanup.storage = storageOkay; cleanup.rows = rowsOkay; cleanup.sessions = sessionsOkay;
      cleanup.remainingFixtureIds = [...new Set(cleanup.remainingFixtureIds)];
      if (!storageOkay) cleanup.errors.push('STORAGE_CLEANUP_INCOMPLETE');
      if (!rowsOkay) cleanup.errors.push('FIXTURE_ROWS_REMAIN');
      if (!sessionsOkay) cleanup.errors.push('SESSION_REVOCATION_UNCONFIRMED');
      cleanup.complete = storageOkay && rowsOkay && sessionsOkay;
    }
    try {
      lease();
      const incoming = new URL(request.url);
      if (request.method !== 'POST') fail(405, 'POST_REQUIRED');
      if (incoming.search || incoming.hash || request.headers.has('origin')) fail(403, 'TRUSTED_CLIENT_REQUIRED');
      const authorization = request.headers.get('authorization') ?? '';
      if (!await matches(authorization.startsWith('Bearer ') ? authorization.slice(7) : '', fixed.capabilitySha256, subtle)) fail(401, 'NOT_AUTHORIZED');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED');
      const body = await readJson(request, 1024);
      if (!object(body) || Object.keys(body).length !== 1 || body.run !== true) fail(400, 'INVALID_REQUEST');
      origin = exactOrigin(fixed.projectOrigin); exactOrigin(env('SUPABASE_URL'));
      publicKey = fixed.publishableKey;
      if (typeof publicKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(publicKey)) fail(503, 'PUBLIC_KEY_UNAVAILABLE');
      privileged = serverCredential(env);
      // Reserve cleanup time before any session or fixture can be created.
      if (fixed.expiresAt - now() < 125_000) fail(410, 'INSUFFICIENT_CLEANUP_WINDOW');
      workDeadline = now() + 85_000; cleanupDeadline = now() + 120_000; authorized = true;
      const usersResponse = await api('/auth/v1/admin/users?page=1&per_page=4', { mode: 'admin-auth' });
      const authUsers = usersResponse.data?.users;
      const total = usersResponse.headers.get('x-total-count');
      check(usersResponse.ok && Array.isArray(authUsers) && authUsers.length === 3 && (total === null || total === '3') && !/;\s*rel=["']?next["']?/i.test(usersResponse.headers.get('link') ?? ''), 'UNEXPECTED_AUTH_STATE');
      const expected = new Map();
      for (const identity of IDENTITIES) {
        const matches = authUsers.filter(value => validUser(value, identity, null, now()));
        check(matches.length === 1, 'UNEXPECTED_AUTH_STATE'); expected.set(identity.username, matches[0].id);
      }
      check(new Set(expected.values()).size === 3, 'UNEXPECTED_AUTH_STATE');
      for (const identity of IDENTITIES) {
        const raw = await data('/auth/v1/admin/generate_link', { mode: 'admin-auth', method: 'POST', body: { type: 'magiclink', email: identity.email } }, 'LINK_GENERATION_FAILED');
        check(validUser(raw, identity, expected.get(identity.username), now()) && typeof raw.hashed_token === 'string' && raw.hashed_token.length >= 16 && raw.hashed_token.length <= 512, 'UNEXPECTED_AUTH_STATE');
        const verified = await data('/auth/v1/verify', { mode: 'public', method: 'POST', body: { token_hash: raw.hashed_token, type: 'email' } }, 'SESSION_VERIFY_FAILED');
        check(typeof verified?.access_token === 'string' && verified.access_token.length <= 8192 && JWT.test(verified.access_token), 'SESSION_VERIFY_FAILED');
        // Register immediately so even a mismatched response is locally signed out.
        sessions.set(identity.username, { token: verified.access_token });
        check(validUser(verified.user, identity, expected.get(identity.username), now()), 'SESSION_IDENTITY_MISMATCH');
        const authenticated = await data('/auth/v1/user', { username: identity.username }, 'SESSION_IDENTITY_MISMATCH');
        check(validUser(authenticated, identity, expected.get(identity.username), now()), 'SESSION_IDENTITY_MISMATCH');
      }
      for (const identity of IDENTITIES) {
        const profiles = await data('/rest/v1/profiles?select=id,slot,username,role&order=slot', { username: identity.username }, 'PROFILE_PREFLIGHT_FAILED');
        check(Array.isArray(profiles) && profiles.length === 3 && IDENTITIES.every(item => profiles.filter(value => value.id === expected.get(item.username) && value.slot === item.slot && value.username === item.username && value.role === item.role).length === 1), 'PROFILE_IDENTITY_MISMATCH');
      }
      metrics.checks.identitiesAndProfiles = true;
      runId = randomUUID(); check(UUID.test(runId), 'INVALID_FIXTURE_ID'); marker = `memory-verification:${runId}`;
      for (const username of ['xbl', 'll']) {
        const fixture = { id: randomUUID(), username, authorId: expected.get(username) };
        check(UUID.test(fixture.id) && fixture.id !== runId && !fixtures.some(value => value.id === fixture.id), 'INVALID_FIXTURE_ID'); fixtures.push(fixture);
        const saved = one(await data('/rest/v1/entries', { username, method: 'POST', extra: { Prefer: 'return=representation' }, body: { id: fixture.id, type: 'note', title: marker, content: marker, occurredAt: new Date(now()).toISOString(), mood: null, tags: [] } }, 'FIXTURE_CREATE_FAILED'), 'FIXTURE_CREATE_FAILED');
        check(saved.id === fixture.id && saved.authorId === fixture.authorId && saved.content === marker && saved.status === 'draft', 'FIXTURE_CREATE_FAILED');
      }
      const [a, b] = fixtures;
      for (const [fixture, viewers] of [[a, ['ll', 'memory-admin']], [b, ['xbl', 'memory-admin']]]) for (const username of viewers) {
        const rows = await data(fixtureQuery(fixture), { username }, 'DRAFT_ISOLATION_FAILED'); check(Array.isArray(rows) && rows.length === 0, 'DRAFT_ISOLATION_FAILED');
      }
      metrics.checks.draftIsolation = true;
      const original = [];
      for (let index = 0; index < 9; index++) original.push(await upload(a));
      await publish(a, original.map(value => value.id)); metrics.checks.pngPipeline = true;
      for (const username of IDENTITIES.map(value => value.username)) await assertPng(original[0].path, username);
      metrics.checks.memberDownloads = true;
      for (const path of [storagePath(original[0].path), `/storage/v1/object/public/${BUCKET_ID}/${original[0].path}`]) {
        const response = await api(path, { mode: 'public', binary: true }); check([400, 401, 403, 404].includes(response.status), 'ANONYMOUS_DOWNLOAD_ALLOWED');
      }
      const anonymousRows = await api(fixtureQuery(a), { mode: 'public' });
      check((!anonymousRows.ok && [401, 403].includes(anonymousRows.status)) || (anonymousRows.ok && Array.isArray(anonymousRows.data) && anonymousRows.data.length === 0), 'ANONYMOUS_RECORD_ALLOWED'); metrics.checks.anonymousDenied = true;
      const partnerUpdate = await api(query('entries', { id: `eq.${a.id}` }), { username: 'll', method: 'PATCH', extra: { Prefer: 'return=representation' }, body: { title: `${marker}:forbidden` } });
      check((!partnerUpdate.ok && [401, 403].includes(partnerUpdate.status)) || (partnerUpdate.ok && Array.isArray(partnerUpdate.data) && partnerUpdate.data.length === 0), 'CROSS_AUTHOR_UPDATE_ALLOWED');
      check((await entry(a, 'xbl')).title === marker, 'CROSS_AUTHOR_UPDATE_ALLOWED'); metrics.checks.crossAuthorUpdateDenied = true;
      const deletion = await api(`/storage/v1/object/${BUCKET_ID}`, { username: 'xbl', method: 'DELETE', body: { prefixes: [original[0].path] } });
      check((!deletion.ok && [400, 401, 403].includes(deletion.status)) || (deletion.ok && Array.isArray(deletion.data) && deletion.data.length === 0), 'ATTACHED_DELETE_ALLOWED');
      await assertPng(original[0].path, 'xbl'); metrics.checks.attachedDeleteDenied = true;
      const upsert = await api(storagePath(original[0].path), { username: 'xbl', method: 'POST', binary: true, body: DIFFERENT_PNG, extra: { 'x-upsert': 'true' } });
      check(!upsert.ok && [400, 401, 403, 409].includes(upsert.status), 'ATTACHED_UPSERT_ALLOWED');
      await assertPng(original[0].path, 'xbl'); metrics.checks.upsertDenied = true;
      const replacement = await upload(a), current = await entry(a, 'xbl');
      const tooMany = await api('/rest/v1/rpc/publish_entry', { username: 'xbl', method: 'POST', body: { p_entry_id: a.id, p_media_ids: [...original.map(value => value.id), replacement.id], p_expected_updated_at: current.updatedAt } });
      check(!tooMany.ok && [400, 409, 422].includes(tooMany.status), 'TENTH_IMAGE_ALLOWED');
      const beforeReplacement = await data(query('media', { entryId: `eq.${a.id}`, attached: 'eq.true', select: 'id' }), { username: 'xbl' }, 'NINE_IMAGE_CHECK_FAILED');
      check(Array.isArray(beforeReplacement) && beforeReplacement.length === 9 && original.every(value => beforeReplacement.some(item => item.id === value.id)), 'NINE_IMAGE_CHECK_FAILED'); metrics.checks.nineImageLimit = true;
      await publish(a, [...original.slice(1).map(value => value.id), replacement.id]);
      const afterReplacement = await data(query('media', { entryId: `eq.${a.id}`, attached: 'eq.true', select: 'id' }), { username: 'll' }, 'REPLACEMENT_FAILED');
      check(Array.isArray(afterReplacement) && afterReplacement.length === 9 && afterReplacement.some(value => value.id === replacement.id) && !afterReplacement.some(value => value.id === original[0].id), 'REPLACEMENT_FAILED');
      await assertPng(replacement.path, 'll'); metrics.checks.atomicReplacement = true;
      const adminUpdate = one(await data(query('entries', { id: `eq.${a.id}` }), { username: 'memory-admin', method: 'PATCH', extra: { Prefer: 'return=representation' }, body: { title: `${marker}:admin` } }, 'ADMIN_UPDATE_FAILED'), 'ADMIN_UPDATE_FAILED');
      check(adminUpdate.id === a.id && adminUpdate.authorId === a.authorId && adminUpdate.title === `${marker}:admin` && (await entry(a, 'll')).title === `${marker}:admin`, 'ADMIN_UPDATE_FAILED'); metrics.checks.adminPublishedUpdate = true;
    } catch (error) {
      failure = error instanceof SafeError ? error.code : 'VERIFICATION_FAILED'; httpStatus = error instanceof SafeError ? error.status : 503;
    } finally {
      if (authorized) {
        try { await cleanupAll(); } catch { sessions.clear(); objects.clear(); cleanup.errors.push('CLEANUP_INTERRUPTED'); }
      }
      privileged = undefined; publicKey = undefined; marker = undefined;
    }
    if (!authorized) return json(httpStatus, { error: failure || 'VERIFICATION_CLOSED' });
    if (!cleanup.complete && !failure) { failure = 'CLEANUP_INCOMPLETE'; httpStatus = 503; }
    return json(httpStatus, { ok: !failure && CHECKS.every(key => metrics.checks[key]) && cleanup.complete, ...(failure ? { error: failure } : {}), runId: runId ?? null, metrics, cleanup });
  };
}
