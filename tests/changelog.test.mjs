import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseHistory } from '../src/releases.js';
import { renderChangelog } from '../scripts/generate-changelog.mjs';

test('站内更新记录和仓库日志保持同源，发布编号与版本唯一且有序', async () => {
  assert.equal(await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), renderChangelog());
  assert.equal(new Set(releaseHistory.map(release => release.version)).size, releaseHistory.length);
  let previous = Infinity;
  for (const release of releaseHistory) {
    assert.ok(Number.isInteger(release.number) && release.number < previous); previous = release.number;
    assert.match(release.version, /^v\d+\.\d+\.\d+$/); assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(release.changes.length > 0);
  }
});
