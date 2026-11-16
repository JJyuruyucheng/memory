#!/usr/bin/env node
// Run from a trusted terminal. Passwords are read from stdin without echo or logs.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { encodeSpaceSettings } from '../src/memos-provider.js';
import { dayKey } from '../src/domain.js';

export function createApiClient(base, fetcher = fetch) {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('服务地址必须是一个不带账号或路径的 HTTP(S) origin。');
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('远程初始化必须使用 HTTPS；HTTP 仅限本机。');
  let token = ''; let cookie = '';
  return {
    async call(path, { method = 'GET', body, missing = false } = {}) {
      const response = await fetcher(new URL(path, origin), { method, redirect: 'error', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
      if (missing && response.status === 404) return null;
      if (!response.ok) throw new Error(`Memos ${method} ${path.split('?')[0]} 失败（HTTP ${response.status}）；未打印响应以保护凭据。`);
      if (response.status === 204) return {};
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('接口返回了网页，请检查 /api/ 反向代理。');
      return response.json();
    },
    async login(username, password) {
      const result = await this.call('/memos.api.AuthService/SignIn', { method: 'POST', body: { passwordCredentials: { username, password } } });
      if (!result.accessToken) throw new Error('Memos 未返回访问令牌。'); token = result.accessToken; return result.user;
    },
    async logout() { if (token) { try { await this.call('/memos.api.AuthService/SignOut', { method: 'POST', body: {} }); } finally { token = ''; cookie = ''; } } },
  };
}

export async function initialize({ base, admin, members, spaceId = 'together', title = '朝夕', startDate = '' }, fetcher = fetch) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,34}[A-Za-z0-9])?$/.test(spaceId)) throw new Error('Space ID 需要 1—36 位英文字母、数字或中间的连字符。');
  if (typeof title !== 'string' || !title.trim() || title.length > 60 || (startDate && dayKey(startDate) !== startDate)) throw new Error('空间名称需要 1—60 个字符，开始日期需要为真实日期。');
  const accounts = [admin, ...members];
  if (members.length !== 2 || new Set(accounts.map(account => account.username)).size !== 3) throw new Error('需要三个不同账号：一个管理员和两个日常账号。');
  for (const account of accounts) if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,34}[A-Za-z0-9])?$/.test(account.username) || typeof account.password !== 'string' || account.password.length < 12) throw new Error('账号格式无效或密码少于 12 个字符。');
  const api = createApiClient(base, fetcher);
  try {
    const profile = await api.call('/api/instance/profile');
    if (profile.version !== '26.11.1') throw new Error(`此脚本核验版本为 26.11.1，当前服务版本是 ${profile.version || '未知'}。`);
    if (profile.needsSetup) await api.call('/api/users', { method: 'POST', body: { username: admin.username, displayName: admin.name || '管理员', password: admin.password, role: 'ADMIN' } });
    const account = await api.login(admin.username, admin.password);
    if (account.role !== 'ADMIN') throw new Error('提供的管理账号不具有 Memos ADMIN 角色。');
    const general = await api.call('/api/instance/settings/GENERAL');
    await api.call('/api/instance/settings/GENERAL', { method: 'PATCH', body: { name: 'instance/settings/GENERAL', generalSetting: { ...general.generalSetting, disallowUserRegistration: true, disallowPasswordAuth: false, disallowChangeUsername: true } } });
    await api.call('/api/instance/settings/ACCESS', { method: 'PATCH', body: { name: 'instance/settings/ACCESS', accessSetting: { accessMode: 'INSTANCE_ACCESS_MODE_PRIVATE' } } });
    const name = `spaces/${spaceId}`;
    let space = await api.call(`/api/${name}`, { missing: true });
    if (!space) space = await api.call(`/api/spaces?spaceId=${encodeURIComponent(spaceId)}`, { method: 'POST', body: { title, description: encodeSpaceSettings({ spaceName: title, subtitle: '把我们的日子，一页页留下来。', startDate, anniversaries: [] }) } });
    for (const member of members) {
      let existing = await api.call(`/api/users/${encodeURIComponent(member.username)}`, { missing: true });
      if (!existing) existing = await api.call('/api/users', { method: 'POST', body: { username: member.username, displayName: member.name || member.username, password: member.password, role: 'USER' } });
      if (existing.role !== 'USER') throw new Error('日常账号已有管理员角色，请先在原生管理界面核对，脚本不会自动降权。');
      const membership = await api.call(`/api/${name}/members/${encodeURIComponent(member.username)}`, { missing: true });
      const participant = createApiClient(base, fetcher);
      try {
        await participant.login(member.username, member.password);
        if (!membership) {
        const invitation = await api.call(`/api/${name}/invitations`, { method: 'POST', body: { invitee: existing.name, role: 'USER' } });
          await participant.call(`/api/${invitation.name}:accept`, { method: 'POST', body: {} });
        }
      } finally { await participant.logout(); }
    }
    const memberList = await api.call(`/api/${name}/members?pageSize=100`);
    if ((memberList.spaceMembers || []).length !== 3) throw new Error('空间成员数不是三个，请在原生后台核对后再开放网站。');
    const access = await api.call('/api/instance/settings/ACCESS');
    const finalGeneral = await api.call('/api/instance/settings/GENERAL');
    if (access.accessSetting?.accessMode !== 'INSTANCE_ACCESS_MODE_PRIVATE' || finalGeneral.generalSetting?.disallowUserRegistration !== true) throw new Error('私密访问或关闭注册未生效，请勿开放公网。');
    return { space: name, members: memberList.spaceMembers.map(value => value.user), privateAccess: true, registrationClosed: true };
  } finally { await api.logout(); }
}

async function main() {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) stdout.write(chunk, encoding); callback(); } });
  const reader = createInterface({ input: stdin, output, terminal: Boolean(stdin.isTTY) });
  const lines = reader[Symbol.asyncIterator]();
  async function ask(label, { secret = false, fallback = '' } = {}) {
    stdout.write(label); muted = secret;
    const result = await lines.next(); muted = false;
    if (secret) stdout.write('\n');
    if (result.done) throw new Error('标准输入提前结束，初始化未完成。');
    return result.value || fallback;
  }
  async function account(label) {
    const username = (await ask(`${label}登录名（英文字母、数字、连字符）：`)).trim();
    const name = await ask(`${label}显示名称：`, { fallback: username });
    const password = await ask(`${label}密码（至少 12 位，不回显）：`, { secret: true });
    const confirm = await ask('再次输入密码：', { secret: true });
    if (password !== confirm) throw new Error('两次密码不一致。');
    return { username, name, password };
  }
  try {
    const base = await ask('同源服务地址 [http://127.0.0.1:8080]：', { fallback: 'http://127.0.0.1:8080' });
    const spaceId = await ask('Space ID [together]：', { fallback: 'together' });
    const title = await ask('空间名称 [朝夕]：', { fallback: '朝夕' });
    const startDate = await ask('在一起的日期（YYYY-MM-DD，可留空）：');
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('日期格式无效。');
    const admin = await account('管理员'); const first = await account('日常账号一'); const second = await account('日常账号二');
    const result = await initialize({ base, admin, members: [first, second], spaceId, title, startDate });
    stdout.write(`初始化完成：${result.space}，三个账号，已关闭注册并启用私密访问。\n请确认构建参数 MEMORY_SPACE=${result.space}。\n`);
  } finally { reader.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(`初始化未完成：${String(error.message || '未知错误').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)}\n已停止，未输出凭据；已有数据不会自动删除，请修正后重试。`); process.exitCode = 1; });
