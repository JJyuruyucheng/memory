import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const checkProcess = promisify(execFile);
const SOURCE_EXTENSIONS = new Set(['.js', '.css']);
const ASSET_EXTENSIONS = new Set([
  '.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp',
  '.mp4', '.webm', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.ogg', '.wav',
]);
const REQUIRED_FILES = [
  'index.html', 'src/main.js', 'src/config.js', 'src/demo-provider.js',
  'src/memos-provider.js', 'src/domain.js', 'src/icons.js', 'src/sample-data.js',
  'src/style.css', 'src/components.css', 'public/assets/credits.json', 'public/assets/mark.svg',
];

function isSafeName(name) {
  return !name.startsWith('.') && !/(?:^|[._-])(?:secret|credentials|private)(?:[._-]|$)/i.test(name)
    && !/^(?:config\.local|env)(?:[._-]|$)/i.test(name);
}

async function copyWhitelistedDirectory(source, destination, extensions, root) {
  const directory = await lstat(source);
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error('构建源目录必须为真实目录，不能使用符号链接。');
  }
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!isSafeName(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`构建拒绝符号链接：${path.relative(root, from)}`);
    if (entry.isDirectory()) {
      await copyWhitelistedDirectory(from, to, extensions, root);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      await writeFile(to, await readFile(from));
    }
  }
}

async function requireFile(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`入口依赖不能超出源码目录：${relative}`);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    const item = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`缺少构建入口依赖：${relative}`);
      throw error;
    });
    if (item.isSymbolicLink()) throw new Error(`入口依赖不能使用符号链接：${relative}`);
  }
  if (!(await lstat(target)).isFile()) throw new Error(`入口依赖必须为普通文件：${relative}`);
  return target;
}

async function sourceFiles(root, directory = path.join(root, 'src')) {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('源码目录不能使用符号链接。');
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!isSafeName(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`构建拒绝符号链接：${path.relative(root, target)}`);
    if (entry.isDirectory()) result.push(...await sourceFiles(root, target));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(target);
  }
  return result;
}

async function preflight(root) {
  for (const relative of REQUIRED_FILES) await requireFile(root, relative);
  const files = await sourceFiles(root);
  for (const file of files.filter((name) => name.endsWith('.js'))) {
    try {
      await checkProcess(process.execPath, ['--check', file], { timeout: 15_000, maxBuffer: 256 * 1024 });
    } catch (error) {
      throw new Error(`JavaScript 语法检查失败：${path.relative(root, file)}\n${error.stderr?.trim() || error.message}`);
    }
    const content = await readFile(file, 'utf8');
    const imports = content.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g);
    for (const [, reference] of imports) {
      if (!reference.startsWith('.')) throw new Error(`浏览器模块只允许本地依赖：${reference}`);
      const imported = path.resolve(path.dirname(file), reference);
      const relative = path.relative(root, imported);
      if (!relative.startsWith(`src${path.sep}`) || path.extname(imported) !== '.js') {
        throw new Error(`模块依赖不在源码白名单中：${reference}`);
      }
      await requireFile(root, relative);
    }
  }
  for (const file of files.filter((name) => name.endsWith('.css'))) {
    const content = await readFile(file, 'utf8');
    for (const [, reference] of content.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
      const imported = path.resolve(path.dirname(file), reference);
      const relative = path.relative(root, imported);
      if (!reference.startsWith('.') || !relative.startsWith(`src${path.sep}`) || path.extname(imported) !== '.css') {
        throw new Error(`样式依赖不在源码白名单中：${reference}`);
      }
      await requireFile(root, relative);
    }
  }
  let credits;
  try { credits = JSON.parse(await readFile(path.join(root, 'public', 'assets', 'credits.json'), 'utf8')); }
  catch { throw new Error('assets/credits.json 必须为有效 JSON。'); }
  if (!Array.isArray(credits) || credits.length === 0) throw new Error('素材署名清单必须为非空数组。');
  for (const credit of credits) {
    if (!credit || !['file', 'title', 'author', 'license', 'source', 'changes'].every((key) => typeof credit[key] === 'string' && credit[key].trim())
      || !isSafeName(credit.file) || path.basename(credit.file) !== credit.file || credit.file.includes('\\')
      || !ASSET_EXTENSIONS.has(path.extname(credit.file).toLowerCase()) || !/^https?:\/\//.test(credit.source)) {
      throw new Error('素材署名清单缺少字段或引用了非白名单媒体。');
    }
    await requireFile(root, path.join('public', 'assets', credit.file));
  }
}

