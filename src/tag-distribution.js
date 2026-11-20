import { escapeHtml as esc } from './domain.js';

const palette = ['#a3b38b', '#e6ad98', '#9ebfc5', '#e4c47d', '#bab0d0', '#93bcad',
  '#d7a3b3', '#c6b39a', '#a0b4d6', '#d7ab81', '#c1cd9b', '#c7abc6'];
const formatShare = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

export function tagShares(entries) {
  const counts = new Map();
  let total = 0;
  for (const entry of entries) {
    if (entry.deletedAt || entry.status === 'draft') continue;
    const tags = new Set((entry.tags ?? []).map(tag => tag.trim()).filter(Boolean));
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      total++;
    }
  }
  const shares = [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b, 'zh-CN'));
  return { total, items: shares.map(([tag, count]) => ({ tag, count, share: count / total })) };
}

const centre = 130, outer = 116, inner = 62;
const point = (angle, radius) => `${(centre + radius * Math.cos(angle)).toFixed(2)} ${(centre + radius * Math.sin(angle)).toFixed(2)}`;

function sector(from, to, color) {
  if (to - from >= 2 * Math.PI) {
    return `<circle cx="${centre}" cy="${centre}" r="${(outer + inner) / 2}" fill="none" stroke="${color}" stroke-width="${outer - inner}"/>`;
  }
  const wide = to - from > Math.PI ? 1 : 0;
  return `<path fill="${color}" d="M ${point(from, outer)} A ${outer} ${outer} 0 ${wide} 1 ${point(to, outer)}
    L ${point(to, inner)} A ${inner} ${inner} 0 ${wide} 0 ${point(from, inner)} Z"/>`;
}

export function tagDistributionMarkup(entries) {
  const { total, items } = tagShares(entries);
  const head = '<h2>标签分布</h2>';
  if (!total) return `<section class="stat-panel tag-stat-panel">${head}<p class="muted">当前范围还没有标签。</p></section>`;
  let angle = -Math.PI / 2;
  const slices = [], legend = [];
  for (const [index, { tag, count, share }] of items.entries()) {
    const color = palette[index] ?? `hsl(${Math.round((index * 137.51) % 360)} 34% ${index % 2 ? 68 : 76}%)`;
    const percent = share < 0.001 ? '<0.1%' : formatShare.format(share);
    const end = angle + share * 2 * Math.PI;
    const [x, y] = point((angle + end) / 2, (outer + inner) / 2).split(' ');
    const action = `data-action="stats-tag" data-value="${esc(tag)}"`;
    slices.push(`<a href="#timeline" ${action} tabindex="-1" class="tag-sector"><title>${esc(tag)} · ${esc(percent)}</title>
      ${sector(angle, end, color)}${share >= 0.045 ? `<text x="${x}" y="${y}">${esc(percent)}</text>` : ''}</a>`);
    legend.push(`<li><button type="button" ${action}><i style="--tag-swatch:${color}" aria-hidden="true"></i>
      <span>#${esc(tag)}<small>${count} 次</small></span><strong>${esc(percent)}</strong></button></li>`);
    angle = end;
  }
  return `<section class="stat-panel tag-stat-panel">${head}<p class="muted">按标签使用次数计算，点选标签查看对应帖子。</p>
    <div class="tag-stat-layout"><svg viewBox="0 0 260 260" class="tag-stat-donut" aria-hidden="true">
      ${slices.join('')}<text class="tag-stat-total" x="130" y="126">${total}</text><text class="tag-stat-unit" x="130" y="150">标签使用次数</text>
    </svg><ul class="tag-stat-legend" aria-label="标签占比">${legend.join('')}</ul></div></section>`;
}
