import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseHistory } from '../src/releases.js';

export function renderChangelog() {
  return '# 朝夕 · 修改日志\n\n与站内「系统更新信息」共用 `src/releases.js` 数据。编号按产品版本递增，最新版本在前。\n\n第 001–004 期根据真实 Git 提交记录补记；这些版本号是整理时分配的产品版本，不代表当时已经创建同名 Git 标签。\n\n' + releaseHistory.map(release => `## 第 ${String(release.number).padStart(3, '0')} 期 · ${release.date} · ${release.version}\n\n${release.title}\n\n${release.changes.map(change => `- ${change}`).join('\n')}\n`).join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await writeFile(new URL('../CHANGELOG.md', import.meta.url), renderChangelog());
