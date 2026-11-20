import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecycleHandler } from '../supabase/functions/memory-recycle/core.mjs';

const site = 'https://memory-awv.pages.dev';
const project = 'https://abcdefghijklmnopqrst.supabase.co';
const account = '00000000-0000-4000-8000-000000000001';
const entry = '00000000-0000-4000-8000-000000000002';
const media = '00000000-0000-4000-8000-000000000003';
const lease = '00000000-0000-4000-8000-000000000004';
const claim = { entry_id: entry, lease_id: lease, media_paths: [`${account}/${entry}/${media}`] };
const auth = 'Bearer test.signed.member';
const cron = 'a'.repeat(64);

function createRequest(body, headers = {}, method = 'POST') {
  return new Request(project + '/functions/v1/memory-recycle', {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const manual = entryId => createRequest({ entryId }, { origin: site, authorization: auth });
const scheduled = token => createRequest({}, { 'x-memory-recycle-token': token });
const json = (value, status = 200) => Response.json(value, { status });
function fixture(replies) {
  const calls = [];
  const handler = createRecycleHandler({ apiOrigin: project, publicKey: 'fixture-public', serviceKey: 'fixture-service',
    async fetchImpl(url, options) {
      const target = new URL(url);
      assert.equal(target.origin, project);
      assert.equal(options.redirect, 'error');
      const call = { path: target.pathname, method: options.method, body: options.body && JSON.parse(options.body), ...options.headers };
      calls.push(call);
      const next = replies[call.path];
      assert.ok(next, `Unexpected upstream route ${call.path}`);
      return next(call);
    },
  });
  return { handler, calls };
}

test('recycle validates origin, method, JWT shape and payload before touching the data service', async () => {
  const { handler, calls } = fixture({});
  const preflight = await handler(createRequest(undefined, { origin: site }, 'OPTIONS'));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), site);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-client-info/);
  assert.equal((await handler(createRequest(undefined, {}, 'GET'))).status, 405);
  assert.equal((await handler(createRequest({ entryId: entry }, { origin: 'https://example.invalid', authorization: auth }))).status, 403);
  assert.equal((await handler(createRequest({ entryId: entry }))).status, 401);
  assert.equal((await handler(createRequest({ entryId: entry, paths: [] }, { authorization: auth }))).status, 400);
  assert.equal((await handler(createRequest({ entryId: 'x'.repeat(1025) }, { authorization: auth }))).status, 400);
  assert.equal((await handler(createRequest({}, { origin: site, 'x-memory-recycle-token': cron }))).status, 401);
  assert.deepEqual(calls, []);
});

test('manual recycle verifies the user then claims as the caller before trusted storage and finalization', async () => {
  const { handler, calls } = fixture({
    '/auth/v1/user': call => {
      assert.equal(call.authorization, auth);
      assert.equal(call.apikey, 'fixture-public');
      return json({ id: account });
    },
    '/rest/v1/rpc/recycle_claim_manual': call => {
      assert.equal(call.authorization, auth);
      assert.deepEqual(call.body, { p_entry_id: entry });
      return json({ queued: 1, claims: [claim] });
    },
    '/storage/v1/object/memory-media': call => {
      assert.equal(call.authorization, 'Bearer fixture-service');
      assert.equal(call.method, 'DELETE');
      assert.deepEqual(call.body, { prefixes: claim.media_paths });
      return json([]);
    },
    '/rest/v1/rpc/recycle_finalize': call => {
      assert.equal(call.authorization, 'Bearer fixture-service');
      assert.deepEqual(call.body, { p_entry_id: entry, p_lease_id: lease });
      return json(true);
    },
  });
  const response = await handler(manual(entry));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { queued: 1, deleted: 1, pending: 0 });
  assert.deepEqual(calls.map(call => call.path), [
    '/auth/v1/user', '/rest/v1/rpc/recycle_claim_manual', '/storage/v1/object/memory-media', '/rest/v1/rpc/recycle_finalize',
  ]);
});

test('unavailable or unexpected claims cannot delete storage and reveal no record details', async () => {
  for (const [upstream, expectedStatus, code] of [
    [() => json({ message: 'RECYCLE_UNAVAILABLE', details: 'private-input' }, 400), 404, 'RECYCLE_UNAVAILABLE'],
    [() => json({ queued: 1, claims: [{ ...claim, media_paths: [`${account}/${account}/${media}`] }] }), 503, 'RECYCLE_OFFLINE'],
  ]) {
    const { handler, calls } = fixture({
      '/auth/v1/user': () => json({ id: account }),
      '/rest/v1/rpc/recycle_claim_manual': upstream,
    });
    const response = await handler(manual(entry));
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(await response.json(), { code });
    assert.equal(calls.length, 2);
  }
});

test('an invalid session cannot claim records', async () => {
  const { handler, calls } = fixture({ '/auth/v1/user': () => json({ session: 'private-input' }, 401) });
  const response = await handler(manual(entry));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'RECYCLE_UNAUTHORIZED' });
  assert.equal(calls.length, 1);
});

test('the cron token must pass the service-only database verification', async () => {
  const { handler, calls } = fixture({
    '/rest/v1/rpc/recycle_claim_expired': call => {
      assert.equal(call.authorization, 'Bearer fixture-service');
      assert.deepEqual(call.body, { p_token: cron });
      return json({ code: '42501' }, 403);
    },
  });
  assert.equal((await handler(scheduled('unknown'))).status, 401);
  assert.equal((await handler(scheduled(cron))).status, 401);
  assert.equal(calls.length, 1);
});

test('modern service keys travel on apikey without borrowing the caller authorization', async () => {
  const handler = createRecycleHandler({ apiOrigin: project, publicKey: 'fixture-public', serviceKey: 'sb_secret_fixture_only',
    async fetchImpl(url, options) {
      assert.ok(url.endsWith('/recycle_claim_expired'));
      assert.equal(options.headers.apikey, 'sb_secret_fixture_only');
      assert.equal(options.headers.authorization, undefined);
      return json([]);
    },
  });
  assert.deepEqual(await (await handler(scheduled(cron))).json(), { queued: 0, deleted: 0, pending: 0 });
});

test('storage or finalize failures leave the leased record pending for a later attempt', async () => {
  let attempt = 0;
  const { handler, calls } = fixture({
    '/rest/v1/rpc/recycle_claim_expired': () => { attempt++; return json([claim]); },
    '/storage/v1/object/memory-media': () => attempt === 1 ? json({ path: claim.media_paths[0] }, 503) : json([]),
    '/rest/v1/rpc/recycle_finalize': () => attempt === 2 ? json({ message: 'RECYCLE_STORAGE_REMAINS' }, 400) : json(true),
  });
  for (const expected of [0, 0, 1]) {
    assert.deepEqual(await (await handler(scheduled(cron))).json(), { queued: 1, deleted: expected, pending: 1 - expected });
  }
  assert.equal(calls.filter(call => call.path.endsWith('recycle_finalize')).length, 2);
});
