import { createReadStream } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.json': 'application/json; charset=utf-8',
};
const SOURCE_EXTENSIONS = new Set(['.js', '.css']);
const SPA_ROUTES = new Set(['timeline', 'calendar', 'albums', 'album', 'stats', 'statistics', 'settings', 'admin', 'login', 'entry', 'memories', 'new']);
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

function fail(response, status) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(`${status} ${status === 404 ? 'Not Found' : status === 405 ? 'Method Not Allowed' : 'Bad Request'}\n`);
}

function safePathname(url) {
  const decoded = decodeURIComponent((url ?? '/').split('?')[0]);
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || /%[0-9a-f]{2}/i.test(decoded)) {
    throw new Error('Invalid path');
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((part) => part === '.' || part === '..')) throw new Error('Invalid path');
  return { decoded, segments };
}

async function isRegularUnlinkedFile(file, boundary) {
  const relative = path.relative(boundary, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let current = boundary;
  const base = await lstat(current);
  if (base.isSymbolicLink() || !base.isDirectory()) return false;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) return false;
  }
  const resolvedBoundary = await realpath(boundary);
  const resolvedFile = await realpath(file);
  if (!resolvedFile.startsWith(`${resolvedBoundary}${path.sep}`)) return false;
  return (await lstat(file)).isFile();
}

export async function startServer({ port = 5173, source = false } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口须为 1–65535 的整数。');
  const hasDist = await access(path.join(ROOT, 'dist', 'index.html')).then(() => true, () => false);
  const built = !source && hasDist;
  const base = built ? path.join(ROOT, 'dist') : ROOT;

  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      fail(response, 405);
      return;
    }
    try {
      let pathname;
      try { pathname = safePathname(request.url); } catch { fail(response, 400); return; }
      const { decoded, segments } = pathname;
      if (segments.some((segment) => segment.startsWith('.') || /^(?:config\.local|env)(?:[._-]|$)/i.test(segment)
        || /(?:^|[._-])(?:secret|credentials|private)(?:[._-]|$)/i.test(segment))) {
        fail(response, 404); return;
      }
      let boundary;
      let file;
      if (decoded === '/' || decoded === '/index.html'
        || (SPA_ROUTES.has(segments[0]) && segments.every((segment) => !segment.includes('.')))) {
        boundary = base;
        file = path.join(base, 'index.html');
      } else if (segments[0] === 'src' && segments.length > 1
        && SOURCE_EXTENSIONS.has(path.extname(decoded).toLowerCase())) {
        boundary = path.join(base, 'src');
        file = path.join(boundary, ...segments.slice(1));
      } else if (decoded === '/assets/credits.json') {
        boundary = built ? path.join(base, 'assets') : path.join(ROOT, 'public', 'assets');
        file = path.join(boundary, 'credits.json');
      } else if (segments[0] === 'assets' && segments.length > 1
        && MIME[path.extname(decoded).toLowerCase()] && !['.html', '.js', '.css', '.json'].includes(path.extname(decoded).toLowerCase())) {
        boundary = built ? path.join(base, 'assets') : path.join(ROOT, 'public', 'assets');
        file = path.join(boundary, ...segments.slice(1));
      } else {
        fail(response, 404); return;
      }
      if (!(await isRegularUnlinkedFile(file, boundary))) { fail(response, 404); return; }
      const info = await lstat(file);
      const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file).toLowerCase()], 'Accept-Ranges': 'bytes' };
      let start = 0;
      let end = info.size - 1;
      let status = 200;
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!match || (!match[1] && !match[2]) || info.size === 0) {
          response.writeHead(416, { ...SECURITY_HEADERS, 'Content-Range': `bytes */${info.size}` }); response.end(); return;
        }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] ? (match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size || Number(match[2]) === 0 && !match[1]) {
          response.writeHead(416, { ...SECURITY_HEADERS, 'Content-Range': `bytes */${info.size}` }); response.end(); return;
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = Math.max(0, end - start + 1);
      response.writeHead(status, headers);
      if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
      const stream = createReadStream(file, { start, end });
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) fail(response, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400);
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`本地 QA：http://127.0.0.1:${port}/ （${built ? 'dist 构建产物' : '源码白名单'}，仅本机可访问）`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let port = 5173;
  let source = false;
  let invalid = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') source = true;
    else if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i].startsWith('--port=')) port = Number(args[i].split('=')[1]);
    else invalid = true;
  }
  if (invalid) {
    console.error('用法：node scripts/serve.mjs [--source] [--port 5173]');
    process.exitCode = 1;
  } else {
    startServer({ port, source }).catch((error) => {
      console.error(`启动失败：${error.message}`);
      process.exitCode = 1;
    });
  }
}
