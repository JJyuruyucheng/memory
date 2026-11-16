import { CONFIG } from './config.js';
import { icon } from './icons.js';
import { mountLoginVerification } from './login-controller.js';
import { renderEntryMedia } from './entry-media.js';
import { releaseHistory } from './releases.js';
import { mountDatePickers, destroyDatePickers } from './date-pickers.js';
import { mountAttachmentSorter, destroyAttachmentSorter } from './attachment-sorter.js';
import { escapeHtml as esc, filterEntries, computeStats, relationshipDays, anniversaryInfo, dayKey } from './domain.js';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
let provider, loginVerification;
const moodNames = { happy: '微笑', neutral: '一般', sad: '难受', unset: '未填写' };
const moodIcons = { happy: 'smile', neutral: 'neutral', sad: 'sad' };
const filters = { query: '', type: 'all', mood: 'all', authorId: 'all', month: '', mediaType: 'all', favoritesOnly: false, trash: false };
let state = { currentUser: null, users: [], entries: [], settings: {} }, loginPending = false, bootPending = true;
let reconnectPending = false, reconnectError = null, reconnectAttempt, recoveryEpoch = 0;
let searchTimer, toastTimer, dialogReturnFocus, draftTimer;
let editorAttachments = [], editorId = null, previewUrls = [];
let calendarCursor = dayKey(new Date()).slice(0, 7), selectedDay = '';
const route = () => location.hash.slice(1).split('?')[0] || 'timeline';
const user = id => state.users.find(u => u.id === id) || { id, name: '已离开的作者', color: 'sage' };
const dateLabel = (value, full = false) => new Intl.DateTimeFormat('zh-CN', { timeZone: CONFIG.timeZone, ...(full ? { year: 'numeric' } : {}), month: 'long', day: 'numeric' }).format(new Date(value));
const avatar = (u, small = false) => `<span class="avatar ${u.color === 'rose' || state?.users?.filter(person => person.role !== 'admin').findIndex(person => person.id === u.id) === 1 ? 'rose' : u.role === 'admin' ? 'stone' : 'sage'} ${small ? 'small' : ''}" aria-label="${esc(u.name)}">${esc((u.name || '我').slice(0, 1))}</span>`;
const canEdit = entry => state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.id === entry.authorId);
const visibleEntries = () => state.entries.filter(entry => entry.type !== 'whisper' || state.currentUser?.role === 'admin' || entry.authorId === state.currentUser?.id);
const visibilityLabel = type => type === 'whisper' ? '仅作者和管理员可见' : '共同空间成员可见';
const safeUrl = value => { try { const u = new URL(value, location.href); return u.origin === location.origin || u.protocol === 'blob:' ? esc(u.href) : ''; } catch { return ''; } };

