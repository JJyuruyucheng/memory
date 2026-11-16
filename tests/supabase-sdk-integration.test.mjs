import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createRememberedSessionStorage, REMEMBER_FOR_MS } from '../src/session-storage.js';
import { createServiceFetch } from '../src/service-fetch.js';
import { createBrowserAuthLifecycle } from '../src/auth-lifecycle.js';

// Exercise the exact locally shipped SDK, rather than another SDK-shaped mock.
// Every transport is local and synthetic; this test never contacts Supabase.
const SDK_SOURCE = await readFile(new URL('../public/assets/supabase-client-2.119.0.js', import.meta.url), 'utf8');
const ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sdk-integration-session';
const USER_ID = '00000000-0000-4000-8000-000000000001';

test('shipped SDK restores a fresh client, refreshes within the original lease, and downloads through the authenticated nonce transport', async () => {
  const values = new Map(), calls = [], clients = [];
  let clock = Date.now(), serial = 0, expiryEvents = 0;
  const browserStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'synthetic@memory.invalid' };
  const sessionResponse = () => {
    serial++;
    // These are synthetic API responses, not proof of server JWT verification.
    // Keep SDK expiry independent from the device retention clock under test.
    const payload = { sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 365 * 86400, session_id: 'synthetic-session', serial };
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.synthetic-signature`, refresh_token: `synthetic-refresh-${serial}`, expires_in: 365 * 86400, token_type: 'bearer', user };
  };
  const localFetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? input);
    assert.equal(url.origin, ORIGIN, 'no external transport is permitted');
    const headers = new Headers(init.headers ?? request?.headers);
    calls.push({ url, method: init.method ?? request?.method ?? 'GET', headers });
    if (url.pathname === '/auth/v1/token') return Response.json(sessionResponse());
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/storage/v1/object/memory-media/a/b/c') return new Response('synthetic-image', { headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected local SDK request: ${url.pathname}`);
  };
  class NoNetworkWebSocket {
    constructor() { throw new Error('Unexpected WebSocket connection in local integration test'); }
  }
  const context = createContext({
    console, URL, URLSearchParams, Request, Response, Headers, Blob,
    AbortController, AbortSignal, DOMException, TextEncoder, TextDecoder,
    crypto, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, WebSocket: NoNetworkWebSocket, fetch: localFetch,
  });
  runInContext(SDK_SOURCE, context, { filename: 'shipped-supabase-sdk.js' });
  const createClient = () => {
    const storage = createRememberedSessionStorage({ storage: browserStorage, key: KEY, now: () => clock, onExpired: () => { expiryEvents++; } });
    const client = context.supabase.createClient(ORIGIN, 'sb_publishable_synthetic', {
      auth: { storage, storageKey: KEY, persistSession: true, detectSessionInUrl: false, autoRefreshToken: false },
      global: { fetch: createServiceFetch(ORIGIN, { fetchImpl: localFetch, nonce: () => `synthetic-nonce-${serial}` }) },
    });
    clients.push(client);
    return { client, storage };
  };
  try {
    const first = createClient();
    assert.equal((await first.client.auth.getSession()).data.session, null);
    first.storage.beginSignIn();
    const signedIn = await first.client.auth.signInWithPassword({ email: user.email, password: 'synthetic-password', options: { captchaToken: 'synthetic-captcha' } });
    assert.equal(signedIn.error, null);
    const deadline = JSON.parse(values.get(KEY)).expiresAt;
    assert.equal(deadline, clock + REMEMBER_FOR_MS);

    const second = createClient();
    const restored = await second.client.auth.getSession();
    assert.equal(restored.error, null);
    assert.equal(restored.data.session.user.id, USER_ID);
    assert.equal((await second.client.auth.getUser()).data.user.id, USER_ID);
    clock += 29 * 86400_000;
    const refreshed = await second.client.auth.refreshSession();
    assert.equal(refreshed.error, null);
    assert.notEqual(refreshed.data.session.access_token, signedIn.data.session.access_token);
    assert.equal(JSON.parse(values.get(KEY)).expiresAt, deadline, 'native token refresh cannot restart retention');

    const downloaded = await second.client.storage.from('memory-media').download('a/b/c');
    assert.equal(downloaded.error, null);
    assert.equal(await downloaded.data.text(), 'synthetic-image');
    const transport = calls.at(-1);
    assert.equal(transport.url.pathname, '/storage/v1/object/memory-media/a/b/c', 'this SDK uses the legacy authenticated download route');
    assert.match(transport.url.searchParams.get('cacheNonce') ?? '', /^synthetic-nonce-/);
    assert.equal(transport.headers.get('authorization'), `Bearer ${refreshed.data.session.access_token}`, 'fresh download keeps the current user JWT');
    assert.equal(transport.headers.get('apikey'), 'sb_publishable_synthetic');

    clock = deadline + 1;
    const expired = createClient();
    assert.equal((await expired.client.auth.getSession()).data.session, null);
    assert.equal(values.has(KEY), false);
    assert.equal(expiryEvents, 1);
    await second.client.auth.signOut({ scope: 'local' });
    assert.equal(values.has(KEY), false);
  } finally {
    for (const client of clients) await client.auth.stopAutoRefresh();
  }
});

