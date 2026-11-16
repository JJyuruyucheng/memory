#!/usr/bin/env node
/** The only public password endpoint. Memos continues to own password/session authentication. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,34}[A-Za-z0-9])?$/;
const TEST_KEY = /^[123]x0{10,}/i;
const CONNECT_REFRESH = '/memos.api.AuthService/RefreshToken';
const CONNECT_SIGNOUT = '/memos.api.AuthService/SignOut';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.json': 'application/json; charset=utf-8',
};
const HEADERS = {
  'Cache-Control': 'private, no-store', 'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const RESPONSE_HEADERS = new Set(['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'www-authenticate', 'retry-after', 'vary']);
const FORWARD_HEADERS = ['authorization', 'content-type', 'cookie', 'range', 'if-range', 'accept', 'connect-protocol-version'];

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const digest = value => createHash('sha256').update(value).digest('hex');

/** Fixed windows, bounded cardinality. Overflow rejects rather than evicting live limits. */
export function createMemoryRateLimitStore({ maxEntries = 5000 } = {}) {
  const records = new Map();
  return {
    consume(key, { limit, windowMs, now }) {
      for (const [id, value] of records) if (value.resetAt <= now) records.delete(id);
      let record = records.get(key);
      if (!record) {
        if (records.size >= maxEntries) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
        record = { count: 0, resetAt: now + windowMs }; records.set(key, record);
      }
      record.count += 1;
      return { allowed: record.count <= limit, retryAfter: Math.max(1, Math.ceil((record.resetAt - now) / 1000)) };
    },
  };
}

/** consume must be atomic in injected/shared stores. Only token SHA-256 digests are retained. */
export function createMemoryReplayStore({ maxEntries = 4096, now = Date.now } = {}) {
  const records = new Map();
  return {
    consume(key, expiresAt) {
      const time = now();
      for (const [id, expiry] of records) if (expiry <= time) records.delete(id);
      if (records.has(key) || records.size >= maxEntries) return false;
      records.set(key, expiresAt); return true;
    },
  };
}

function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_ORIGIN 必须是有效的 HTTPS origin。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('PUBLIC_ORIGIN 必须是 HTTPS origin；HTTP 仅可用于本机测试。');
  return url;
}

function pathname(requestUrl) {
  const raw = String(requestUrl || '/').split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new RequestError(400, '请求路径无效。'); }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)
    || decoded.split('/').some(part => part === '.' || part === '..')) throw new RequestError(400, '请求路径无效。');
  return decoded;
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const length = Number(request.headers['content-length']);
    if (Number.isFinite(length) && length > limit) { request.resume(); reject(new RequestError(413, '请求内容过大。')); return; }
    const chunks = []; let size = 0, settled = false;
    request.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) { settled = true; chunks.length = 0; reject(new RequestError(413, '请求内容过大。')); }
      else chunks.push(chunk);
    });
    request.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    request.on('aborted', () => { if (!settled) { settled = true; reject(new RequestError(400, '请求已中断。')); } });
    request.on('error', () => { if (!settled) { settled = true; reject(new RequestError(400, '无法读取请求。')); } });
  });
}

function send(response, status, data, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify(data);
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  response.end(body);
}

function cookies(headers) {
  return typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
}

/**
 * Returns an unbound node:http.Server. Injections are server-only, never browser config.
 * rateLimitStore.consume(key,{limit,windowMs,now}) -> {allowed,retryAfter}
 * tokenStore.consume(sha256Digest,expiresAtMilliseconds) -> boolean (atomic)
 * Memory defaults reset on process restart; use one instance or inject a shared atomic store.
 */
