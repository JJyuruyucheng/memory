import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { CACHEABLE_VENDOR_PATHS, securityHeaders, cloudflareHeaders } from '../scripts/security-headers.mjs';

test('only the pinned public vendor files are cacheable; application and private paths remain no-store', () => {
  assert.ok(CACHEABLE_VENDOR_PATHS.includes('/assets/panzoom-4.6.2.js'));
  for (const pathname of CACHEABLE_VENDOR_PATHS) assert.equal(securityHeaders('', pathname)['Cache-Control'], 'public, max-age=31536000, immutable');
  for (const pathname of ['/', '/index.html', '/src/main.js', '/src/config.js', '/assets/unknown.js', '/assets/panzoom.js', '/assets/panzoom-4.6.3.js', '/assets/PANZOOM-LICENSE.txt', '/storage/v1/object/memory-media/user/photo.jpg']) {
    assert.equal(securityHeaders('', pathname)['Cache-Control'], 'no-store');
  }
  const text = cloudflareHeaders();
  // Apply Pages' ordered header attachment/detachment rules. Merely adding a
  // narrower Cache-Control rule would otherwise leave conflicting no-store.
  for (const pathname of [...CACHEABLE_VENDOR_PATHS, '/src/main.js']) {
    let matches = false, cache = [];
    for (const line of text.trimEnd().split('\n')) {
      if (!line.trim()) continue;
      if (!line.startsWith(' ')) matches = line === '/*' || line === pathname;
      else if (matches && line.trim() === '! Cache-Control') cache = [];
      else if (matches && line.trim().startsWith('Cache-Control:')) cache.push(line.trim().slice(14).trim());
    }
    assert.deepEqual(cache, [securityHeaders('', pathname)['Cache-Control']]);
  }
});

test('a failed module graph produces a retry screen without clearing storage or auto-reloading', async () => {
  const source = await readFile(new URL('../src/boot.js', import.meta.url), 'utf8');
  let screen = null, reloads = 0;
  const element = tag => ({ tag, children: [], append(...children) { this.children.push(...children); },
    addEventListener(type, handler) { this[type] = handler; } });
  const document = { getElementById: id => id === 'app' ? { replaceChildren(value) { screen = value; } } : null, createElement: element };
  // No import callback intentionally models a module-graph load rejection.
  runInNewContext(source, { document, location: { reload() { reloads++; } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(screen.children[1].textContent, '页面组件暂时没能加载');
  assert.equal(reloads, 0);
  screen.children.find(item => item.tag === 'button').click();
  assert.equal(reloads, 1);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script defer src="\.\/src\/boot\.js"><\/script>/);
});
