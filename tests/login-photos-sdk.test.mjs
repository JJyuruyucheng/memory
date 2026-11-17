import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createLoginPhotosProvider } from '../src/login-photos-provider.js';
import { createServiceFetch } from '../src/service-fetch.js';

test('shipped SDK reads login artwork anonymously through the actual provider and transport', async () => {
  const origin = 'https://abcdefghijklmnopqrst.supabase.co';
  const key = 'sb_publishable_synthetic';
  const id = '00000000-0000-4000-8000-000000000001';
  const calls = [], picture = new Blob(['synthetic-raster'], { type: 'image/png' });
  const localFetch = async (input, init = {}) => {
    const url = new URL(input), headers = new Headers(init.headers);
    assert.equal(url.origin, origin, 'all transport is synthetic; no live service');
    assert.equal(headers.get('apikey'), key);
    assert.ok([null, `Bearer ${key}`].includes(headers.get('authorization')), 'no authenticated or privileged identity');
    assert.equal(init.cache, 'no-store');
    calls.push(url.pathname);
    if (url.pathname === '/rest/v1/rpc/get_login_photos') return Response.json({ revision: 1, photos: [{ id, path: `slides/${id}`, mimeType: 'image/png', size: picture.size }] });
    if (url.pathname === `/storage/v1/object/login-photos/slides/${id}`) return new Response(picture, { headers: { 'content-type': picture.type } });
    throw new Error(`Unexpected SDK request: ${url.pathname}`);
  };
  class NoNetworkWebSocket { constructor() { throw new Error('Unexpected WebSocket'); } }
  const context = createContext({ console, URL, URLSearchParams, Request, Response, Headers, Blob, AbortController, AbortSignal,
    DOMException, TextEncoder, TextDecoder, crypto, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    WebSocket: NoNetworkWebSocket, fetch: localFetch });
  runInContext(await readFile(new URL('../public/assets/supabase-client-2.119.0.js', import.meta.url), 'utf8'), context);
  const client = context.supabase.createClient(origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createServiceFetch(origin, { fetchImpl: localFetch }) },
  });
  const revoked = [];
  const provider = createLoginPhotosProvider({ client, getCurrentUser: () => null,
    urlAPI: { createObjectURL(blob) { assert.equal(blob.size, picture.size); return 'blob:synthetic-login-photo'; }, revokeObjectURL(url) { revoked.push(url); } } });
  try {
    assert.equal((await provider.getLoginPhotos()).photos.length, 1);
    assert.equal(await provider.getLoginPhotoUrl(id), 'blob:synthetic-login-photo');
    assert.deepEqual(calls, ['/rest/v1/rpc/get_login_photos', `/storage/v1/object/login-photos/slides/${id}`]);
  } finally { provider.dispose(); client.auth.stopAutoRefresh(); }
  assert.deepEqual(revoked, ['blob:synthetic-login-photo']);
});