export function createGateway(options = {}) {
  const publicUrl = parseOrigin(options.publicOrigin);
  const origin = publicUrl.origin;
  const production = options.production !== false;
  const siteKey = String(options.siteKey || '').trim();
  const secretKey = String(options.secretKey || '').trim();
  const userList = Array.isArray(options.allowedUsers) ? options.allowedUsers : String(options.allowedUsers || '').split(',').map(value => value.trim()).filter(Boolean);
  const allowedUsers = new Set(userList);
  const validUsers = [2, 3].includes(allowedUsers.size) && allowedUsers.size === userList.length && [...allowedUsers].every(value => typeof value === 'string' && USERNAME.test(value));
  const configured = Boolean(siteKey && secretKey && validUsers && !(production && (TEST_KEY.test(siteKey) || TEST_KEY.test(secretKey))));
  const upstream = new URL(options.upstream || 'http://127.0.0.1:5230');
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error('MEMOS_UPSTREAM 必须是没有路径或账号信息的 HTTP(S) origin。');
  if (options.trustProxy) throw new Error('尚未核验平台可信代理边界，禁止启用 TRUST_PROXY；网关仅使用 socket 客户端地址。');
  const fetcher = options.fetch || globalThis.fetch;
  const now = options.now || Date.now;
  const rateStore = options.rateLimitStore || createMemoryRateLimitStore();
  const tokenStore = options.tokenStore || createMemoryReplayStore({ now });
  const limits = {
    global: { limit: 60, windowMs: 60000 }, ip: { limit: 12, windowMs: 60000 },
    account: { limit: 10, windowMs: 15 * 60000 }, ...options.rateLimits,
  };
  const staticDir = path.resolve(options.staticDir || path.join(ROOT, 'dist'));
  const verifyTimeoutMs = options.verifyTimeoutMs || 10000;
  const upstreamTimeoutMs = options.upstreamTimeoutMs || 45000;
  const loginError = () => new RequestError(401, '登录未通过，请检查信息并重新验证。');

  function requireOrigin(request) {
    if (request.headers.origin !== origin) throw new RequestError(403, '请求来源不受允许。');
  }

  async function rateLimit(request, username = '') {
    const time = now();
    // Never trust X-Forwarded-For/CF-Connecting-IP from an unverified proxy chain.
    const ip = request.socket.remoteAddress || 'unknown';
    const keys = [['global', 'login:global'], ['ip', `login:ip:${digest(ip)}`], ['account', `login:account:${digest(username.normalize('NFKC').toLowerCase())}`]];
    let retryAfter = 0;
    for (const [type, key] of keys) {
      const result = await rateStore.consume(key, { ...limits[type], now: time });
      if (!result?.allowed) retryAfter = Math.max(retryAfter, result?.retryAfter || 60);
    }
    if (retryAfter) throw Object.assign(new RequestError(429, '尝试次数较多，请稍后重试。'), { retryAfter });
  }

  async function fetchJson(url, init, timeoutMs, externalSignal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancel = () => controller.abort();
    externalSignal?.addEventListener('abort', cancel, { once: true });
    try {
      if (externalSignal?.aborted) throw new Error('cancelled');
      const response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new RequestError(503, '登录服务暂不可用，请稍后重试。');
      const data = await response.json();
      return { response, data };
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(503, '登录服务暂不可用，请稍后重试。');
    } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', cancel); }
  }

  async function performLogin(request, response, signal) {
    requireOrigin(request);
    if (!configured) throw new RequestError(503, '安全登录尚未配置完成，请联系维护者。');
    if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new RequestError(415, '请使用 JSON 提交登录信息。');
    let data;
    try { data = JSON.parse((await readBody(request, 16384)).toString('utf8')); }
    catch (error) { if (error instanceof RequestError) throw error; throw new RequestError(400, '登录请求格式无效。'); }
    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    await rateLimit(request, username.slice(0, 256));
    if (!USERNAME.test(username) || typeof data?.password !== 'string' || !data.password || data.password.length > 1024
      || typeof data?.captchaToken !== 'string' || !data.captchaToken || data.captchaToken.length > 2048) throw loginError();
    // Reserve before remote verification so parallel submits can never both reach Memos.
    if (!await tokenStore.consume(digest(data.captchaToken), now() + 6 * 60000)) throw loginError();
    const verified = await fetchJson(SITEVERIFY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: data.captchaToken }) }, verifyTimeoutMs, signal);
    if (!verified.response.ok) throw new RequestError(503, '登录服务暂不可用，请稍后重试。');
    if (verified.data.success !== true || verified.data.hostname !== publicUrl.hostname || verified.data.action !== 'login') throw loginError();
    // Account existence is never queried before CAPTCHA and never disclosed by response text.
    if (!allowedUsers.has(username)) throw loginError();
    const signedIn = await fetchJson(new URL('/memos.api.AuthService/SignIn', upstream), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', Host: publicUrl.host,
        Origin: origin, 'X-Forwarded-Proto': publicUrl.protocol.slice(0, -1), 'X-Forwarded-Host': publicUrl.host },
      body: JSON.stringify({ passwordCredentials: { username, password: data.password } }),
    }, upstreamTimeoutMs, signal);
    if (!signedIn.response.ok) { if (signedIn.response.status >= 500) throw new RequestError(503, '登录服务暂不可用，请稍后重试。'); throw loginError(); }
    if (typeof signedIn.data.accessToken !== 'string' || !signedIn.data.accessToken) throw new RequestError(503, '登录服务暂不可用，请稍后重试。');
    const setCookie = cookies(signedIn.response.headers);
    send(response, 200, signedIn.data, setCookie.length ? { 'Set-Cookie': setCookie } : {});
  }

  async function login(request, response) {
    const controller = new AbortController();
    const cancel = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', cancel);
    try { await performLogin(request, response, controller.signal); }
    finally { response.removeListener('close', cancel); }
  }

  async function proxy(request, response, route) {
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) throw new RequestError(405, '不支持这个请求方法。');
    if (!['GET', 'HEAD'].includes(request.method)) requireOrigin(request);
    const isSession = [CONNECT_REFRESH, CONNECT_SIGNOUT].includes(route);
    if (!isSession && !/^Bearer [^\s]{1,8192}$/i.test(request.headers.authorization || '')) throw new RequestError(401, '请先登录。');
    if (isSession && request.method !== 'POST') throw new RequestError(405, '不支持这个请求方法。');
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request, 4 * 1024 * 1024);
    const headers = { 'Accept-Encoding': 'identity', Host: publicUrl.host, 'X-Forwarded-Proto': publicUrl.protocol.slice(0, -1), 'X-Forwarded-Host': publicUrl.host };
    for (const name of FORWARD_HEADERS) if (request.headers[name]) headers[name] = request.headers[name];
    if (request.headers.origin) headers.Origin = request.headers.origin;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    const cancel = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', cancel);
    try {
      const search = new URL(request.url, origin).search;
      const upstreamResponse = await fetcher(new URL(`${route}${search}`, upstream), { method: request.method, headers, ...(body?.length ? { body } : {}), redirect: 'error', signal: controller.signal });
      const outgoing = { ...HEADERS };
      for (const [name, value] of upstreamResponse.headers) if (RESPONSE_HEADERS.has(name)) outgoing[name] = value;
      const setCookie = cookies(upstreamResponse.headers); if (setCookie.length) outgoing['Set-Cookie'] = setCookie;
      response.writeHead(upstreamResponse.status, outgoing);
      if (request.method === 'HEAD' || !upstreamResponse.body) response.end();
      else await pipeline(Readable.fromWeb(upstreamResponse.body), response);
    } catch {
      if (response.headersSent) response.destroy();
      else throw new RequestError(503, '记录服务暂不可用，请稍后重试。');
    } finally { clearTimeout(timeout); response.removeListener('close', cancel); }
  }

  async function staticFile(request, response, route) {
    if (!['GET', 'HEAD'].includes(request.method)) throw new RequestError(405, '不支持这个请求方法。');
    const extension = path.extname(route).toLowerCase();
    const allowed = route === '/' || route === '/index.html'
      || (route.startsWith('/src/') && ['.js', '.css'].includes(extension))
      || (route.startsWith('/assets/') && Boolean(MIME[extension]) && !['.html', '.js', '.css', '.json'].includes(extension))
      || route === '/assets/credits.json';
    if (!allowed || route.split('/').some(segment => segment.startsWith('.'))) throw new RequestError(404, '页面不存在。');
    const relative = route === '/' ? 'index.html' : route.slice(1);
    const file = path.resolve(staticDir, relative);
    if (!file.startsWith(staticDir + path.sep)) throw new RequestError(404, '页面不存在。');
    try {
      let current = staticDir;
      const rootInfo = await lstat(current);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error();
      for (const part of relative.split('/')) { current = path.join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error(); }
      const resolvedRoot = await realpath(staticDir);
      if (!(await realpath(file)).startsWith(resolvedRoot + path.sep) || !(await lstat(file)).isFile()) throw new Error();
    } catch { throw new RequestError(404, '页面不存在。'); }
    response.writeHead(200, { ...HEADERS, 'Content-Type': MIME[route === '/' ? '.html' : extension] });
    if (request.method === 'HEAD') response.end();
    else await pipeline(createReadStream(file), response);
  }

  const server = createServer(async (request, response) => {
    try {
      const route = pathname(request.url);
      const search = new URL(request.url, origin).searchParams;
      if ([...search.keys()].some(key => key.toLowerCase() === 'share_token') || /\/shares(?:\/|$)/i.test(route)) throw new RequestError(403, '此私密空间不开放分享链接。');
      if (route === '/auth/config' && request.method === 'GET') { send(response, 200, { configured, siteKey: configured ? siteKey : null, action: 'login' }); return; }
      if (route === '/auth/login' && request.method === 'POST') { await login(request, response); return; }
      if (route === '/healthz' && request.method === 'GET') { send(response, 200, { status: 'ok' }); return; }
      if (route.startsWith('/memos.api.')) {
        if (![CONNECT_REFRESH, CONNECT_SIGNOUT].includes(route)) throw new RequestError(403, '请从安全登录入口进入。');
        await proxy(request, response, route); return;
      }
      if (route.startsWith('/api/')) {
        if ((/^\/api\/(?:v1\/)?auth\//i.test(route) && route !== '/api/auth/me')
          || (/^\/api\/(?:v1\/)?users\/?$/i.test(route) && request.method === 'POST')) throw new RequestError(403, '请从安全登录入口进入。');
        await proxy(request, response, route); return;
      }
      if (route.startsWith('/file/')) { await proxy(request, response, route); return; }
      await staticFile(request, response, route);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else send(response, error instanceof RequestError ? error.status : 503,
        { error: error instanceof RequestError ? error.message : '服务暂不可用，请稍后重试。' }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 64;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效。');
    const server = createGateway({ publicOrigin: process.env.PUBLIC_ORIGIN, upstream: process.env.MEMOS_UPSTREAM,
      siteKey: process.env.TURNSTILE_SITE_KEY, secretKey: process.env.TURNSTILE_SECRET_KEY, allowedUsers: process.env.AUTH_ALLOWED_USERS,
      staticDir: process.env.STATIC_DIR, production: !['test', 'development'].includes(process.env.NODE_ENV), trustProxy: /^(true|1)$/i.test(process.env.TRUST_PROXY || '') });
    server.on('error', () => { console.error('安全网关无法启动，请检查端口及配置。'); process.exitCode = 1; });
    server.listen(port, process.env.LISTEN_HOST || '0.0.0.0', () => console.log(`安全网关已启动，端口 ${port}；不会记录登录凭据。`));
  } catch (error) { console.error(String(error.message || '网关配置无效。')); process.exitCode = 1; }
}