test('the shipped SDK refreshes an expired token after a suspended tab returns, surviving a transient Auth 503 without extending its lease', async () => {
  let clock = Date.now(), refreshRequests = 0;
  const values = new Map(), browser = new EventTarget(), document = new EventTarget(), navigator = { onLine: true };
  document.visibilityState = 'hidden';
  const browserStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const storage = createRememberedSessionStorage({ storage: browserStorage, key: KEY, now: () => clock });
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'synthetic@memory.invalid' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = serial => {
    const expires_at = Math.floor(clock / 1000) + 3600;
    return { access_token: `${encode({ alg: 'HS256' })}.${encode({ sub: USER_ID, exp: expires_at, serial })}.synthetic`, refresh_token: `synthetic-idle-refresh-${serial}`, token_type: 'bearer', expires_at, expires_in: 3600, user };
  };
  storage.beginSignIn(); storage.setItem(KEY, JSON.stringify(session(1)));
  const deadline = JSON.parse(values.get(KEY)).expiresAt;
  const localFetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, ORIGIN);
    if (url.pathname === '/auth/v1/token') {
      refreshRequests++;
      assert.equal(new URLSearchParams(url.search).get('grant_type'), 'refresh_token');
      assert.equal(JSON.parse(init.body).refresh_token, 'synthetic-idle-refresh-1');
      if (refreshRequests === 1) return Response.json({ message: 'synthetic brief outage' }, { status: 503 });
      return Response.json(session(2));
    }
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    throw Error(`Unexpected local SDK request: ${url.pathname}`);
  };
  class DeviceDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  class NoNetworkWebSocket { constructor() { throw Error('No external sockets permitted'); } }
  // Browser-shaped globals exercise the real SDK's visibility integration.
  const context = createContext({
    console: { ...console, error() {}, warn() {} }, Date: DeviceDate,
    URL, URLSearchParams, Request, Response, Headers, Blob, AbortController, AbortSignal, DOMException,
    TextEncoder, TextDecoder, crypto, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, WebSocket: NoNetworkWebSocket, fetch: localFetch,
    window: browser, document, navigator,
  });
  runInContext(SDK_SOURCE, context, { filename: 'shipped-supabase-sdk.js' });
  const client = context.supabase.createClient(ORIGIN, 'sb_publishable_synthetic', {
    auth: { storage, storageKey: KEY, persistSession: true, detectSessionInUrl: false, autoRefreshToken: true },
    global: { fetch: createServiceFetch(ORIGIN, { fetchImpl: localFetch }) },
  });
  const lifecycle = createBrowserAuthLifecycle(client.auth, { windowTarget: browser, documentTarget: document, navigatorTarget: navigator });
  try {
    assert.equal((await client.auth.getSession()).data.session.user.id, USER_ID);
    await lifecycle.pause();
    clock += 2 * 3600_000; // The browser slept beyond the access JWT's lifetime.
    document.visibilityState = 'visible'; await lifecycle.resume();
    const restored = await client.auth.getSession();
    assert.equal(restored.error, null); assert.equal(restored.data.session.refresh_token, 'synthetic-idle-refresh-2');
    assert.equal(refreshRequests, 2, 'the official SDK retries a transient Auth failure');
    assert.equal((await client.auth.getUser()).data.user.id, USER_ID);
    assert.equal(JSON.parse(values.get(KEY)).expiresAt, deadline);
    assert.equal(JSON.parse(JSON.parse(values.get(KEY)).session).refresh_token, 'synthetic-idle-refresh-2');
  } finally { await lifecycle.dispose(); await client.auth.dispose(); }
});
