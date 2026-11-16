import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DEMO = { MEMORY_MODE: 'demo', MEMORY_SPACE: '' };

test('Supabase 构建仅发送公共配置，验证 SDK 完整性，默认关闭登录并排除演示资料', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'memory-build-'));
  const fixture = path.join(temporary, 'source');
  await mkdir(fixture);
  try {
    for (const directory of ['src', 'public', 'vendor']) await cp(path.join(ROOT, directory), path.join(fixture, directory), { recursive: true });
    await cp(path.join(ROOT, 'index.html'), path.join(fixture, 'index.html'));
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    const env = {
      MEMORY_MODE: 'supabase', MEMORY_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      MEMORY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz123456',
      SERVICE_ROLE_KEY: 'must-not-ship', TURNSTILE_SECRET: 'must-not-ship',
    };
    const output = path.join(temporary, 'cloudflare');
    await build({ rootDir: fixture, outDir: output, env, quiet: true });
    const config = await readFile(path.join(output, 'src', 'config.js'), 'utf8');
    assert.match(config, /"authReady": false/);
    assert.match(config, /"maxFileBytes": 50000000/);
    assert.ok(!config.includes('must-not-ship'));
    const files = await readdir(output, { recursive: true });
    assert.ok(files.includes(path.join('assets', 'supabase-client-2.119.0.js')));
    assert.ok(files.includes(path.join('assets', 'sortable-1.15.7.js')));
    assert.ok(files.includes(path.join('assets', 'SORTABLE-LICENSE.txt')));
    assert.ok(files.includes(path.join('src', 'boot.js')));
    assert.ok(!files.includes(path.join('assets', 'photo-coffee.jpg')));
    assert.ok(!files.includes(path.join('src', 'sample-data.js')));
    const headers = await readFile(path.join(output, '_headers'), 'utf8');
    assert.match(headers, /connect-src 'self' https:\/\/challenges\.cloudflare\.com https:\/\/abcdefghijklmnopqrst\.supabase\.co;/);
    assert.ok(!headers.includes('unsafe-eval'));
    await assert.rejects(build({ rootDir: fixture, env: { ...env, MEMORY_TARGET: 'pages' }, quiet: true }), /Pages 只允许/);
    await assert.rejects(build({ rootDir: fixture, env: { ...env, MEMORY_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_wrong' }, quiet: true }), /publishable/);
    await assert.rejects(build({ rootDir: fixture, env: { ...env, MEMORY_AUTH_READY: 'true', MEMORY_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }, quiet: true }), /不能使用测试密钥/);
    await mkdir(path.join(fixture, 'dist'));
    await writeFile(path.join(fixture, 'dist', 'keep.txt'), 'last-good-build');
    const sortableFile = path.join(fixture, 'public', 'assets', 'sortable-1.15.7.js');
    const sortableBytes = await readFile(sortableFile);
    await writeFile(sortableFile, 'tampered');
    await assert.rejects(build({ rootDir: fixture, env, quiet: true }), /排序组件完整性检查失败/);
    assert.equal(await readFile(path.join(fixture, 'dist', 'keep.txt'), 'utf8'), 'last-good-build');
    await writeFile(sortableFile, sortableBytes);
    await writeFile(path.join(fixture, 'public', 'assets', 'supabase-client-2.119.0.js'), 'tampered');
    await assert.rejects(build({ rootDir: fixture, env, quiet: true }), /完整性检查失败/);
    assert.equal(await readFile(path.join(fixture, 'dist', 'keep.txt'), 'utf8'), 'last-good-build');
  } finally {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('memory-build-'));
    await rm(temporary, { recursive: true, force: true });
  }
});

test('构建保留素材授权、限制 JSON，并在坏入口覆盖旧产物前拒绝', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'memory-build-'));
  const fixture = path.join(temporary, 'source');
  await mkdir(fixture);
  try {
    // Copy only the build inputs: no .git, real data or deployment secrets.
    await cp(path.join(ROOT, 'src'), path.join(fixture, 'src'), { recursive: true });
    await cp(path.join(ROOT, 'public'), path.join(fixture, 'public'), { recursive: true });
    await cp(path.join(ROOT, 'index.html'), path.join(fixture, 'index.html'));
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(fixture, 'public', 'assets', 'metadata.json'), '{"token":"must-not-ship"}');
    await writeFile(path.join(fixture, 'src', '.env'), 'SECRET=must-not-ship');

    const output = path.join(temporary, 'public-demo');
    await build({ rootDir: fixture, outDir: output, env: DEMO, quiet: true });
    const credits = await readFile(path.join(output, 'assets', 'credits.json'), 'utf8');
    assert.equal(credits, await readFile(path.join(fixture, 'public', 'assets', 'credits.json'), 'utf8'));
    for (const credit of JSON.parse(credits)) assert.ok((await readFile(path.join(output, 'assets', credit.file))).length > 0);
    assert.equal(await readFile(path.join(output, 'src', 'components.css'), 'utf8'), await readFile(path.join(fixture, 'src', 'components.css'), 'utf8'));
    const files = await readdir(output, { recursive: true });
    assert.deepEqual(files.filter((file) => file.endsWith('.json')), [path.join('assets', 'credits.json')]);
    assert.ok(files.every((file) => !file.includes('.env')));
    assert.match(await readFile(path.join(output, 'src', 'config.js'), 'utf8'), /"mode": "demo"/);

    // An invalid source must fail before deleting a prior, otherwise valid dist.
    const previous = path.join(fixture, 'dist');
    await mkdir(previous);
    await writeFile(path.join(previous, 'keep.txt'), 'last-good-build');
    const main = await readFile(path.join(fixture, 'src', 'main.js'), 'utf8');
    await writeFile(path.join(fixture, 'src', 'main.js'), 'export const broken = ;');
    await assert.rejects(build({ rootDir: fixture, env: DEMO, quiet: true }), /JavaScript 语法检查失败.*main\.js/);
    assert.equal(await readFile(path.join(previous, 'keep.txt'), 'utf8'), 'last-good-build');
    await writeFile(path.join(fixture, 'src', 'main.js'), main);
    const optional = path.join(fixture, 'src', 'unreferenced.js');
    await writeFile(optional, 'export const broken = ;');
    await assert.rejects(build({ rootDir: fixture, env: DEMO, quiet: true }), /JavaScript 语法检查失败.*unreferenced\.js/);
    await rm(optional);

    for (const required of ['src/boot.js', 'src/main.js', 'src/demo-provider.js', 'src/memos-provider.js', 'src/components.css', 'public/assets/credits.json']) {
      const file = path.join(fixture, required);
      const content = await readFile(file);
      await rm(file);
      await assert.rejects(build({ rootDir: fixture, env: DEMO, quiet: true }), /缺少构建入口依赖/);
      assert.equal(await readFile(path.join(previous, 'keep.txt'), 'utf8'), 'last-good-build');
      await writeFile(file, content);
    }

    await writeFile(path.join(fixture, 'src', 'main.js'), `${main}\nimport './missing-import.js';\n`);
    await assert.rejects(build({ rootDir: fixture, env: DEMO, quiet: true }), /缺少构建入口依赖.*missing-import\.js/);
    await writeFile(path.join(fixture, 'src', 'main.js'), main);
    const manifest = path.join(fixture, 'public', 'assets', 'credits.json');
    const validManifest = await readFile(manifest);
    await writeFile(manifest, '{invalid JSON');
    await assert.rejects(build({ rootDir: fixture, env: DEMO, quiet: true }), /credits\.json 必须为有效 JSON/);
    await writeFile(manifest, validManifest);
    await assert.rejects(build({ rootDir: fixture, env: { MEMORY_MODE: 'live' }, quiet: true }), /MEMORY_SPACE/);
    await assert.rejects(build({ rootDir: fixture, env: { ...DEMO, MEMORY_TARGET: 'pages' }, quiet: true }), /Pages 只允许.*preview/);
    await assert.rejects(build({ rootDir: fixture, env: { MEMORY_MODE: 'live', MEMORY_SPACE: 'spaces/test', MEMORY_TARGET: 'pages' }, quiet: true }), /Pages 只允许/);
  } finally {
    // The resolved target is the exact mkdtemp directory created by this test.
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('memory-build-'));
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Pages 仅接受 preview；preview/live 在复制阶段排除演示模块和四张样例照片', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'memory-build-'));
  const fixture = path.join(temporary, 'source');
  await mkdir(fixture);
  try {
    await cp(path.join(ROOT, 'src'), path.join(fixture, 'src'), { recursive: true });
    await cp(path.join(ROOT, 'public'), path.join(fixture, 'public'), { recursive: true });
    await cp(path.join(ROOT, 'index.html'), path.join(fixture, 'index.html'));
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    // The fixture isolates packaging policy from the UI's independent login tests.
    await writeFile(path.join(fixture, 'src', 'login-controller.js'), 'export const loginFixture = true;\n');
    const main = `import { CONFIG } from './config.js';\nimport './login-controller.js';\nif (CONFIG.mode === 'demo') await import('./demo-provider.js');\nif (CONFIG.mode === 'live') await import('./memos-provider.js');\n`;
    await writeFile(path.join(fixture, 'src', 'main.js'), main);

    for (const mode of ['preview', 'live']) {
      const output = path.join(temporary, mode);
      await build({ rootDir: fixture, outDir: output, env: { MEMORY_MODE: mode, MEMORY_SPACE: 'spaces/test', ...(mode === 'preview' ? { MEMORY_TARGET: 'pages' } : {}) }, quiet: true });
      const files = await readdir(output, { recursive: true });
      assert.ok(files.includes(path.join('src', 'login-controller.js')), 'new local modules are automatically copied');
      assert.ok(files.includes(path.join('assets', 'credits.json')), 'source attributions remain available');
      for (const omitted of ['src/demo-provider.js', 'src/sample-data.js', 'assets/photo-city.jpg', 'assets/photo-coffee.jpg', 'assets/photo-dinner.jpg', 'assets/photo-sea.jpg']) {
        assert.ok(!files.includes(path.normalize(omitted)), `${mode} must omit ${omitted}`);
      }
      const configText = await readFile(path.join(output, 'src', 'config.js'), 'utf8');
      assert.match(configText, new RegExp(`"mode": "${mode}"`));
      assert.match(configText, /"apiBase": ""/);
      assert.match(configText, mode === 'preview' ? /"space": ""/ : /"space": "spaces\/test"/);
    }
    // A copied module must not keep an eager dependency on an omitted demo file.
    await writeFile(path.join(fixture, 'src', 'main.js'), `${main}\nimport './demo-provider.js';\n`);
    await assert.rejects(build({ rootDir: fixture, outDir: path.join(temporary, 'invalid'), env: { MEMORY_MODE: 'preview', MEMORY_TARGET: 'pages' }, quiet: true }), /不能静态依赖演示模块/);
    await writeFile(path.join(fixture, 'src', 'main.js'), `${main}\nawait import('./missing-controller.js');\n`);
    await assert.rejects(build({ rootDir: fixture, outDir: path.join(temporary, 'missing'), env: { MEMORY_MODE: 'preview' }, quiet: true }), /缺少构建入口依赖.*missing-controller\.js/);

    const pagesWorkflow = await readFile(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
    assert.match(pagesWorkflow, /MEMORY_MODE: preview/);
    assert.match(pagesWorkflow, /MEMORY_TARGET: pages/);
    assert.ok(!/MEMORY_MODE: (demo|live)/.test(pagesWorkflow));
  } finally {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('memory-build-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
