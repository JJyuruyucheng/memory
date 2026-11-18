import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';

const windows = [[7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天'], [0, '全部记录']];
const metrics = [['logins', '登录'], ['posts', '发帖'], ['comments', '留言'], ['edits', '修改'], ['deletes', '删除'], ['restores', '恢复']];
const actions = { login: '成功登录', publish: '发布记录', comment: '发表留言', edit: '保存修改', delete: '移到回收站', restore: '恢复记录' };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—';

function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

function cpuMemoryReport(origin) {
  const project = /^https:\/\/([a-z]{20})\.supabase\.co$/.exec(origin || '')?.[1];
  return project ? `https://supabase.com/dashboard/project/${project}/observability/database` : '';
}

export function renderAdminActivity({ days, report, error, pending }, { avatar, dateLabel, supabaseUrl }) {
  const stamp = value => value && Number.isFinite(Date.parse(value))
    ? `<time datetime="${esc(value)}">${esc(dateLabel(value, true, true))}</time>` : '—';
  const heading = `<header class="admin-report-heading"><h2 id="admin-activity-title">账号活动</h2>
    <div class="admin-report-controls"><label class="select-field"><span class="sr-only">统计时间</span><select id="admin-activity-period">
      ${windows.map(([value, label]) => `<option value="${value}" ${days === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <button type="button" id="admin-activity-refresh" class="secondary" data-action="refresh-admin-activity" aria-label="刷新统计" aria-disabled="${pending}">${icon('restore')}<span>刷新</span></button>
    </div></header>`;
  const content = pending ? '<p class="admin-report-message" role="status">正在读取统计…</p>'
    : error ? `<p class="admin-report-message admin-report-error" role="alert">${esc(error)}</p>` : '';
  if (!report) return `<section class="admin-report" aria-labelledby="admin-activity-title">${heading}${content}</section>`;

  const { accounts, recent, resources } = report;
  const reportUrl = cpuMemoryReport(supabaseUrl);
  const storageNote = resources.measuredObjects !== resources.storageObjects
    ? `<small>${count(resources.measuredObjects)} / ${count(resources.storageObjects)} 个文件已计入大小</small>`
    : `<small>${count(resources.storageObjects)} 个文件</small>`;
  return `<section class="admin-report" aria-labelledby="admin-activity-title">
    ${heading}${content}
    <div class="admin-account-grid">${accounts.map(account => `<article class="admin-account">
      <header>${avatar({ name: account.name, color: account.slot === 2 ? 'rose' : 'sage' }, true)}
        <div><h3>${esc(account.name)}</h3><p>最近登录 ${stamp(account.lastLoginAt)}</p></div></header>
      <dl class="admin-account-metrics">${metrics.map(([key, label]) => `<div><dt>${label}</dt><dd class="num">${count(account[key])}</dd></div>`).join('')}</dl>
    </article>`).join('')}</div>
    <p class="admin-report-note">登录、修改、删除和恢复从 ${stamp(report.trackedSince)} 开始统计。发帖和留言已纳入现存历史记录。</p>
  </section>
  <section class="admin-report" aria-labelledby="admin-resources-title">
    <header class="admin-report-heading"><h2 id="admin-resources-title">服务资源</h2><span class="admin-report-note">采集于 ${stamp(report.measuredAt)}</span></header>
    <dl class="admin-resource-list">
      <div><dt>数据库大小</dt><dd class="num">${bytes(resources.databaseBytes)}</dd></div>
      <div><dt>媒体存储</dt><dd class="num">${bytes(resources.storageBytes)}${storageNote}</dd></div>
      <div><dt>数据库连接</dt><dd class="num">${count(resources.connections)} <small>/ ${count(resources.maxConnections)}</small></dd></div>
    </dl>
    ${reportUrl ? `<a class="secondary inline-button admin-resource-link" href="${reportUrl}" target="_blank" rel="noopener noreferrer">在 Supabase 查看 CPU 与内存${icon('arrow')}</a>` : ''}
  </section>
  <section class="admin-report" aria-labelledby="admin-operations-title">
    <header class="admin-report-heading"><h2 id="admin-operations-title">最近操作</h2>
      <span class="admin-report-note">最多 40 条 · 北京时间</span></header>
    ${recent.length ? `<ol class="admin-operation-list">${recent.map(item => `<li><strong>${esc(item.name)}</strong>
      <span>${esc(actions[item.action] || '操作')}${item.title ? `<small>${esc(item.title)}</small>` : ''}</span>
      ${stamp(item.at)}</li>`).join('')}</ol>` : '<p class="admin-report-message">这段时间还没有操作记录。</p>'}
  </section>`;
}
