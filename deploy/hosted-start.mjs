#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, chown, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApiClient, initialize } from './init.mjs';

const VERSION = '26.11.1';
const MARKER_NAME = '.chaoxi-bootstrap-v1.json';
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,34}[A-Za-z0-9])?$/;

export function hostedConfig(env = process.env) {
  const origin = new URL(env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || '');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) throw new Error('PUBLIC_ORIGIN 必须为 HTTPS origin，本机验证才可使用 HTTP。');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('PUBLIC_ORIGIN 不允许路径、查询或账号信息。');
  const space = env.MEMORY_SPACE || 'spaces/together';
  if (!/^spaces\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,34}[A-Za-z0-9])?$/.test(space)) throw new Error('MEMORY_SPACE 无效。');
  const admin = { username: env.MEMORY_ADMIN_USERNAME || 'memory-admin', name: '管理员', password: env.MEMORY_ADMIN_PASSWORD };
  const members = [{ username: env.MEMORY_MEMBER_ONE_USERNAME, name: env.MEMORY_MEMBER_ONE_USERNAME, password: env.MEMORY_MEMBER_ONE_PASSWORD }, { username: env.MEMORY_MEMBER_TWO_USERNAME, name: env.MEMORY_MEMBER_TWO_USERNAME, password: env.MEMORY_MEMBER_TWO_PASSWORD }];
  const accounts = [admin, ...members];
  if (accounts.some(account => !USERNAME.test(account.username || '')) || new Set(accounts.map(account => account.username)).size !== 3) throw new Error('需要三个不同且格式有效的账号名称。');
  if (typeof admin.password !== 'string' || admin.password.length < 12 || members.some(account => typeof account.password !== 'string' || account.password.length < 6)) throw new Error('平台 Secret 未完整配置：管理员至少 12 位，日常初始口令至少 6 位。');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须为 1024—65535 之间的整数。');
  return {
    publicOrigin: origin.origin, space, admin, members, port,
    dataDir: resolve(env.MEMORY_DATA_DIR || '/var/opt/memos'), staticDir: resolve(env.STATIC_DIR || '/app/dist'),
    memosBinary: env.MEMOS_BINARY || '/usr/local/bin/memos', memosOrigin: 'http://127.0.0.1:5230',
    siteKey: env.TURNSTILE_SITE_KEY || '', secretKey: env.TURNSTILE_SECRET_KEY || '',
  };
}

async function markerAt(dataDir) {
  try {
    const marker = JSON.parse(await readFile(join(dataDir, MARKER_NAME), 'utf8'));
    if (marker.format !== 'chaoxi-bootstrap' || marker.version !== 1 || marker.memosVersion !== VERSION || !['pending', 'complete'].includes(marker.status)) throw new Error('Invalid marker');
    return marker;
  } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('初始化状态文件损坏或不受支持；已停止，不会自动改账号。'); }
}

async function writeMarker(config, status) {
  const filename = join(config.dataDir, MARKER_NAME); const pending = `${filename}.${crypto.randomUUID()}.tmp`;
  // Only deployment state/version, never account names, passwords, tokens, or keys.
  await writeFile(pending, JSON.stringify({ format: 'chaoxi-bootstrap', version: 1, memosVersion: VERSION, status }), { mode: 0o600 });
  await rename(pending, filename);
}

async function verifyUsers(api, config, partial = false) {
  const result = await api.call('/api/users?pageSize=1000');
  if (result.nextPageToken) throw new Error('账号数量超出本双人实例的范围。');
  const expected = new Map([[config.admin.username, 'ADMIN'], ...config.members.map(account => [account.username, 'USER'])]);
  const users = result.users || [];
  if ((!partial && users.length !== 3) || users.length > 3 || users.some(user => expected.get(user.username) !== user.role)) throw new Error('已有账号或权限与部署配置不一致；不会自动覆盖、删除或降级。');
}

export async function verifyHostedInstance(config, fetcher = fetch) {
  const api = createApiClient(config.memosOrigin, fetcher);
  try {
    const profile = await api.call('/api/instance/profile');
    if (profile.version !== VERSION || profile.needsSetup) throw new Error('Memos 版本或初始化状态不正确。');
    const admin = await api.login(config.admin.username, config.admin.password);
    if (admin.role !== 'ADMIN') throw new Error('独立管理员身份验证失败。');
    await verifyUsers(api, config);
    const general = await api.call('/api/instance/settings/GENERAL');
    const access = await api.call('/api/instance/settings/ACCESS');
    if (general.generalSetting?.disallowUserRegistration !== true || general.generalSetting?.disallowPasswordAuth === true || general.generalSetting?.disallowChangeUsername !== true || access.accessSetting?.accessMode !== 'INSTANCE_ACCESS_MODE_PRIVATE') throw new Error('已有实例的注册、登录或私密设置不符合要求；已停止，不会自动改配置。');
    const space = await api.call(`/api/${config.space}`);
    if (space.currentUserRole !== 'ADMIN') throw new Error('独立管理员不具有目标空间管理权限。');
    const result = await api.call(`/api/${config.space}/members?pageSize=100`);
    const roles = new Map([[`users/${config.admin.username}`, 'ADMIN'], ...config.members.map(account => [`users/${account.username}`, 'USER'])]);
    const members = result.spaceMembers || [];
    if (members.length !== 3 || result.nextPageToken || members.some(member => roles.get(member.user) !== member.role)) throw new Error('空间成员与预期不一致；不会自动修改已有成员。');
  } finally { await api.logout(); }
}

