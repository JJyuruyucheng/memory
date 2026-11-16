import { timingSafeEqual } from 'node:crypto';

// No SDK, third-party imports, console output, SQL, profile changes, or password updates.
export const IDENTITIES = Object.freeze([
  Object.freeze({ username: 'xbl', email: 'xbl@memory.invalid', minimum: 6 }),
  Object.freeze({ username: 'll', email: 'll@memory.invalid', minimum: 6 }),
  Object.freeze({ username: 'memory-admin', email: 'memory-admin@memory.invalid', minimum: 12 }),
]);
export const BUCKET_ID = 'memory-media';
export const MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime']);
const REQUEST_LIMIT = 16384;
const RESPONSE_LIMIT = 131072;
const MAX_LEASE = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;

class SafeError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(status, code) { throw new SafeError(status, code); }
function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}
function hexBytes(value) { return Uint8Array.from(value.match(/../g), part => Number.parseInt(part, 16)); }
export async function capabilityMatches(capability, expectedHex, subtle = globalThis.crypto.subtle) {
  if (typeof capability !== 'string' || !HEX.test(capability) || typeof expectedHex !== 'string' || !HEX.test(expectedHex)) return false;
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(capability)));
  // Both inputs are fixed 32-byte SHA-256 digests; use the runtime's native constant-time primitive.
  return timingSafeEqual(digest, hexBytes(expectedHex));
}
export async function readJsonLimited(message, maximum, timeoutMs = 8000) {
  const length = message.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) fail(413, 'BODY_TOO_LARGE');
  if (!message.body) fail(400, 'INVALID_JSON');
  const reader = message.body.getReader();
  const chunks = [];
  let total = 0;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new SafeError(408, 'BODY_TIMEOUT'));
      reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON'); }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys) { return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
export function validatePasswords(body) {
  if (!exactKeys(body, ['passwords']) || !exactKeys(body.passwords, IDENTITIES.map(item => item.username))) fail(400, 'INVALID_PASSWORD_INPUT');
  for (const identity of IDENTITIES) {
    const password = body.passwords[identity.username];
    if (typeof password !== 'string' || password.length < identity.minimum || password.length > 128 || /[\u0000-\u001f\u007f]/.test(password)) fail(400, 'INVALID_PASSWORD_INPUT');
  }
  return body.passwords;
}
export function projectOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail(503, 'INVALID_SERVER_CONFIGURATION'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail(503, 'INVALID_SERVER_CONFIGURATION');
  return url.origin;
}
function serverCredential(env) {
  const dictionary = env('SUPABASE_SECRET_KEYS');
  if (dictionary) {
    let keys;
    try { keys = JSON.parse(dictionary); } catch { fail(503, 'INVALID_SERVER_CONFIGURATION'); }
    const key = object(keys) ? keys.default : undefined;
    if (typeof key !== 'string' || !/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(key)) fail(503, 'INVALID_SERVER_CONFIGURATION');
    return { apikey: key }; // New keys are not JWTs: never put one in Authorization.
  }
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (typeof legacy !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(legacy)) fail(503, 'INVALID_SERVER_CONFIGURATION');
  return { apikey: legacy, Authorization: `Bearer ${legacy}` };
}
function validateUser(user, currentTime) {
  if (!object(user) || !UUID.test(user.id ?? '') || typeof user.email !== 'string') fail(409, 'UNEXPECTED_AUTH_STATE');
  const identity = IDENTITIES.find(item => item.email === user.email.toLowerCase());
  if (!identity || user.email !== identity.email || user.role !== 'authenticated' || user.aud !== 'authenticated' || user.is_anonymous !== false
    || typeof user.email_confirmed_at !== 'string' || !Number.isFinite(Date.parse(user.email_confirmed_at)) || user.deleted_at
    || (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > currentTime))) fail(409, 'UNEXPECTED_AUTH_STATE');
  return identity;
}
function validBucket(bucket) {
  return object(bucket) && bucket.id === BUCKET_ID && bucket.name === BUCKET_ID && bucket.public === false
    && Number(bucket.file_size_limit) === 50000000 && Array.isArray(bucket.allowed_mime_types)
    && bucket.allowed_mime_types.length === MIME_TYPES.length && new Set(bucket.allowed_mime_types).size === MIME_TYPES.length
    && MIME_TYPES.every(type => bucket.allowed_mime_types.includes(type)) && (bucket.type === undefined || bucket.type === 'STANDARD');
}

