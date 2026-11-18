import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the pinned Panzoom distribution preserves the upstream UMD global and license', async () => {
  const root = new URL('../', import.meta.url);
  const lock = JSON.parse(await readFile(new URL('vendor/panzoom.lock.json', root), 'utf8'));
  assert.equal(lock.name, '@panzoom/panzoom');
  assert.equal(lock.version, '4.6.2');
  assert.equal(lock.license, 'MIT');
  assert.equal(lock.archive, 'https://registry.npmjs.org/@panzoom/panzoom/-/panzoom-4.6.2.tgz');
  assert.equal(lock.registryIntegrity, 'sha512-Zn3B5/hwa6eYIPRSKX0xf2clv8nviTX8AnAU5kU/EugiTDhG41ya2wlBqYrZJYCWQROr/5XkWObZhIkepi89qw==');
  assert.deepEqual(lock.files.map(item => item.file).sort(), ['public/assets/PANZOOM-LICENSE.txt', 'public/assets/panzoom-4.6.2.js']);
  for (const item of lock.files) {
    const bytes = await readFile(new URL(item.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
  }
  const context = {};
  runInNewContext(await readFile(new URL('public/assets/panzoom-4.6.2.js', root), 'utf8'), context);
  assert.equal(typeof context.Panzoom, 'function');
  assert.equal(context.Panzoom.defaultOptions.maxScale, 4);
  assert.match(await readFile(new URL('public/assets/PANZOOM-LICENSE.txt', root), 'utf8'), /Copyright 2016-2019 Timmy Willison/);
});
