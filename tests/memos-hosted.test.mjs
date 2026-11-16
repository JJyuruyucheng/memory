import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapHosted, hostedConfig } from '../deploy/hosted-start.mjs';

const environment = () => ({ RENDER_EXTERNAL_URL: 'https://memory-example.onrender.com', MEMORY_ADMIN_USERNAME: 'maintenance', MEMORY_ADMIN_PASSWORD: `test-${crypto.randomUUID()}`, MEMORY_MEMBER_ONE_USERNAME: 'test-one', MEMORY_MEMBER_ONE_PASSWORD: crypto.randomUUID().slice(0, 6), MEMORY_MEMBER_TWO_USERNAME: 'test-two', MEMORY_MEMBER_TWO_PASSWORD: crypto.randomUUID().slice(0, 6) });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Render provides the default public origin; only explicit local HTTP is allowed', () => {
  const config = hostedConfig(environment()); assert.equal(config.publicOrigin, 'https://memory-example.onrender.com');
  assert.equal(config.siteKey, '', 'the shell may start before CAPTCHA is configured');
  assert.throws(() => hostedConfig({ ...environment(), PUBLIC_ORIGIN: 'http://public.example.com' }), /HTTPS/);
  assert.throws(() => hostedConfig({ ...environment(), PUBLIC_ORIGIN: 'https://example.com/path' }), /路径/);
});

test('all three identities are distinct and secrets have no default passwords', () => {
  assert.throws(() => hostedConfig({ ...environment(), MEMORY_MEMBER_ONE_PASSWORD: '' }), /Secret/);
  assert.throws(() => hostedConfig({ ...environment(), MEMORY_ADMIN_PASSWORD: 'short' }), /Secret/);
  assert.throws(() => hostedConfig({ ...environment(), MEMORY_MEMBER_TWO_USERNAME: 'test-one' }), /三个不同/);
});

test('an unmarked existing instance is never auto-reconfigured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaoxi-marker-test-'));
  try {
    const config = { ...hostedConfig(environment()), dataDir: directory }; const calls = [];
    const fetcher = async (url, options) => {
      const pathname = new URL(url).pathname; calls.push({ pathname, method: options.method });
      if (pathname === '/api/instance/profile') return json({ version: '26.11.1', needsSetup: false });
      if (pathname.endsWith('/SignIn')) return json({ accessToken: 'unit-test-token', user: { role: 'ADMIN' } });
      if (pathname === '/api/users') return json({ users: [{ username: 'unrelated-account', role: 'USER' }] });
      if (pathname.endsWith('/SignOut')) return json({});
      throw new Error('Unexpected write or read');
    };
    await assert.rejects(bootstrapHosted(config, fetcher), /不会自动覆盖/);
    assert.ok(calls.every(call => call.method === 'GET' || call.pathname.endsWith('/SignIn') || call.pathname.endsWith('/SignOut')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a complete marker with an empty database refuses accidental reinitialization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chaoxi-marker-test-'));
  try {
    await writeFile(join(directory, '.chaoxi-bootstrap-v1.json'), JSON.stringify({ format: 'chaoxi-bootstrap', version: 1, memosVersion: '26.11.1', status: 'complete' }));
    const config = { ...hostedConfig(environment()), dataDir: directory };
    await assert.rejects(bootstrapHosted(config, async () => json({ version: '26.11.1', needsSetup: true })), /禁止自动重建/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
