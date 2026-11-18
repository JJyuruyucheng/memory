import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';

const windows = [[7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天'], [0, '全部记录']];
const metrics = [['logins', '登录'], ['posts', '发帖'], ['comments', '留言'], ['edits', '修改'], ['deletes', '删除'], ['restores', '恢复']];
const actions = { login: '成功登录', publish: '发布记录', comment: '发表留言', edit: '保存修改', delete: '移到回收站', restore: '恢复记录' };
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—';
const isByteCount = value => Number.isSafeInteger(value) && value >= 0;

function bytes(value) {
  if (!isByteCount(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Number((value / 1024).toFixed(1))} KB`;
  if (value < 1024 ** 3) return `${Number((value / 1024 ** 2).toFixed(1))} MB`;
  return `${Number((value / 1024 ** 3).toFixed(2))} GB`;
}

function capacityMarkup(label, { used, total, complete = true, note = '' }) {
  const hasLimit = isByteCount(total) && total > 0;
  const hasUsage = isByteCount(used);
  const percent = hasLimit && hasUsage ? used / total * 100 : null;
  const percentLabel = percent === null ? '' : percent > 0 && percent < 0.1 ? '<0.1%' : `${Number(percent.toFixed(1))}%`;
  const valueLabel = hasUsage && !complete ? `至少 ${bytes(used)}` : bytes(used);
  const remaining = percent !== null && complete
    ? used > total ? `超出额度 ${bytes(used - total)}` : `参考余量 ${bytes(total - used)}`
    : '';
  return `<div class="admin-capacity-item">
    <dt>${label}${hasLimit ? ' <small>已用 / 额度</small>' : ''}</dt>
    <dd>
      <div class="admin-capacity-value"><span class="num">${valueLabel}${hasLimit ? ` <small>/ ${bytes(total)}</small>` : ''}</span>
        ${percentLabel ? `<span class="num">${complete ? '' : '≥ '}${esc(percentLabel)}</span>` : ''}</div>
      ${percent === null ? '' : `<meter class="admin-capacity-meter${used > total ? ' over-limit' : ''}" min="0" max="${total}" value="${Math.min(used, total)}"
        aria-label="${label}额度使用率" aria-valuetext="${complete ? '' : '至少 '}${esc(percentLabel)}"></meter>`}
      ${remaining || note ? `<div class="admin-resource-note">${[remaining, note].filter(Boolean).join(' · ')}</div>` : ''}
    </dd>
  </div>`;
}

export function renderAdminActivity({ days, report, error, pending }, { avatar, dateLabel, supabaseUrl, resourceCapacity }) {
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
  const project = /^https:\/\/([a-z]{20})\.supabase\.co$/.exec(supabaseUrl || '')?.[1];
  const dashboardUrl = project ? `https://supabase.com/dashboard/project/${project}` : '';
  const storageComplete = Number.isSafeInteger(resources.storageObjects) && resources.measuredObjects === resources.storageObjects;
  const storageFileCount = storageComplete
    ? `${count(resources.storageObjects)} 个文件`
    : `${count(resources.measuredObjects)} / ${count(resources.storageObjects)} 个文件已计入大小`;
  return `<section class="admin-report" aria-labelledby="admin-activity-title">
    ${heading}${content}
    <div class="admin-account-grid">${accounts.map(account => `<article class="admin-account">
      <header>${avatar({ slot: account.slot, name: account.name, color: account.slot === 2 ? 'rose' : 'sage' }, true)}
        <div><h3>${esc(account.name)}</h3><p>最近登录 ${stamp(account.lastLoginAt)}</p></div></header>
      <dl class="admin-account-metrics">${metrics.map(([key, label]) => `<div><dt>${label}</dt><dd class="num">${count(account[key])}</dd></div>`).join('')}</dl>
    </article>`).join('')}</div>
    <p class="admin-report-note">登录、修改、删除和恢复从 ${stamp(report.trackedSince)} 开始统计。发帖和留言已纳入现存历史记录。</p>
  </section>
  <section class="admin-report" aria-labelledby="admin-resources-title">
    <header class="admin-report-heading"><h2 id="admin-resources-title">服务资源</h2><span class="admin-report-note">采集于 ${stamp(report.measuredAt)}</span></header>
    <dl class="admin-resource-list">
      ${capacityMarkup('数据库数据', { used: resources.databaseBytes, total: resourceCapacity?.databaseBytes })}
      ${capacityMarkup('媒体存储', { used: resources.storageBytes, total: resourceCapacity?.storageBytes,
        complete: storageComplete, note: storageFileCount + (resourceCapacity?.storageBytes ? ' · 组织共享额度' : '') })}
    </dl>
    <dl class="admin-resource-details">
      ${resourceCapacity?.databaseDiskGB ? `<div><dt>数据库磁盘容量</dt><dd><span class="num">${count(resourceCapacity.databaseDiskGB)} GB</span>
        ${dashboardUrl ? `<a class="small-link" href="${dashboardUrl}/settings/infrastructure" target="_blank" rel="noopener noreferrer">查看磁盘用量${icon('arrow')}</a>` : ''}</dd></div>` : ''}
      <div><dt>数据库连接</dt><dd class="num">${count(resources.connections)} <small>/ ${count(resources.maxConnections)}</small></dd></div>
    </dl>
    ${resourceCapacity ? '<p class="admin-resource-note">余量按本站当前占用估算。套餐用量按账期计算。</p>' : ''}
    ${dashboardUrl ? `<a class="secondary inline-button admin-resource-link" href="${dashboardUrl}/observability/database" target="_blank" rel="noopener noreferrer">在 Supabase 查看 CPU 与内存${icon('arrow')}</a>` : ''}
  </section>
  <section class="admin-report" aria-labelledby="admin-operations-title">
    <header class="admin-report-heading"><h2 id="admin-operations-title">最近操作</h2>
      <span class="admin-report-note">最多 40 条 · 北京时间</span></header>
    ${recent.length ? `<ol class="admin-operation-list">${recent.map(item => `<li><strong>${esc(item.name)}</strong>
      <span>${esc(actions[item.action] || '操作')}${item.title ? `<small>${esc(item.title)}</small>` : ''}</span>
      ${stamp(item.at)}</li>`).join('')}</ol>` : '<p class="admin-report-message">这段时间还没有操作记录。</p>'}
  </section>`;
}
