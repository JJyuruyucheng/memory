import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const DEMO = { MEMORY_MODE: 'demo', MEMORY_SPACE: '' };

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

    for (const required of ['src/main.js', 'src/demo-provider.js', 'src/memos-provider.js', 'src/components.css', 'public/assets/credits.json']) {
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
    await assert.rejects(build({ rootDir: fixture, env: { MEMORY_MODE: 'live', MEMORY_SPACE: 'spaces/test', MEMORY_TARGET: 'pages' }, quiet: true }), /Pages 只允许/);
  } finally {
    // The resolved target is the exact mkdtemp directory created by this test.
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('memory-build-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