export async function bootstrapHosted(config, fetcher = fetch) {
  await mkdir(config.dataDir, { recursive: true });
  const marker = await markerAt(config.dataDir);
  const api = createApiClient(config.memosOrigin, fetcher);
  const profile = await api.call('/api/instance/profile');
  if (profile.version !== VERSION) throw new Error('此部署只验证了 Memos 26.11.1。');
  if (profile.needsSetup) {
    if (marker?.status === 'complete') throw new Error('已有完成标记但数据库为空；禁止自动重建，请恢复完整备份。');
    await writeMarker(config, 'pending');
  } else if (!marker || marker.status === 'complete') {
    // Existing instances without our pending marker are read/verified only.
    await verifyHostedInstance(config, fetcher);
    if (!marker) await writeMarker(config, 'complete');
    return;
  }
  if (!profile.needsSetup) {
    // Resume only this supervisor's interrupted first initialization. No unrelated account may exist.
    try { await api.login(config.admin.username, config.admin.password); await verifyUsers(api, config, true); }
    finally { await api.logout(); }
  }
  await initialize({ base: config.memosOrigin, admin: config.admin, members: config.members, spaceId: config.space.slice(7), title: '朝夕' }, fetcher);
  await verifyHostedInstance(config, fetcher);
  await writeMarker(config, 'complete');
}

function minimalEnvironment(env) {
  return Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}

export async function startHosted(env = process.env) {
  const config = hostedConfig(env);
  await mkdir(config.dataDir, { recursive: true });
  // Alpine node user is UID/GID 1000; do not run either network server as root.
  const identity = process.getuid?.() === 0 ? { uid: 1000, gid: 1000 } : {};
  if (identity.uid !== undefined) await chown(config.dataDir, identity.uid, identity.gid);
  const children = new Set(); let stopping = false; let fatal; let stopPromise;
  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    stopPromise = Promise.all([...children].map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolveExit => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit(); }, 10000); timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolveExit(); });
    })));
    return stopPromise;
  }
  const signal = () => { stop().then(() => { process.exitCode = 0; }); };
  process.once('SIGTERM', signal); process.once('SIGINT', signal);
  function launch(file, args, childEnv, label) {
    const child = spawn(file, args, { ...identity, env: childEnv, stdio: 'ignore', windowsHide: true });
    children.add(child);
    child.once('error', () => { fatal = new Error(`${label} 无法启动。`); void stop(); });
    child.once('exit', (code, childSignal) => {
      children.delete(child);
      if (!stopping) { fatal = new Error(`${label} 意外停止（${Number.isInteger(code) ? code : childSignal || '未知状态'}），已同时停止其他进程。`); void stop(); }
    });
    return child;
  }
  try {
    const safeEnv = minimalEnvironment(env);
    launch(config.memosBinary, ['--addr', '127.0.0.1', '--port', '5230', '--data', config.dataDir, '--instance-url', config.publicOrigin, '--config-apply', 'off', '--trusted-proxies', '127.0.0.1/32,::1/128'], { ...safeEnv, TZ: 'Asia/Shanghai' }, 'Memos');
    let ready = false;
    for (let index = 0; index < 120; index++) {
      if (fatal || stopping) throw fatal || new Error('启动已取消。');
      try { if ((await fetch(`${config.memosOrigin}/api/instance/profile`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
    if (!ready) throw new Error('Memos 未能在启动时限内就绪。');
    await bootstrapHosted(config);
    if (fatal || stopping) throw fatal || new Error('启动已取消。');
    console.log('Memos 私密实例和初始化状态已核验；准备启动唯一公开网关。');
    if (!config.siteKey || !config.secretKey) console.log('Turnstile 尚未配置：可打开登录页取得托管域名，所有登录请求仍将拒绝。');
    launch(process.execPath, [resolve('deploy/auth-gateway.mjs')], {
      ...safeEnv, NODE_ENV: 'production', TZ: 'Asia/Shanghai', PORT: String(config.port), PUBLIC_ORIGIN: config.publicOrigin,
      MEMOS_UPSTREAM: config.memosOrigin, STATIC_DIR: config.staticDir,
      TURNSTILE_SITE_KEY: config.siteKey, TURNSTILE_SECRET_KEY: config.secretKey,
      AUTH_ALLOWED_USERS: [config.members[0].username, config.members[1].username, config.admin.username].join(','),
    }, '认证网关');
    await new Promise(resolveExit => { const poll = setInterval(() => { if (stopping || fatal) { clearInterval(poll); resolveExit(); } }, 200); });
    await stop(); if (fatal) throw fatal;
  } catch (error) { await stop(); throw error; }
  finally { process.removeListener('SIGTERM', signal); process.removeListener('SIGINT', signal); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startHosted().catch(error => {
  // Native server streams and raw responses are never mirrored into platform logs.
  const safe = error?.message && !String(error.message).includes('http') ? String(error.message).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240) : '服务启动验证失败。';
  console.error(`${safe} 已保持关闭；请核对平台 Secrets、卷、版本和初始化状态。未输出口令或密钥。`); process.exitCode = 1;
});