/** A short-lived capability, not a distributed single-use token. Default policy is inert. */
export function createBootstrapHandler(policy, dependencies = {}) {
  const fixed = Object.freeze({ ...policy });
  const env = dependencies.env ?? (name => globalThis.Deno?.env.get(name));
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  function lease() {
    const current = now();
    if (fixed.enabled !== true || fixed.prerequisitesVerified !== true || !HEX.test(fixed.capabilitySha256 ?? '') || /^0+$/.test(fixed.capabilitySha256)
      || !Number.isSafeInteger(fixed.issuedAt) || !Number.isSafeInteger(fixed.expiresAt) || fixed.issuedAt <= 0
      || fixed.expiresAt - fixed.issuedAt <= 0 || fixed.expiresAt - fixed.issuedAt > MAX_LEASE
      || current < fixed.issuedAt || current >= fixed.expiresAt) fail(410, 'BOOTSTRAP_CLOSED');
  }
  return async function bootstrap(request) {
    try {
      lease();
      const url = new URL(request.url);
      if (request.method !== 'POST') fail(405, 'POST_REQUIRED');
      // Supabase's internal proxy may present an http Request URL. Transport is HTTPS
      // at the fixed trusted client and upstream; never infer it from forwarded headers.
      if (url.search || url.hash || request.headers.has('origin')) fail(403, 'TRUSTED_CLIENT_REQUIRED');
      const authorization = request.headers.get('authorization') ?? '';
      const capability = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!await capabilityMatches(capability, fixed.capabilitySha256, dependencies.subtle)) fail(401, 'NOT_AUTHORIZED');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED');
      const passwords = validatePasswords(await readJsonLimited(request, REQUEST_LIMIT));
      const origin = projectOrigin(fixed.projectOrigin);
      if (projectOrigin(env('SUPABASE_URL')) !== origin) fail(503, 'PROJECT_MISMATCH');
      const credential = serverCredential(env);
      async function api(path, method = 'GET', body) {
        lease();
        if (request.signal.aborted) fail(503, 'REQUEST_ABORTED');
        const response = await fetcher(`${origin}${path}`, {
          method, redirect: 'error', headers: { ...credential, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, Math.min(8000, fixed.expiresAt - now())))]),
        });
        let data;
        try { data = await readJsonLimited(response, RESPONSE_LIMIT); }
        catch { fail(503, 'INVALID_UPSTREAM_RESPONSE'); }
        return { status: response.status, ok: response.ok, data, headers: response.headers };
      }
      async function users() {
        const found = new Map();
        const ids = new Set();
        for (let page = 1; page <= 20; page += 1) {
          const response = await api(`/auth/v1/admin/users?page=${page}&per_page=100`);
          if (!response.ok || !object(response.data) || !Array.isArray(response.data.users) || response.data.users.length > 100) fail(503, 'AUTH_LIST_FAILED');
          for (const user of response.data.users) {
            const identity = validateUser(user, now());
            if (found.has(identity.username) || ids.has(user.id)) fail(409, 'UNEXPECTED_AUTH_STATE');
            found.set(identity.username, user.id); ids.add(user.id);
          }
          const totalText = response.headers.get('x-total-count');
          if (totalText !== null && (!/^\d+$/.test(totalText) || Number(totalText) > 3 || Number(totalText) < found.size)) fail(409, 'UNEXPECTED_AUTH_STATE');
          const total = totalText === null ? null : Number(totalText);
          const next = /;\s*rel=["']?next["']?/i.test(response.headers.get('link') ?? '');
          if (!next && response.data.users.length < 100 && (total === null || found.size >= total)) return found;
          if (!response.data.users.length) fail(503, 'INVALID_AUTH_PAGINATION');
        }
        fail(503, 'AUTH_PAGINATION_LIMIT');
      }
      async function bucket() {
        const response = await api(`/storage/v1/bucket/${BUCKET_ID}`);
        if (response.ok) { if (!validBucket(response.data)) fail(409, 'BUCKET_CONFIGURATION_MISMATCH'); return true; }
        if (response.status === 404 || (response.status === 400 && [404, '404'].includes(response.data?.statusCode))) return false;
        fail(503, 'BUCKET_READ_FAILED');
      }
      // Complete all non-mutating preflight checks before creating anything.
      const before = await users();
      const existingBucket = await bucket();
      if (!existingBucket) {
        const result = await api('/storage/v1/bucket', 'POST', {
          id: BUCKET_ID, name: BUCKET_ID, public: false, file_size_limit: 50000000, allowed_mime_types: [...MIME_TYPES],
        });
        if (!result.ok && ![400, 409].includes(result.status)) fail(503, 'BUCKET_CREATE_FAILED');
        if (!await bucket()) fail(503, 'BUCKET_CREATE_FAILED');
      }
      const result = [];
      for (const identity of IDENTITIES) {
        let id = before.get(identity.username);
        let created = false;
        if (!id) {
          const response = await api('/auth/v1/admin/users', 'POST', { email: identity.email, password: passwords[identity.username], email_confirm: true });
          if (response.ok) {
            const user = response.data?.user ?? response.data;
            if (validateUser(user, now()).username !== identity.username) fail(503, 'AUTH_CREATE_FAILED');
            id = user.id; created = true;
          } else if ([409, 422].includes(response.status)) {
            // Another isolate may have created the same fixed account. Never reset it.
            id = (await users()).get(identity.username);
            if (!id) fail(503, 'AUTH_CREATE_FAILED');
          } else fail(503, 'AUTH_CREATE_FAILED');
        }
        result.push({ username: identity.username, id, created });
      }
      const after = await users();
      if (after.size !== 3 || result.some(item => after.get(item.username) !== item.id)) fail(409, 'UNEXPECTED_AUTH_STATE');
      lease();
      return json(200, { users: result, bucket: BUCKET_ID });
    } catch (error) {
      // Never forward native errors, response bodies, stack traces, credentials, or passwords.
      return json(error instanceof SafeError ? error.status : 503, { error: error instanceof SafeError ? error.code : 'BOOTSTRAP_FAILED' });
    }
  };
}
