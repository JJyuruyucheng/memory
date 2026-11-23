import { escapeHtml as esc } from './domain.js';
import { computePostTrend } from './post-trend-data.js';

const number = new Intl.NumberFormat('zh-CN');
const fallbackNames = ['成员一', '成员二'];

export function postTrendMarkup(entries, members, selectedMonth) {
  const { periods, totals, scopeLabel, unitLabel } = computePostTrend(entries, members, selectedMonth);
  const names = members.slice(0, 2).map((member, index) => esc(member?.name || fallbackNames[index]));
  const heading = '<h2 id="post-trend-title">发帖趋势对比</h2>';
  if (names.length < 2) {
    return `<section class="stat-panel post-trend-panel" aria-labelledby="post-trend-title">
      ${heading}<p class="muted">两位成员加入后即可对比发帖趋势。</p></section>`;
  }
  const unit = esc(unitLabel);
  const peak = Math.max(2, ...periods.flatMap(period => period.counts));
  const step = Math.ceil(peak / 4);
  const intervals = Math.ceil(peak / step), maximum = intervals * step;
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => `<span>${number.format(maximum - index * step)}</span>`).join('');
  const legend = names.map((name, index) => `<li class="post-trend-series-${index}">
    <i aria-hidden="true"></i><span>${name}</span><strong>${number.format(totals[index])}<small> ${unit}</small></strong>
  </li>`).join('');
  const groups = periods.map(({ label, dateLabel, counts }) => {
    const bars = counts.map((count, index) => `<i class="post-trend-bar post-trend-series-${index}"
      style="height:${count / maximum * 100}%" title="${names[index]} ${number.format(count)} ${unit}"></i>`).join('');
    return `<li><div class="post-trend-bars">${bars}</div><span title="${esc(dateLabel)}">${esc(label)}</span></li>`;
  }).join('');
  const rows = periods.map(({ dateLabel, counts }) => `<tr><th scope="row">${esc(dateLabel)}</th>
    ${counts.map(count => `<td>${number.format(count)} ${unit}</td>`).join('')}</tr>`).join('');

  return `<section class="stat-panel post-trend-panel" aria-labelledby="post-trend-title">
    ${heading}
    <p class="muted">${esc(scopeLabel)} · 共享随记和事件 · 北京时间</p>
    <ul class="post-trend-totals" aria-label="发帖总数">${legend}</ul>
    ${periods.length ? `<div class="post-trend-chart" aria-hidden="true">
      <div class="post-trend-scale">${ticks}</div>
      <ol class="post-trend-periods" style="--post-trend-period-count:${periods.length};--post-trend-intervals:${intervals}">${groups}</ol>
    </div>
    <details class="post-trend-details">
      <summary>查看各期发帖数</summary>
      <table><caption class="sr-only">${esc(scopeLabel)}发帖数</caption>
        <thead><tr><th scope="col">日期</th>${names.map(name => `<th scope="col">${name}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>` : '<p class="muted">这段时间还没有共同记录。</p>'}
  </section>`;
}
