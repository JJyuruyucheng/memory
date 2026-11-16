import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../deploy/init.mjs';

async function freePort(port = 0) {
  const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const actual = server.address().port; await new Promise(resolve => server.close(resolve)); return actual;
}

async function eventually(callback, count = 100) {
  for (let index = 0; index < count; index++) { if (await callback()) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
  return false;
}

test('real startHosted subprocess: disabled CAPTCHA shell, private bootstrap, restart preservation, process shutdown', { skip: !process.env.MEMOS_BINARY, timeout: 90000 }, async () => {
  await freePort(5230); // Never terminate or reuse an unrelated local Memos process.
  const directory = await mkdtemp(join(tmpdir(), 'chaoxi-supervisor-test-')); const staticDir = join(directory, 'static');
  await mkdir(staticDir); await writeFile(join(staticDir, 'index.html'), '<!doctype html><html><body>Private login shell</body></html>');
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const password = crypto.randomUUID().slice(0, 6); const changedPassword = crypto.randomUUID().slice(0, 6);
  const env = { ...process.env, PUBLIC_ORIGIN: '', RENDER_EXTERNAL_URL: origin, PORT: String(port), STATIC_DIR: staticDir, MEMORY_DATA_DIR: join(directory, 'data'), MEMORY_SPACE: 'spaces/together', MEMORY_ADMIN_USERNAME: 'supervisor-admin', MEMORY_ADMIN_PASSWORD: `admin-${crypto.randomUUID()}`, MEMORY_MEMBER_ONE_USERNAME: 'supervisor-one', MEMORY_MEMBER_ONE_PASSWORD: password, MEMORY_MEMBER_TWO_USERNAME: 'supervisor-two', MEMORY_MEMBER_TWO_PASSWORD: crypto.randomUUID().slice(0, 6), TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' };
  const moduleURL = new URL('../deploy/hosted-start.mjs', import.meta.url).href;
  // Windows process.kill terminates Node without dispatching its signal handlers.
  // IPC dispatches the exact SIGINT/SIGTERM handlers only in this test wrapper.
  const wrapper = `import {startHosted} from ${JSON.stringify(moduleURL)}; process.on('message',signal=>process.emit(signal)); try {await startHosted();} catch {process.exitCode=1;} finally {if(process.connected)process.disconnect();}`;
  let child; let output = '';
  const start = childEnv => {
    child = spawn(process.execPath, ['--input-type=module', '-e', wrapper], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: childEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    child.on('error', () => {});
  };
  async function stop(signal) {
    if (!child || child.exitCode !== null) return;
    const exiting = new Promise(resolve => child.once('exit', resolve));
    if (process.platform === 'win32') child.send(signal); else child.kill(signal);
    await Promise.race([exiting, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('supervisor failed to stop its children')), 15000); timer.unref(); })]);
    assert.equal(await eventually(async () => { try { await fetch('http://127.0.0.1:5230/api/instance/profile', { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 30), true);
    assert.equal(await eventually(async () => { try { await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 30), true);
  }
  try {
    start(env);
    assert.equal(await eventually(async () => { if (child.exitCode !== null) return false; try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; } }), true, 'supervisor must start the official binary, initialize it, then expose the gateway');
    assert.equal((await fetch(origin)).status, 200);
    const config = await (await fetch(`${origin}/auth/config`)).json(); assert.equal(config.configured, false);
    const denied = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: env.MEMORY_MEMBER_ONE_USERNAME, password, captchaToken: 'test-token' }) });
    assert.equal(denied.status, 503);
    const original = createApiClient('http://127.0.0.1:5230');
    assert.equal((await original.login(env.MEMORY_MEMBER_ONE_USERNAME, password)).role, 'USER'); await original.logout();
    await stop('SIGINT');
    start({ ...env, MEMORY_MEMBER_ONE_PASSWORD: changedPassword });
    assert.equal(await eventually(async () => { try { return (await fetch(`${origin}/healthz`)).ok; } catch { return false; } }), true);
    const retained = createApiClient('http://127.0.0.1:5230');
    assert.equal((await retained.login(env.MEMORY_MEMBER_ONE_USERNAME, password)).role, 'USER'); await retained.logout();
    await assert.rejects(createApiClient('http://127.0.0.1:5230').login(env.MEMORY_MEMBER_ONE_USERNAME, changedPassword), /HTTP (400|401)/);
    await stop('SIGTERM');
    for (const secret of [env.MEMORY_ADMIN_PASSWORD, password, env.MEMORY_MEMBER_TWO_PASSWORD, changedPassword]) assert.ok(!output.includes(secret), 'initialization secrets must not appear in child logs');
    console.log('Verified actual startHosted + official Windows Memos + Node gateway subprocesses: login shell loads without CAPTCHA configuration, login is 503, restart preserves stored member passwords, SIGINT/SIGTERM handlers stop both servers. Windows signal dispatch uses test-only IPC; no production signal or authentication bypass was added.');
  } finally {
    await stop('SIGTERM');
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
});