function toast(message, error = false) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 4500);
}
function dateTimeInput(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat('sv-SE', { timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(' ', 'T');
}
function filtered() {
  const view = route();
  const rows = filterEntries(visibleEntries(), { ...filters, userId: state.currentUser?.id, type: view === 'events' ? 'event' : filters.type, favoritesOnly: view === 'favorites', trash: view === 'trash' });
  return selectedDay && ['timeline', 'events', 'favorites'].includes(view) ? rows.filter(row => dayKey(row.occurredAt) === selectedDay) : rows;
}
const navItems = [['timeline', 'book', '时光线'], ['album', 'photo', '我们的相册'], ['events', 'calendar', '重要时刻'], ['stats', 'chart', '时光统计']];
function navLink(item) { const [id, symbol, label] = item; return `<a href="#${id}" class="nav-link ${route() === id ? 'active' : ''}" ${route() === id ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></a>`; }

function render() {
  if (!state?.currentUser && (reconnectPending || reconnectError)) return renderReconnect(reconnectError);
  document.body.classList.toggle('is-login', !state?.currentUser && CONFIG.mode !== 'demo');
  if (!state?.currentUser) return renderLogin();
  loginVerification?.destroy(); loginVerification = null;
  const active = document.activeElement?.id, selection = document.activeElement?.selectionStart;
  const current = state.currentUser, stats = computeStats(visibleEntries());
  app.innerHTML = `
    <aside class="sidebar" aria-label="主导航">
      <a class="wordmark" href="#timeline"><img src="./assets/mark.svg" alt="" width="43" height="43" /><span>朝夕<small>我们的记忆</small></span></a>
      <div class="space-label">${icon('lock')} ${esc(state.settings.spaceName || '两个人的小世界')}</div>
      <nav>${navItems.map(navLink).join('')}</nav>
      <div class="sidebar-group"><span class="group-label">好好收藏</span>${navLink(['favorites', 'bookmark', '我的收藏'])}${navLink(['anniversaries', 'heart', '纪念日'])}</div>
      <div class="sidebar-bottom">${navLink(['us', 'settings', '我们与设置'])}${navLink(['trash', 'trash', '回收站'])}${current.role === 'admin' ? navLink(['admin', 'shield', '管理小屋']) : ''}
      <div class="account-row">${avatar(current)}<div><strong>${esc(current.name)}</strong><small>${CONFIG.mode === 'demo' ? '示例视角' : current.role === 'admin' ? '维护账号' : '共同空间成员'}</small></div>${CONFIG.mode === 'demo' ? `<label class="switch-view" title="切换示例视角">${icon('down')}<span class="sr-only">切换示例视角</span><select id="user-switch">${state.users.map(u => `<option value="${esc(u.id)}" ${u.id === current.id ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? '（管理员）' : ''}</option>`).join('')}</select></label>` : `<button class="icon-button" data-action="logout" aria-label="退出登录">${icon('logout')}</button>`}</div>
      <div class="sidebar-utilities"><button class="credits-link" data-action="updates">系统更新信息</button><button class="credits-link" data-action="credits">关于朝夕与素材</button></div></div>
    </aside>
    <div class="workspace">
      <header class="mobile-header"><a href="#timeline"><img src="./assets/mark.svg" alt="" width="30" height="30" /><strong>朝夕</strong></a><span>${esc(state.settings.spaceName)}</span>${CONFIG.mode === 'demo' ? `<label class="mobile-account">${avatar(current, true)}${icon('down')}<span class="sr-only">切换示例视角</span><select id="mobile-user-switch">${state.users.map(u => `<option value="${esc(u.id)}" ${u.id === current.id ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? '（管理员）' : ''}</option>`).join('')}</select></label>` : `<button class="icon-button" data-action="logout" aria-label="退出登录">${icon('logout')}</button>`}</header>
      ${CONFIG.mode === 'demo' ? `<div class="mode-note">${icon('info')}<span>演示空间 · 示例内容与试写仅保存在当前浏览器</span><button data-action="about-mode">了解演示</button></div>` : ''}
      <main id="main-content" class="canvas" tabindex="-1">${renderView(stats)}</main>
      <footer class="page-footer"><button class="text-button" data-action="updates">系统更新信息 <span>${esc(releaseHistory[0]?.version || '')}</span></button>${CONFIG.mode === 'demo' ? '<span>演示内容为虚构，勿上传私密资料</span>' : '<button class="text-button" data-action="about-mode">可见范围</button>'}</footer>
    </div>
    <nav class="mobile-nav" aria-label="手机导航">${[['timeline', 'book', '时光'], ['album', 'photo', '相册']].map(navLink).join('')}<button class="mobile-compose" data-action="new" aria-label="记录这一刻">${icon('plus')}</button>${[['stats', 'chart', '统计'], ['us', 'settings', '我们']].map(navLink).join('')}</nav>`;
  if (active) { const el = document.getElementById(active); if (el) { el.focus({ preventScroll: true }); if (typeof selection === 'number' && el.setSelectionRange) el.setSelectionRange(selection, selection); } }
  mountDatePickers(app);
}
function heading(title, subtitle, action = true) {
  return `<header class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<button class="primary" data-action="new">${icon('plus')}<span>记录这一刻</span></button>` : ''}</header>`;
}
function renderView(stats) {
  switch (route()) {
    case 'album': return renderAlbum();
    case 'stats': return renderStats();
    case 'us': return renderSettings();
    case 'anniversaries': return renderAnniversaries();
    case 'admin': return renderAdmin(stats);
    case 'trash': return `${heading('回收站', '误删的片段，可以在这里找回来。', false)}<div class="info-line">保留记录和附件以便恢复；本版未启用自动永久清理。</div>${renderFeed(filtered(), true)}`;
    default: {
      const view = route();
      const title = view === 'events' ? '那些重要的时刻' : view === 'favorites' ? '舍不得忘的小事' : '把日子，慢慢收藏。';
      return `${heading(title, view === 'favorites' ? '你标记过的片段，都在这里。' : view === 'events' ? '第一次、纪念日，还有一起经历的每一个特别。' : `${dateLabel(new Date(), true)} · ${esc(state.settings.subtitle || '平凡的小事，也值得被记住。')}`)}
        <div class="home-grid"><section class="feed-column" aria-label="我们的时光线">
        <button class="quick-compose" data-action="new">${avatar(state.currentUser, true)}<span>今天，有什么想和 TA 一起记住？</span>${icon('edit')}</button>
        ${renderFilters()}<div class="feed-summary"><span>${selectedDay ? `${esc(selectedDay)} · ` : ''}共 ${filtered().length} 条${view === 'favorites' ? '收藏' : '回忆'}</span>${selectedDay || filters.query || filters.mood !== 'all' || filters.authorId !== 'all' || filters.type !== 'all' || filters.month ? '<button class="text-button" data-action="clear-filters">清除筛选</button>' : '<span>按发生时间排列</span>'}</div>
        ${renderFeed(filtered())}</section><aside class="right-rail">${renderTogether(stats)}${renderCalendar()}${renderUpcoming()}</aside></div>`;
    }
  }
}
function renderFilters() {
  return `<div class="filters"><label class="search-field"><span class="sr-only">搜索回忆</span><input id="search" type="search" value="${esc(filters.query)}" placeholder="找找那天的小事…" autocomplete="off" />${icon('search')}</label><div class="filter-row">
    <div class="segmented" aria-label="记录类型">${[['all', '全部'], ['note', '随记'], ['event', '事件'], ['whisper', '悄悄话']].map(([id, label]) => `<button data-action="filter-type" data-value="${id}" aria-pressed="${filters.type === id}" ${route() === 'events' && id !== 'event' ? 'disabled' : ''}>${label}</button>`).join('')}</div>
    <label class="select-field"><span class="sr-only">按作者筛选</span><select id="filter-author"><option value="all">所有作者</option>${state.users.map(u => `<option value="${esc(u.id)}" ${filters.authorId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
    <label class="select-field"><span class="sr-only">按心情筛选</span><select id="filter-mood"><option value="all">所有心情</option>${Object.entries(moodNames).map(([id, label]) => `<option value="${id}" ${filters.mood === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div></div>`;
}
function renderFeed(rows, trash = false) {
  if (!rows.length) return `<div class="empty-state">${icon(trash ? 'restore' : 'book')}<h2>${trash ? '这里干干净净' : '这一页，留给新的回忆'}</h2><p>${trash ? '删除的记录会先来到这里。' : '换个筛选条件，或者写下今天的一件小事。'}</p>${!trash ? '<button class="secondary" data-action="new">写下第一笔</button>' : ''}</div>`;
  let lastMonth = '';
  return `<div class="timeline">${rows.map(entry => { const month = dayKey(entry.occurredAt).slice(0, 7); const marker = month !== lastMonth ? `<div class="month-marker"><span>${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月</span></div>` : ''; lastMonth = month; return marker + renderEntry(entry, trash); }).join('')}</div>`;
}
function renderEntry(entry, trash = false) {
  const author = user(entry.authorId), liked = entry.reactionBy?.includes(state.currentUser.id), saved = entry.favoriteBy?.includes(state.currentUser.id);
  return `<article class="memory-card ${entry.type === 'event' ? 'event-card' : entry.type === 'whisper' ? 'whisper-card' : ''}">
    <div class="memory-meta">${avatar(author, true)}<div><strong>${esc(author.name)}</strong><time datetime="${esc(entry.occurredAt)}">${dateLabel(entry.occurredAt)}${entry.createdAt && dayKey(entry.createdAt) !== dayKey(entry.occurredAt) ? ' · 补记' : ''}</time></div><span class="entry-kind" ${entry.type === 'whisper' ? 'title="仅作者和管理员可见"' : ''}>${entry.type === 'event' ? `${icon('calendar')}事件` : entry.type === 'whisper' ? `${icon('lock')}悄悄话` : '随记'}</span>${canEdit(entry) && !trash ? `<button class="icon-button" data-action="edit" data-id="${esc(entry.id)}" aria-label="编辑${esc(entry.title || '这条回忆')}">${icon('edit')}</button>` : ''}</div>
    ${entry.title ? `<h2>${esc(entry.title)}</h2>` : ''}<p class="memory-text">${esc(entry.content)}</p>
    ${renderEntryMedia(entry, safeUrl)}
    ${entry.mood || entry.tags?.length ? `<div class="entry-tags">${entry.mood ? `<span class="mood-tag ${entry.mood}">${icon(moodIcons[entry.mood])}${moodNames[entry.mood] || '未填写'}</span>` : ''}${(entry.tags || []).map(tag => `<button class="tag" data-action="search-tag" data-value="${esc(tag)}"># ${esc(tag)}</button>`).join('')}</div>` : ''}
    <div class="memory-actions">${trash ? `${canEdit(entry) ? `<button class="text-button" data-action="restore" data-id="${esc(entry.id)}">${icon('restore')}恢复这条回忆</button>` : '<span class="muted">由作者恢复</span>'}` : `<button class="reaction-button ${liked ? 'selected' : ''}" data-action="reaction" data-id="${esc(entry.id)}" aria-pressed="${Boolean(liked)}" aria-label="${liked ? '取消喜欢' : '喜欢这条回忆'}">${icon('heart')}<span>${liked ? '已喜欢' : '喜欢'}</span>${entry.reactionBy?.length ? `<span class="action-count num">${entry.reactionBy.length}</span>` : ''}</button><button class="reaction-button comment-button" data-action="detail" data-id="${esc(entry.id)}">${icon('comment')}<span>留言</span>${entry.comments?.length ? `<span class="action-count num">${entry.comments.length}</span>` : ''}</button><button class="bookmark-button ${saved ? 'selected' : ''}" data-action="favorite" data-id="${esc(entry.id)}" aria-label="${saved ? '取消收藏' : '收藏这条回忆'}" aria-pressed="${Boolean(saved)}">${icon('bookmark')}<span>${saved ? '已收藏' : '收藏'}</span></button>`}</div>
  </article>`;
}
function renderTogether(stats) {
  const people = state.users.filter(u => u.role !== 'admin').slice(0, 2);
  const days = relationshipDays(state.settings.startDate, new Date());
  return `<section class="together-panel"><div class="couple-avatars">${people.map(u => avatar(u)).join(`<span class="between-heart">${icon('heart')}</span>`)}</div><h2>${people.map(u => esc(u.name)).join('<span class="amp"> & </span>')}</h2><p>一起走过的第</p><div class="together-days num">${Number.isFinite(days) ? days.toLocaleString() : '—'}<small>天</small></div><div class="together-date">从 ${esc(state.settings.startDate || '尚未设置')} 开始</div><div class="together-summary"><span><strong class="num">${stats.total}</strong> 段回忆</span><span><strong class="num">${stats.images}</strong> 张照片</span></div></section>`;
}
function renderCalendar() {
  const [year, month] = calendarCursor.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1)), offset = (first.getUTCDay() + 6) % 7, count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = new Set(visibleEntries().filter(e => !e.deletedAt).map(e => dayKey(e.occurredAt)));
  return `<section class="calendar-panel"><div class="rail-heading"><h2>${year} 年 ${month} 月</h2><div><button class="icon-button previous" data-action="calendar-prev" aria-label="上个月">${icon('chevron')}</button><button class="icon-button" data-action="calendar-next" aria-label="下个月">${icon('chevron')}</button></div></div><div class="calendar-grid">${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span class="weekday">${d}</span>`).join('')}${Array.from({ length: offset }, () => '<span></span>').join('')}${Array.from({ length: count }, (_, i) => { const key = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; return `<button data-action="calendar-day" data-value="${key}" class="calendar-day ${dates.has(key) ? 'has-memory' : ''} ${key === dayKey(new Date()) ? 'today' : ''} ${key === selectedDay ? 'selected' : ''}" aria-label="${key}${dates.has(key) ? '，有回忆' : ''}">${i + 1}</button>`; }).join('')}</div><p class="calendar-caption"><span></span>有记录的日子</p></section>`;
}
function upcoming() { return (state.settings.anniversaries || []).map(a => anniversaryInfo(a, new Date())).filter(a => !a.isPast).sort((a, b) => a.daysUntil - b.daysUntil); }
function renderUpcoming() { return `<section class="upcoming-panel"><div class="rail-heading"><h2>下一个小期待</h2><a class="small-link" href="#anniversaries">查看全部</a></div>${upcoming().slice(0, 2).map(a => `<div class="upcoming-row"><div><strong>${esc(a.title)}</strong><small>${esc(a.nextDate || a.date)}</small></div><span>${a.isToday ? '就是今天' : `<b class="num">${a.daysUntil}</b> 天后`}</span></div>`).join('') || '<p class="muted">设置一个值得期待的日子吧。</p>'}</section>`; }

function renderAlbum() {
  const entries = filtered().filter(e => !e.deletedAt), allMedia = entries.flatMap(entry => entry.media.map((file, index) => ({ ...file, entry, index })));
  const media = allMedia.filter(file => filters.mediaType === 'all' || file.type === filters.mediaType);
  const counts = { all: allMedia.length, image: allMedia.filter(file => file.type !== 'video').length, video: allMedia.filter(file => file.type === 'video').length };
  const items = media.map(file => `<button class="album-item" data-action="${file.unavailable ? 'retry-media' : 'media'}" data-id="${esc(file.entry.id)}" data-index="${file.index}">${file.unavailable ? `<span class="media-unavailable">附件暂时无法加载<small>${esc(file.error || '检查网络后重试')}</small><span>点击重新加载</span></span>` : file.type === 'video' ? `<video src="${safeUrl(file.url)}" preload="metadata"></video><span class="video-label">${icon('video')} 视频</span>` : `<img src="${safeUrl(file.url)}" alt="${esc(file.name || file.entry.title)}" loading="lazy" />`}<span class="album-caption"><strong>${esc(file.entry.title || '日常的一帧')}</strong><time>${dateLabel(file.entry.occurredAt)}</time></span></button>`).join('');
  return `${heading('光影里的我们', `${media.length} 个${filters.mediaType === 'video' ? '视频' : filters.mediaType === 'image' ? '照片' : '片段'}，把那天再看一遍。`)}<div class="album-toolbar"><div class="segmented" aria-label="附件类型">${[['all', '全部'], ['image', '图片'], ['video', '视频']].map(([id, name]) => `<button data-action="filter-media" data-value="${id}" aria-pressed="${filters.mediaType === id}">${name}<span class="filter-count num">${counts[id]}</span></button>`).join('')}</div><label class="select-field">月份 <input id="filter-month" type="month" value="${esc(filters.month)}" /></label><button class="text-button" data-action="clear-filters">显示全部</button></div>${media.length ? `<div class="album-grid">${items}</div>` : `<div class="empty-state"><h2>${allMedia.length ? '这个分类里还没有片段' : '照片会慢慢装满这里'}</h2><p>${allMedia.length ? '试试其他附件类型，或者记录一个新片段。' : '记录时选一张喜欢的照片或一段短视频吧。'}</p><button class="secondary" data-action="new">记录一个片段</button></div>`}`;
}
function renderStats() {
  const rows = filterEntries(visibleEntries(), { month: filters.month }), stats = computeStats(rows);
  const max = Math.max(1, ...stats.months.map(m => m.count)), filled = stats.moods.happy + stats.moods.neutral + stats.moods.sad;
  const monthlyMoods = month => ['happy', 'neutral', 'sad', 'unset'].map(mood => ({ mood, count: rows.filter(entry => !entry.deletedAt && dayKey(entry.occurredAt).startsWith(month) && (entry.mood || 'unset') === mood).length }));
  return `${heading('时光有迹可循', '我们留下的，是认真生活的痕迹。', false)}<div class="stats-toolbar"><label class="select-field">统计月份 <input id="filter-month" type="month" value="${esc(filters.month)}" /></label><button class="text-button" data-action="clear-filters">全部时间</button></div>
    <div class="stats-strip">${[['留下的回忆', stats.total, '条'], ['记录过的日子', stats.days, '天'], ['重要的事件', stats.events, '件'], ['记录的照片', stats.images, '张']].map(([name, value, unit]) => `<div><span>${name}</span><strong class="num">${value}<small>${unit}</small></strong></div>`).join('')}</div>
    <div class="stats-grid"><section class="stat-panel"><h2>每个月的小事</h2><p class="muted">按发生日期统计，删除的记录不计入。</p><div class="chart-legend" aria-label="心情颜色">${['happy', 'neutral', 'sad', 'unset'].map(m => `<span class="mood-${m}"><i></i>${moodNames[m]}</span>`).join('')}</div><div class="bar-chart" role="img" aria-label="${esc(stats.months.map(m => `${m.month}：${m.count}条；${monthlyMoods(m.month).map(part => `${moodNames[part.mood]}${part.count}条`).join('，')}`).join('；') || '还没有记录')}"><div class="chart-scale"><span>${max}</span><span>0 条</span></div><div class="chart-bars">${stats.months.map(m => `<div class="bar-column"><span class="num">${m.count}</span><div class="bar-track"><div class="stacked-bar" style="height:${m.count / max * 100}%">${monthlyMoods(m.month).filter(part => part.count).map(part => `<span class="mood-${part.mood}" style="flex:${part.count}" title="${moodNames[part.mood]}：${part.count} 条"></span>`).join('')}</div></div><small>${esc(m.month.slice(2).replace('-', '.'))}</small></div>`).join('') || '<p class="muted">写下第一条后，这里会有变化。</p>'}</div></div></section>
    <section class="stat-panel"><h2>写下这些时的心情</h2><p class="muted">${filled} 条填写了心情，${stats.moods.unset} 条未填写。</p><div class="mood-distribution">${['happy', 'neutral', 'sad'].map(m => `<div class="mood-stat mood-${m}">${icon(moodIcons[m])}<span>${moodNames[m]}</span><div class="mood-track"><span style="width:${filled ? stats.moods[m] / filled * 100 : 0}%"></span></div><strong class="num">${stats.moods[m]}<small> 条</small></strong></div>`).join('')}</div><p class="stat-footnote">每次记录都是当时的感受，心情分布不代表关系的好坏。</p></section></div>`;
}
function renderAnniversaries() {
  const anniversaries = (state.settings.anniversaries || []).map(a => anniversaryInfo(a, new Date()));
  return `${heading('值得记住的日子', '有些日期，一想到就会嘴角上扬。', false)}<div class="anniversary-grid">${anniversaries.map(a => `<article class="anniversary-card">${icon('calendar')}<h2>${esc(a.title)}</h2><p>${esc(a.date)}${a.yearly ? ' · 每年纪念' : ''}</p><div class="num">${a.isToday ? '今天' : a.isPast ? '已珍藏' : a.daysUntil}<small>${!a.isToday && !a.isPast ? '天后' : ''}</small></div><span>${a.isPast ? '这一页已经成为回忆' : a.isToday ? '把今天也好好记下来' : `下一次：${esc(a.nextDate)}`}</span></article>`).join('') || '<div class="empty-state"><h2>留一个日子，给期待</h2><p>在“我们与设置”中添加纪念日。</p></div>'}</div><a href="#us" class="secondary inline-button">${icon('settings')}管理纪念日</a>`;
}
function renderSettings() {
  const editable = state.currentUser.role === 'admin';
  return `${heading('我们与这个小世界', '把喜欢的称呼，和故事的开头留在这里。', false)}<nav class="settings-shortcuts" aria-label="更多回忆入口">${navLink(['favorites', 'bookmark', '我的收藏'])}${navLink(['anniversaries', 'heart', '纪念日'])}${navLink(['trash', 'trash', '回收站'])}${state.currentUser.role === 'admin' ? navLink(['admin', 'shield', '管理小屋']) : ''}</nav><form id="settings-form" class="settings-form">
    <section class="settings-section"><div><h2>共同空间</h2><p>会显示在首页，也会和回忆一起导出。</p>${!editable ? `<p class="permission-note" id="shared-permission">${icon('lock')}仅管理员可修改 · 当前可查看</p>` : ''}</div><fieldset ${!editable ? 'disabled aria-describedby="shared-permission"' : ''}><label>空间名字<input name="spaceName" value="${esc(state.settings.spaceName)}" maxlength="30" required /></label><label>一句喜欢的话<input name="subtitle" value="${esc(state.settings.subtitle || '')}" maxlength="80" /></label><label>故事开始的那天<input name="startDate" type="date" value="${esc(state.settings.startDate)}" required /></label></fieldset></section>
    <section class="settings-section"><div><h2>纪念日</h2><p>每年重复的日子，会自动计算下一次相遇。</p>${!editable ? `<p class="permission-note" id="anniversary-permission">${icon('lock')}仅管理员可修改 · 当前可查看</p>` : ''}</div><fieldset ${!editable ? 'disabled aria-describedby="anniversary-permission"' : ''}><div id="anniversary-fields">${(state.settings.anniversaries || []).map(a => anniversaryFields(a)).join('')}</div><button type="button" class="text-button" data-action="add-anniversary">${icon('plus')}加一个日子</button></fieldset></section>
    ${editable ? '<div class="settings-submit"><button type="submit" class="primary">保存我们的小世界</button></div>' : ''}</form>
    <section class="settings-section"><div><h2>数据与账号</h2><p>${CONFIG.mode === 'demo' ? '试写记录保存在此浏览器；清理网站数据会丢失它们。' : '导出含回忆和媒体，请妥善保存。'}</p></div><div class="settings-actions"><button class="secondary" data-action="export-mine">${icon('download')}导出我写的回忆</button>${state.currentUser.role === 'admin' || CONFIG.mode === 'demo' ? '<button class="secondary" data-action="export-all">导出完整共同档案</button>' : ''}${CONFIG.mode === 'demo' ? '<button class="text-button danger" data-action="reset-demo">恢复初始演示内容</button>' : '<button class="text-button" data-action="logout">退出当前账号</button>'}</div></section>`;
}
function anniversaryFields(a = {}) { return `<div class="anniversary-fields" data-anniversary="${esc(a.id || crypto.randomUUID())}"><label><span class="sr-only">纪念日名字</span><input name="ann-title" placeholder="例如：第一次见面" value="${esc(a.title || '')}" maxlength="40" required /></label><label><span class="sr-only">纪念日期</span><input name="ann-date" type="date" value="${esc(a.date || '')}" required /></label><label class="checkbox-label"><input name="ann-yearly" type="checkbox" ${a.yearly ? 'checked' : ''} />每年</label><button type="button" class="icon-button" data-action="remove-anniversary" aria-label="移除纪念日">${icon('close')}</button></div>`; }
function renderAdmin(stats) {
  if (state.currentUser.role !== 'admin') return `${heading('这扇门留给维护账号', '日常记录不需要管理员权限。', false)}<a href="#timeline" class="secondary inline-button">回到时光线</a>`;
  const bytes = state.entries.flatMap(e => e.media).reduce((sum, m) => sum + (Number(m.size) || 0), 0);
  return `${heading('管理小屋', '照顾好这个装着回忆的地方。', false)}<div class="info-line">${CONFIG.mode === 'demo' ? '当前是示例维护视角，操作只影响此浏览器。' : '管理员具有读取、编辑和导出私密内容的权限，请仅在维护时使用。'}</div><div class="stats-strip"><div><span>回忆总数</span><strong class="num">${stats.total}<small>条</small></strong></div><div><span>记录附件大小</span><strong class="num">${(bytes / 1024 / 1024).toFixed(1)}<small>MiB</small></strong></div><div><span>回收站</span><strong class="num">${state.entries.filter(e => e.deletedAt).length}<small>条</small></strong></div></div><div class="settings-section"><div><h2>空间里的账号</h2><p>维护身份与日常身份分开使用。</p></div><div class="member-list">${state.users.map(u => `<div class="member-row">${avatar(u, true)}<strong>${esc(u.name)}</strong><span>${u.role === 'admin' ? '管理员' : '日常成员'}</span></div>`).join('')}</div></div><div class="settings-section"><div><h2>备份与恢复</h2><p>导出档案方便带走内容；完整系统恢复还需数据库、媒体与配置备份。</p></div><div class="settings-actions"><button class="secondary" data-action="export-all">${icon('download')}导出完整共同档案</button><a class="secondary inline-button" href="#trash">${icon('restore')}查看回收站</a><button class="text-button" data-action="backup-help">了解备份范围</button></div></div>`;
}

function openDialog(content, cls = '') {
  closeModal(); dialogReturnFocus = document.activeElement;
  modalRoot.innerHTML = `<dialog class="dialog ${cls}">${content}<button class="dialog-close icon-button" data-action="close" aria-label="关闭窗口">${icon('close')}</button></dialog>`;
  const dialog = modalRoot.querySelector('dialog'); dialog.showModal();
  mountDatePickers(dialog);
  const title = dialog.querySelector('h2');
  if (title) { title.id = 'dialog-title'; dialog.setAttribute('aria-labelledby', title.id); }
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) closeModal(); } });
}
function closeModal(saveDraft = true) {
  if (saveDraft) persistDraft();
  destroyDatePickers(modalRoot);
  destroyAttachmentSorter(modalRoot);
  clearTimeout(draftTimer); modalRoot.querySelector('dialog')?.close(); modalRoot.innerHTML = '';
  previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls = [];
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus({ preventScroll: true });
}
function openEditor(entry) {
  editorId = entry?.id || null;
  let draft = {};
  if (!entry) { try { draft = JSON.parse(sessionStorage.getItem(`memory-draft:${CONFIG.mode}:${state.currentUser.id}`) || '{}'); } catch {} }
  const data = entry || { ...draft, occurredAt: draft.occurredAt || new Date().toISOString() };
  const author = entry ? user(entry.authorId) : state.currentUser;
  openDialog(`<form id="entry-form" data-original-type="${esc(entry?.type || '')}"><header class="editor-header"><div><h2>${entry ? '再添一点细节' : '今天，也值得记住'}</h2></div><div class="editor-who">${avatar(author, true)}<div><span>${esc(author.name)}</span><span id="entry-visibility">${icon('lock')}${visibilityLabel(data.type)}</span></div></div></header>
    <div class="editor-layout"><div class="editor-story"><label>给这段回忆起个名字 <span class="optional">随记可不填</span><input name="title" value="${esc(data.title || '')}" placeholder="例如：下班路上，一起看了晚霞" maxlength="120" /></label>
    <p id="whisper-warning" class="privacy-warning" hidden>${icon('info')}改为悄悄话后，对方将不能再查看；此前的副本、缓存和已签发链接无法即时收回。</p>
    <label class="editor-content">想记住的事<textarea name="content" rows="9" placeholder="慢慢写，这里没有字数任务。" maxlength="20000">${esc(data.content || '')}</textarea></label></div>
    <div class="editor-side"><div class="form-two"><label>记录类型<select name="type"><option value="note" ${!['event', 'whisper'].includes(data.type) ? 'selected' : ''}>日常随记</option><option value="event" ${data.type === 'event' ? 'selected' : ''}>重要事件</option><option value="whisper" ${data.type === 'whisper' ? 'selected' : ''}>悄悄话</option></select></label><label>发生在<input name="occurredAt" type="datetime-local" value="${dateTimeInput(data.occurredAt)}" required /></label></div>
    <fieldset class="mood-options"><legend>心情</legend>${['happy', 'neutral', 'sad'].map(m => `<label class="mood-option mood-${m}"><input type="radio" name="mood" value="${m}" ${data.mood === m ? 'checked' : ''} />${icon(moodIcons[m])}<span>${moodNames[m]}</span>${icon('check', 'mood-check')}</label>`).join('')}<label class="mood-option no-mood"><input type="radio" name="mood" value="" ${!data.mood ? 'checked' : ''} /><span>未填写</span>${icon('check', 'mood-check')}</label></fieldset>
    <label>小标签 <span class="optional">用逗号隔开</span><input name="tags" value="${esc((data.tags || []).join('，'))}" placeholder="日常，旅行，一起做饭" maxlength="180" /></label>
    <section class="editor-attachments" aria-label="照片与视频"><div class="upload-row"><label class="upload-control">${icon('photo')}<span>添加照片或短视频</span><input id="media-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" multiple /></label></div><small class="upload-hint">最多 9 张图片 · 最多 10 个附件 · 单个 ${CONFIG.mode === 'supabase' ? '50 MB' : '50 MiB'}</small><div id="editor-previews" class="editor-previews"></div></section></div></div>
    <p id="form-error" class="form-error" role="alert"></p><div class="dialog-footer"><div>${entry && canEdit(entry) ? `<button type="button" class="text-button danger delete-entry" data-action="delete" data-id="${esc(entry.id)}">移到回收站</button>` : ''}<span id="draft-status" role="status">${!entry && (draft.content || draft.title) ? '已恢复草稿' : ''}</span></div><button type="submit" class="primary">${icon('check')}${entry ? '保存修改' : '收好这一刻'}</button></div></form>`, 'editor-dialog');
  editorAttachments = (entry?.media || []).map(media => ({ key: crypto.randomUUID(), kind: 'media', media }));
  renderEditorPreviews();
}
function renderEditorPreviews() {
  const target = document.querySelector('#editor-previews'); if (!target) return;
  destroyAttachmentSorter(modalRoot);
  previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls = [];
  target.innerHTML = editorAttachments.map((item, i) => {
    let file = item.media;
    if (item.kind === 'file') { const url = URL.createObjectURL(item.file); previewUrls.push(url); file = { url, type: item.file.type.startsWith('video/') ? 'video' : 'image', name: item.file.name }; }
    return `<div class="attachment-preview" data-key="${esc(item.key)}">${file.type === 'video' ? `<video src="${safeUrl(file.url)}" preload="metadata" playsinline></video>` : `<img src="${safeUrl(file.url)}" alt="${esc(file.name || '附件')}" draggable="false" />`}<button type="button" class="preview-handle" aria-label="第 ${i + 1} 个附件，拖动排序或按方向键移动" data-key="${esc(item.key)}">${icon('grip')}<span class="num">${i + 1}</span></button><button type="button" class="preview-remove" data-action="remove-media" data-index="${i}" aria-label="移除第 ${i + 1} 个附件">${icon('close')}</button></div>`;
  }).join('');
  mountAttachmentSorter(target, keys => {
    const items = new Map(editorAttachments.map(item => [item.key, item]));
    editorAttachments = keys.map(key => items.get(key));
    queueMicrotask(renderEditorPreviews);
  }, error => toast(error.message, true));
}
document.addEventListener('keydown', event => {
  const handle = event.target.closest('.preview-handle');
  if (!handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const from = editorAttachments.findIndex(item => item.key === handle.dataset.key);
  const to = event.key === 'Home' ? 0 : event.key === 'End' ? editorAttachments.length - 1 : from + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
  if (from < 0 || to < 0 || to >= editorAttachments.length || from === to) return;
  const [item] = editorAttachments.splice(from, 1); editorAttachments.splice(to, 0, item);
  renderEditorPreviews();
  document.querySelector(`.preview-handle[data-key="${item.key}"]`)?.focus({ preventScroll: true });
});
function showDetail(id) {
  const entry = visibleEntries().find(e => e.id === id); if (!entry) return;
  openDialog(`<h2>${esc(entry.title || (entry.type === 'whisper' ? '给自己的一页' : '日常的一页'))}</h2><p class="dialog-description">${esc(user(entry.authorId).name)} · ${dateLabel(entry.occurredAt, true)}${entry.type === 'whisper' ? ' · 仅作者和管理员可见' : ''}</p><p class="detail-body">${esc(entry.content)}</p><section class="comments"><h3>${entry.type === 'whisper' ? '留在这一页的话' : '在这段回忆里说两句'}</h3>${entry.comments?.map(c => `<div class="comment-row">${avatar(user(c.authorId), true)}<div><strong>${esc(user(c.authorId).name)}</strong><p>${esc(c.content)}</p><time>${dateLabel(c.createdAt)}</time></div></div>`).join('') || '<p class="muted">还没有留言，写下你的感受吧。</p>'}</section><form id="comment-form" data-id="${esc(id)}"><label>${entry.type === 'whisper' ? '想留在这里的话' : '想对 TA 说'}<textarea name="content" rows="2" maxlength="2000" required placeholder="看到这段回忆，想起了什么？"></textarea></label><button class="primary" type="submit">留在这一页</button><p class="form-error" role="alert"></p></form>`, 'detail-dialog');
}
function showMedia(id, index = 0) {
  const entry = visibleEntries().find(e => e.id === id), file = entry?.media[index]; if (!file) return;
  if (file.unavailable) { toast('这份附件暂时无法加载，请刷新页面重试。', true); return; }
  openDialog(`<div class="lightbox-stage">${file.type === 'video' ? `<video controls playsinline src="${safeUrl(file.url)}"></video>` : `<img src="${safeUrl(file.url)}" alt="${esc(file.name || entry.title)}" />`}</div><div class="lightbox-caption"><div><strong>${esc(entry.title || '日常的一帧')}</strong><small>${dateLabel(entry.occurredAt, true)} · ${index + 1} / ${entry.media.length}</small></div><div>${index > 0 ? `<button class="icon-button previous" data-action="media" data-id="${esc(id)}" data-index="${index - 1}" aria-label="上一张">${icon('chevron')}</button>` : ''}${index < entry.media.length - 1 ? `<button class="icon-button" data-action="media" data-id="${esc(id)}" data-index="${index + 1}" aria-label="下一张">${icon('chevron')}</button>` : ''}</div></div>`, 'lightbox');
}
function info(title, text) { openDialog(`<h2>${title}</h2><div class="prose">${text}</div>`, 'info-dialog'); }
function showUpdates() {
  const releases = [...releaseHistory].sort((a, b) => b.number - a.number);
  openDialog(`<h2 tabindex="-1">系统更新信息</h2><ol class="release-timeline">${releases.map((release, index) => `<li><div class="release-marker num" aria-label="第 ${release.number} 次更新">${release.number}</div><details class="release-details" ${index === 0 ? 'open' : ''}><summary><span class="release-meta"><time datetime="${esc(release.date)}">${esc(release.date)}</time><span>${esc(release.version)}</span>${index === 0 ? '<b>最新</b>' : ''}</span><span class="release-title">${esc(release.title)}</span>${icon('down', 'release-chevron')}</summary><ul>${release.changes.map(change => `<li>${esc(change)}</li>`).join('')}</ul></details></li>`).join('')}</ol><p class="release-footer"><a href="https://github.com/JJyuruyucheng/memory/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">GitHub 完整修改日志${icon('arrow')}</a></p>`, 'updates-dialog');
  const dialog = modalRoot.querySelector('dialog');
  dialog.querySelector('h2').focus({ preventScroll: true }); dialog.scrollTop = 0;
}
async function exportData(scope) {
  toast('正在打包文字和媒体，请稍等…');
  const blob = await provider.exportData(scope), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `朝夕-${scope === 'all' ? '共同档案' : '我的回忆'}-${dayKey(new Date())}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000); toast('档案已生成，请保存下载文件。');
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.matches(':disabled')) return;
  const { action, id, value, index } = button.dataset;
  try {
    switch (action) {
      case 'new': openEditor(); break;
      case 'edit': openEditor(state.entries.find(e => e.id === id)); break;
      case 'close': closeModal(); break;
      case 'filter-type': filters.type = value; render(); break;
      case 'filter-media': filters.mediaType = value; render(); break;
      case 'clear-filters': Object.assign(filters, { query: '', type: 'all', mood: 'all', authorId: 'all', month: '', mediaType: 'all' }); selectedDay = ''; render(); break;
      case 'search-tag': filters.query = value; filters.type = 'all'; selectedDay = ''; if (route() !== 'timeline') history.pushState(null, '', '#timeline'); render(); break;
      case 'reaction': button.disabled = true; await provider.toggleReaction(id); render(); break;
      case 'favorite': button.disabled = true; await provider.toggleFavorite(id); render(); break;
      case 'detail': showDetail(id); break;
      case 'media': showMedia(id, Number(index)); break;
      case 'retry-media': {
        button.disabled = true; await provider.init(); render();
        const missing = state.entries.some(entry => entry.media.some(file => file.unavailable));
        toast(missing ? '部分附件仍未能连接，请检查网络或原文件。' : '附件已重新加载。', missing); break;
      }
      case 'delete': await provider.deleteEntry(id); closeModal(); render(); toast('已移到回收站，可以恢复。'); break;
      case 'restore': await provider.restoreEntry(id); render(); toast('这段回忆已经回来了。'); break;
      case 'remove-media': editorAttachments.splice(Number(index), 1); renderEditorPreviews(); break;
      case 'calendar-day': selectedDay = selectedDay === value ? '' : value; render(); break;
      case 'calendar-prev': case 'calendar-next': { const [y, m] = calendarCursor.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + (action === 'calendar-next' ? 1 : -1), 1)); calendarCursor = d.toISOString().slice(0, 7); render(); break; }
      case 'add-anniversary': document.querySelector('#anniversary-fields').insertAdjacentHTML('beforeend', anniversaryFields()); mountDatePickers(app); break;
      case 'remove-anniversary': button.closest('.anniversary-fields').remove(); break;
      case 'export-mine': button.disabled = true; await exportData('mine'); button.disabled = false; break;
      case 'export-all': button.disabled = true; await exportData('all'); button.disabled = false; break;
      case 'reset-demo': info('恢复初始演示内容', '<p>这会替换此浏览器的试写和设置。需要的记录请先导出。</p><button class="secondary" data-action="confirm-reset">确认恢复示例</button>'); break;
      case 'confirm-reset': state = await provider.resetDemo(); closeModal(); render(); toast('已恢复初始示例。'); break;
      case 'resume-demo': await provider.switchUser(value); render(); break;
      case 'updates': showUpdates(); break;
      case 'logout': {
        let failure;
        try { await provider.logout(); } catch (error) { failure = error; }
        finally { clearDrafts(); state.currentUser = null; closeModal(false); render(); }
        if (failure) toast('本机已退出；网络异常，服务器会话退出尚未确认。', true);
        break;
      }
      case 'about-mode': info(CONFIG.mode === 'demo' ? '现在是演示空间' : '共同空间的可见范围', CONFIG.mode === 'demo' ? '<p>你看到的称呼、日期和回忆都是示例。可以切换示例视角、试写、添加照片、留言、收藏和导出。</p><p>这些操作只保存在当前浏览器，不会同步到另一台设备。此公开演示不接收真实密码，请使用非私密的测试素材。</p>' : '<p>日常随记和重要事件在共同空间内共享；悄悄话仅作者和管理员可见，对方无法查看。</p><p>管理员可读取和维护全部已发布内容。将共享记录改为悄悄话，无法即时收回此前的副本、缓存和已签发链接。</p><p>文字草稿留在当前会话，退出时清除。</p>'); break;
      case 'backup-help': info('把回忆妥善留住', '<p>内容导出包含文字和媒体，方便离线阅读；它不是服务器的完整备份。</p><p>正式部署还需备份 Memos 数据库、附件卷与配置，保存一份加密异地副本，并实际验证恢复。详细步骤见仓库 docs/deployment.md。</p>'); break;
      case 'credits': { const credits = await fetch('./assets/credits.json').then(r => r.json()); info('关于朝夕', `<p>朝夕，收藏两个人的日常与重要时刻。演示人物与故事均为虚构。</p><p>私密后端基于 <a href="https://github.com/usememos/memos" target="_blank" rel="noopener noreferrer">Memos（MIT）</a>；组件参考和许可记录见仓库文档。</p><h3>演示照片</h3>${credits.map(c => `<p><a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">${esc(c.title.replace('File:', ''))}</a><br>${esc(c.author)} · ${esc(c.license)}<br><small>${esc(c.changes)}</small></p>`).join('')}`); break; }
      case 'reconnect': await reconnect(); break;
      case 'retry': location.reload(); break;
    }
  } catch (error) { button.disabled = false; if (!state.currentUser) { clearDrafts(); closeModal(false); render(); } toast(error.message || '暂时没能完成，请重试。', true); }
});

function clearDrafts() { try { Object.keys(sessionStorage).filter(k => k.startsWith('memory-draft:')).forEach(k => sessionStorage.removeItem(k)); } catch {} }
function persistDraft() {
  try {
    const form = document.querySelector('#entry-form');
    if (!form || editorId || !state.currentUser) return;
    const data = Object.fromEntries(new FormData(form));
    data.occurredAt += ':00+08:00';
    data.tags = (data.tags || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
    sessionStorage.setItem(`memory-draft:${CONFIG.mode}:${state.currentUser.id}`, JSON.stringify(data));
    const status = document.querySelector('#draft-status');
    if (status) status.textContent = '草稿已保存';
  } catch {}
}

document.addEventListener('input', event => {
  if (event.target.id === 'search' && !event.isComposing) { clearTimeout(searchTimer); searchTimer = setTimeout(() => { filters.query = event.target.value; render(); }, 250); }
  if (event.target.closest('#entry-form') && !editorId && event.target.type !== 'file') {
    clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 250);
  }
});
document.addEventListener('change', async event => {
  try {
    if (event.target.matches('#entry-form [name="type"]')) {
      const form = event.target.closest('form'), type = event.target.value;
      form.querySelector('#entry-visibility').innerHTML = `${icon('lock')}${visibilityLabel(type)}`;
      const original = form.dataset.originalType, warning = form.querySelector('#whisper-warning');
      warning.hidden = !original || (type === 'whisper') === (original === 'whisper');
      if (!warning.hidden) warning.innerHTML = `${icon('info')}${type === 'whisper' ? '改为悄悄话后，对方将不能再查看；此前的副本、缓存和已签发链接无法即时收回。' : '保存后，这条悄悄话及其附件将向对方公开。请确认这些内容可以分享。'}`;
    }
    if (['user-switch', 'mobile-user-switch'].includes(event.target.id)) { await provider.switchUser(event.target.value); closeModal(); render(); }
    if (event.target.id === 'filter-author') { filters.authorId = event.target.value; render(); }
    if (event.target.id === 'filter-mood') { filters.mood = event.target.value; render(); }
    if (event.target.id === 'filter-month') { filters.month = event.target.value; render(); }
    if (event.target.id === 'media-input') { editorAttachments.push(...[...event.target.files].map(file => ({ key: crypto.randomUUID(), kind: 'file', file }))); event.target.value = ''; renderEditorPreviews(); }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!['entry-form', 'settings-form', 'comment-form', 'login-form'].includes(form.id)) return;
  event.preventDefault();
  if (form.id === 'login-form' && loginPending) return;
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'entry-form') {
      const previous = editorId ? state.entries.find(e => e.id === editorId) : {};
      let fileIndex = 0;
      const mediaOrder = editorAttachments.map(item => item.kind === 'media' ? { id: item.media.id } : { fileIndex: fileIndex++ });
      const saved = await provider.saveEntry({ ...previous, title: data.title.trim(), content: data.content.trim(), type: data.type, occurredAt: `${data.occurredAt}:00+08:00`, mood: data.mood || null, tags: (data.tags || '').split(/[,，]/).map(s => s.trim()).filter(Boolean), media: editorAttachments.filter(item => item.kind === 'media').map(item => item.media), mediaOrder }, editorAttachments.filter(item => item.kind === 'file').map(item => item.file));
      sessionStorage.removeItem(`memory-draft:${CONFIG.mode}:${state.currentUser.id}`); closeModal(false); render(); toast(saved?.cleanupWarning || (editorId ? '细节已经好好收好了。' : '这一刻，已经留住了。'));
    } else if (form.id === 'settings-form') {
      if (state.currentUser.role !== 'admin') throw new Error('共同设置仅管理员可以修改。');
      const anniversaries = [...form.querySelectorAll('[data-anniversary]')].map(row => ({ id: row.dataset.anniversary, title: row.querySelector('[name="ann-title"]').value.trim(), date: row.querySelector('[name="ann-date"]').value, yearly: row.querySelector('[name="ann-yearly"]').checked }));
      await provider.saveSettings({ ...state.settings, spaceName: data.spaceName.trim(), subtitle: data.subtitle.trim(), startDate: data.startDate, anniversaries }); render(); toast('我们的小世界，已更新。');
    } else if (form.id === 'comment-form') { await provider.addComment(form.dataset.id, data.content.trim()); const id = form.dataset.id; render(); showDetail(id); toast('你的话，留在这段回忆里了。'); }
    else {
      if (!['live', 'supabase'].includes(CONFIG.mode) || !loginVerification?.getToken()) throw new Error('请先完成安全验证。');
      loginPending = true; form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('input').forEach(input => { input.disabled = true; });
      try { state = await provider.login(data.username, data.password, loginVerification.getToken()); }
      finally {
        loginPending = false;
        form.querySelector('[name="password"]').value = '';
        const currentForm = document.querySelector('#login-form');
        currentForm?.removeAttribute('aria-busy');
        currentForm?.querySelectorAll('input').forEach(input => { input.disabled = false; });
        loginVerification?.reset();
      }
      form.reset(); render();
    }
  } catch (error) { if (!state.currentUser && form.id !== 'login-form') { clearDrafts(); closeModal(false); render(); toast('登录已失效，请重新登录。', true); } else { const target = form.id === 'login-form' ? document.querySelector('#login-form .form-error') : form.querySelector('.form-error'); if (target) target.textContent = error.message; else toast(error.message, true); } }
  finally { if (submit?.isConnected) submit.disabled = form.id === 'login-form' ? !loginVerification?.getToken() : false; }
});
window.addEventListener('hashchange', () => { if (bootPending || (!provider && CONFIG.mode !== 'preview')) return; selectedDay = ''; filters.query = ''; filters.type = route() === 'events' ? 'event' : 'all'; render(); window.scrollTo({ top: 0 }); });
window.addEventListener('memory:session-ended', () => {
  recoveryEpoch++; reconnectAttempt = null; reconnectError = null; reconnectPending = false; bootPending = true;
  provider?.dispose?.(); state.currentUser = null; clearDrafts(); closeModal(false);
  app.innerHTML = '<main class="boot"><h1>登录状态已更新</h1><p>正在重新打开我们的空间…</p></main>';
});

function renderLogin() {
  loginVerification?.destroy(); loginVerification = null;
  if (CONFIG.mode === 'demo') {
    app.innerHTML = `<main class="boot"><img src="./assets/mark.svg" alt="" width="48" height="48" /><h1>选一个示例视角</h1><p>这是本机演示，不需要密码。</p>${state.users.map(u => `<button class="secondary" data-action="resume-demo" data-value="${esc(u.id)}">${esc(u.name)}</button>`).join('')}</main>`;
    return;
  }
  const preview = CONFIG.mode === 'preview';
  app.innerHTML = `<main class="login-page"><div class="login-layout"><section class="login-story" aria-label="朝夕"><a class="login-brand" href="#"><img src="./assets/mark.svg" alt="" width="48" height="48" /><span>朝夕<small>我们的记忆</small></span></a><div class="login-story-copy"><p class="login-intro">留给两个人的地方</p><h1>把日子过成故事，<br>把我们写进朝夕。</h1><p>一顿晚饭，一次远行，<br>还有那些说不完的小事。<br>都值得好好记住。</p></div><p class="login-story-end">朝夕之间，都是我们。</p></section><section class="login-panel" aria-labelledby="login-title"><div class="login-lock">${icon('lock')}<span>${preview ? '登录预览' : '我们的共同空间'}</span></div><h2 id="login-title">好久不见，欢迎回家</h2><p>登录后，翻开属于我们的那一页。</p><form id="login-form"><label for="login-username">账号<input id="login-username" name="username" autocomplete="${preview ? 'off' : 'username'}" placeholder="输入你的账号" maxlength="64" autocapitalize="none" spellcheck="false" required ${preview ? 'disabled' : ''} /></label><label for="login-password">密码<input id="login-password" name="password" type="password" autocomplete="${preview ? 'off' : 'current-password'}" placeholder="输入你的密码" maxlength="256" required ${preview ? 'disabled' : ''} /></label><div class="login-verification"><div id="login-captcha"></div><p id="verification-status" role="status">${preview ? '正式登录服务尚未接通。' : '正在准备安全验证…'}</p><button type="button" id="verification-retry" class="text-button" hidden>重新加载验证</button></div><p class="form-error" role="alert"></p><button type="submit" class="primary" disabled>翻开我们的记忆${icon('arrow')}</button></form>${preview ? '<p class="login-preview-note">当前是 GitHub Pages 登录预览。私密空间待后端开通后启用，这里不会提交账号密码，也不会展示回忆。</p>' : `<p class="login-footnote">${icon('lock')}仅限受邀账号 · 不开放注册<br />默认在本设备保持登录 30 天，请勿在公用设备登录</p>`}<button class="text-button login-updates" data-action="updates">系统更新信息</button></section></div></main>`;
  if (!preview) {
    if (loginPending) {
      document.querySelector('#login-form').setAttribute('aria-busy', 'true');
      document.querySelectorAll('#login-form input').forEach(input => { input.disabled = true; });
    }
    loginVerification = mountLoginVerification(app, {
      isBusy: () => loginPending,
      ...(CONFIG.mode === 'supabase' ? { getConfig: async () => ({ configured: CONFIG.authReady === true && Boolean(CONFIG.turnstileSiteKey), siteKey: CONFIG.turnstileSiteKey, action: 'login' }) } : {}),
    });
  }
}

function renderReconnect(error = null) {
  loginVerification?.destroy(); loginVerification = null;
  app.innerHTML = `<main class="boot"><img src="./assets/mark.svg" alt="" width="48" height="48" /><h1>${error ? '暂时未能连接' : '正在恢复登录…'}</h1><p>${error ? esc(error.message || '请检查网络后重新连接。') : '正在确认本设备的登录状态。'}</p>${error ? `<button class="secondary" data-action="${provider ? 'reconnect' : 'retry'}">重新连接</button>` : ''}</main>`;
}
async function reconnect() {
  if (reconnectAttempt) return reconnectAttempt;
  const epoch = recoveryEpoch;
  reconnectError = null; reconnectPending = true; renderReconnect();
  const attempt = (async () => {
    try { const restored = await provider.init(); if (epoch !== recoveryEpoch) return; state = restored; reconnectPending = false; render(); }
    catch (error) { if (epoch === recoveryEpoch) showRestoreFailure(error); }
    finally { if (reconnectAttempt === attempt) reconnectAttempt = null; }
  })();
  reconnectAttempt = attempt; return attempt;
}
function showRestoreFailure(error) {
  reconnectPending = false;
  if (['UNAUTHENTICATED', 'AUTH_CANCELLED'].includes(error.code) || error.status === 401) {
    reconnectError = null; render();
  } else { reconnectError = error; renderReconnect(error); }
}

const bootEpoch = recoveryEpoch;
try {
  if (CONFIG.mode === 'preview') state = { mode: 'preview', currentUser: null, users: [], entries: [], settings: {} };
  else {
    if (CONFIG.mode === 'live') provider = (await import('./memos-provider.js')).createMemosProvider(CONFIG);
    else if (CONFIG.mode === 'supabase') {
      const client = await (await import('./supabase-client.js')).createBrowserSupabaseClient(CONFIG);
      provider = (await import('./supabase-provider.js')).createSupabaseProvider({ ...CONFIG, client, onSessionChanged: ({ restore = true } = {}) => {
        recoveryEpoch++; reconnectAttempt = null;
        clearDrafts(); closeModal(false); reconnectError = null; reconnectPending = restore;
        // Restore only after Auth verifies the new identity. Never keep the old
        // account's rendered text or media while another tab changes accounts.
        if (restore) { const eventEpoch = recoveryEpoch; renderReconnect(); setTimeout(() => { if (eventEpoch === recoveryEpoch) reconnect(); }, 0); } else render();
      } });
    } else provider = (await import('./demo-provider.js')).createDemoProvider();
    const restored = await provider.init(); if (bootEpoch === recoveryEpoch) state = restored;
  }
  if (bootEpoch === recoveryEpoch) render();
}
catch (error) { if (bootEpoch === recoveryEpoch) showRestoreFailure(error); }
finally { bootPending = false; }