// Tests may build an isolated fixture or a new temporary output. Existing custom
// outputs are never recursively deleted; only this source root's own dist is replaceable.
export async function build({ rootDir = ROOT, outDir, env = process.env, quiet = false } = {}) {
  const root = path.resolve(rootDir);
  const dist = path.resolve(outDir ?? path.join(root, 'dist'));
  const defaultOutput = path.join(root, 'dist');
  const mode = env.MEMORY_MODE ?? 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('MEMORY_MODE 只能为 demo 或 live。');
  const space = mode === 'live' ? (env.MEMORY_SPACE ?? '').trim() : '';
  if (mode === 'live' && !/^spaces\/[A-Za-z0-9_-]+$/.test(space)) {
    throw new Error('live 构建必须指定 MEMORY_SPACE=spaces/<id>，例如 spaces/our-story。');
  }
  if (env.MEMORY_TARGET === 'pages' && mode !== 'demo') {
    throw new Error('GitHub Pages 只允许发布 demo 模式。');
  }

  // Validate before touching a previous build, so failed source checks preserve it.
  await preflight(root);
  const resolvedRoot = await realpath(root);
  const resolvedParent = await realpath(path.dirname(dist));
  const canonicalOutput = path.join(resolvedParent, path.basename(dist));
  const sourceRelative = path.relative(canonicalOutput, resolvedRoot);
  if (!sourceRelative || (!sourceRelative.startsWith('..') && !path.isAbsolute(sourceRelative))
    || ['src', 'public', 'scripts', 'tests', 'docs', 'deploy', '.git'].some((name) => {
      const protectedPath = path.join(resolvedRoot, name);
      return canonicalOutput === protectedPath || canonicalOutput.startsWith(`${protectedPath}${path.sep}`);
    })) {
    throw new Error('构建输出不能覆盖源码目录或其上层目录。');
  }
  const previous = await lstat(dist).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous?.isSymbolicLink()) throw new Error('构建输出不能是符号链接。');
  if (previous && dist !== defaultOutput) throw new Error('自定义构建输出必须为尚不存在的目录。');
  if (previous && path.dirname(await realpath(dist)) !== resolvedRoot) {
    throw new Error('构建输出不能位于项目之外。');
  }
  if (previous) await rm(dist, { recursive: true });
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), await readFile(path.join(root, 'index.html')));
  await copyWhitelistedDirectory(path.join(root, 'src'), path.join(dist, 'src'), SOURCE_EXTENSIONS, root);
  await copyWhitelistedDirectory(path.join(root, 'public', 'assets'), path.join(dist, 'assets'), ASSET_EXTENSIONS, root);
  // This one attribution manifest is the only JSON allowed into the static site.
  await writeFile(path.join(dist, 'assets', 'credits.json'), await readFile(path.join(root, 'public', 'assets', 'credits.json')));

  // Explicit values prevent build-time secrets or an arbitrary API URL entering the bundle.
  const config = {
    mode,
    apiBase: '',
    space,
    maxImages: 9,
    maxFileBytes: 50 * 1024 * 1024,
    timeZone: 'Asia/Shanghai',
  };
  await writeFile(path.join(dist, 'src', 'config.js'),
    `export const CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`);
  if (!quiet) console.log(`已构建 ${path.relative(root, dist)}：${mode} 模式${space ? `，空间 ${space}` : '，仅含演示数据'}。`);
  return { outDir: dist, mode, space };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((error) => {
    console.error(`构建失败：${error.message}`);
    process.exitCode = 1;
  });
}
