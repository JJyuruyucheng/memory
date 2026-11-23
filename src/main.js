import { CONFIG } from './config.js';
import { icon } from './icons.js';
import { mountLoginVerification } from './login-controller.js';
import { renderEntryMedia } from './entry-media.js';
import { renderEntryText } from './daily-report.js';
import { entryPreviewMarkup, mountEntryPreviews } from './entry-preview.js';
import { releaseHistory } from './releases.js';
import { mountDatePickers, destroyDatePickers } from './date-pickers.js';
import { mountAttachmentSorter, destroyAttachmentSorter } from './attachment-sorter.js';
import { mountLoginCarousel } from './login-carousel.js';
import { loginPhotoEditorMarkup, mountLoginPhotoEditor } from './login-photo-editor.js';
import { prepareLoginPhoto } from './login-photo-image.js';
import { mediaViewerMarkup, mountMediaViewer } from './media-viewer.js';
import { entryTagsMarkup, mountEntryTags } from './entry-tags-editor.js';
import { calendarGrid, feedDatePickerMarkup, mountFeedDatePicker, shiftCalendarMonth } from './feed-date-picker.js';
import { mountTagOverflow } from './feed-tag-overflow.js';
import { tagDistributionMarkup } from './tag-distribution.js';
import { postTrendMarkup } from './post-trend.js';
import { mountAnniversarySorter } from './anniversary-sorter.js';
import { anniversaryFields, mountAnniversaryEditor, readAnniversaries } from './anniversary-editor.js';
import { lunarDateLabel, solarToLunar } from './lunar-calendar.js';
import { mountEntryBody, mountEntryUpload } from './entry-editor-controls.js';
import { entryEmojiMarkup, mountEntryEmoji } from './entry-emojis.js';
import { renderAdminActivity } from './admin-activity.js';
import { avatarImageUrl } from './profile.js';
import { profileEditorMarkup, mountProfileEditor } from './profile-editor.js';
import { mountAssistant } from './assistant-chat.js';
import { mountBackgroundMusic } from './background-music.js';
import { trackActiveUsage } from './active-usage.js';
import { mountPointsUi } from './points-ui.js';
import { mountPointsCheckin } from './points-checkin.js';
import { ALLOWED_FILE_TYPES, escapeHtml as esc, filterEntries, collectEntryTags, computeStats, relationshipDays, anniversariesInMonth, anniversaryInfo, dayKey } from './domain.js';

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const assistantRoot = document.querySelector('#assistant-root');
const musicRoot = document.querySelector('#bgm-root');
const scrollToPageTop = () => (document.body.classList.contains('has-bgm-layout') ? app : window).scrollTo({ top: 0 });
let provider, loginVerification, loginPhotos, loginCarousel, loginPhotoEditor, mediaViewer, profileEditor;
let assistant, assistantIdentity, backgroundMusic, stopUsage;
let pointsUi, pointsIdentity, stopCheckin;
let commentRequest;
const moodNames = { happy: '微笑', neutral: '一般', sad: '难受', unset: '未填写' };
const moodIcons = { happy: 'smile', neutral: 'neutral', sad: 'sad' };
const filters = { query: '', tag: '', type: 'all', mood: 'all', authorId: 'all', month: '', mediaType: 'all', favoritesOnly: false, trash: false };
let filterIdentity = null;
let state = { currentUser: null, users: [], entries: [], settings: {} }, loginPending = false, bootPending = true;
let reconnectPending = false, reconnectError = null, reconnectAttempt, recoveryEpoch = 0;
let searchTimer, toastTimer, dialogReturnFocus, draftTimer;
let editorAttachments = [], editorId = null, editorTags = null, previewUrls = [];
let unmountEntryBody, unmountEntryUpload, unmountEntryEmoji, unmountTagOverflow, unmountEntryPreviews, unmountAnniversarySorter;
let unmountAnniversaryEditor;
const expandedEntries = new Set();
let feedTagsExpanded = false;
let adminActivity = { days: 30, pending: false };
let calendarCursor = dayKey(new Date()).slice(0, 7), selectedDay = '';
const route = () => location.hash.slice(1).split('?')[0] || 'timeline';
const isFeedView = view => ['timeline', 'events', 'favorites'].includes(view);
const memberPointsRoutes = new Set(['points', 'shop', 'backpack']);
const pointsRoutes = new Set([...memberPointsRoutes, 'shop-admin']);
const musicScope = () => state.currentUser?.role === 'member' && memberPointsRoutes.has(route()) ? 'points' : 'site';
const user = id => state.users.find(u => u.id === id) || { id, name: '已离开的作者', color: 'sage' };
const dateLabel = (value, full = false, withTime = false) => new Intl.DateTimeFormat('zh-CN', { timeZone: CONFIG.timeZone, ...(full ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }).format(new Date(value));
const avatar = (u, small = false) => {
  const picture = avatarImageUrl(u.avatarJpeg);
  const color = u.color === 'rose' || state.users.filter(person => person.role !== 'admin').findIndex(person => person.id === u.id) === 1
    ? 'rose' : u.role === 'admin' ? 'stone' : 'sage';
  return `<span class="avatar ${color}${small ? ' small' : ''}" aria-label="${esc(u.name)}">${picture
    ? `<img src="${picture}" alt="" />` : esc(Array.from(u.name || '我')[0])}</span>`;
};
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
  return selectedDay && isFeedView(view) ? rows.filter(row => dayKey(row.occurredAt) === selectedDay) : rows;
}
const navItems = [['timeline', 'book', '时光线'], ['album', 'photo', '我们的相册'], ['events', 'calendar', '重要时刻'], ['stats', 'chart', '时光统计']];
function navLink([id, symbol, label]) {
  const selected = id === 'points' ? memberPointsRoutes.has(route()) : route() === id;
  return `<a href="#${id}" class="nav-link ${selected ? 'active' : ''}" ${selected ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${esc(label)}</span></a>`;
}
const pointsNavLink = () => navLink(['points', 'gift', '积分&商城']);

function clearPoints() {
  stopCheckin?.(); stopCheckin = null;
  pointsUi?.destroy(); pointsUi = null;
  pointsIdentity = null;
}

function preparePoints() {
  const current = state.currentUser;
  if (!provider?.pointsSummary || pointsIdentity === current.id) return;
  clearPoints();
  pointsIdentity = current.id;
  pointsUi = mountPointsUi({
    app, modalRoot, provider, getUser: () => state.currentUser, getUsers: () => state.users,
    getRoute: route, toast, openNotification: openPointsNotification, onSummary: updateMemoryConfirmations,
  });
  const ui = pointsUi;
  if (current.role === 'member') stopCheckin = mountPointsCheckin(provider, {
    progress: seconds => ui.updateCheckin(seconds),
    completed: snapshot => ui.refreshSummary(snapshot),
  });
}

function syncAssistant(locked = false) {
  if (!['supabase', 'preview'].includes(CONFIG.mode)) return;
  const identity = locked || reconnectPending || reconnectError ? null : state.currentUser?.id ?? null;
  if (!identity) clearPoints();
  if (!assistant || assistantIdentity !== identity) {
    assistant?.destroy();
    backgroundMusic?.destroy();
    stopUsage?.();
    assistantIdentity = identity;
    assistant = mountAssistant(assistantRoot, identity && provider?.askAssistant);
    backgroundMusic = identity && provider?.loadMusic && musicRoot ? mountBackgroundMusic(musicRoot, provider, musicScope()) : null;
    stopUsage = identity && state.currentUser.role === 'member' && provider?.recordActiveMinute ? trackActiveUsage(provider.recordActiveMinute) : null;
    document.body.classList.toggle('has-bgm', Boolean(backgroundMusic));
  }
  backgroundMusic?.setScope(musicScope());
  backgroundMusic?.mountSettings(app.querySelector('#bgm-settings'), app.querySelector('#points-bgm-settings'));
  const article = identity && modalRoot.querySelector('.detail-dialog[open][data-assistant-article]');
  assistant.setContext(article || assistantRoot, article?.dataset.assistantArticle, route());
  if (identity) pointsUi?.sync();
}

function render() {
  unmountAnniversaryEditor?.();
  unmountAnniversaryEditor = null;
  unmountAnniversarySorter?.();
  unmountAnniversarySorter = null;
  unmountTagOverflow?.();
  unmountTagOverflow = null;
  unmountEntryPreviews?.();
  unmountEntryPreviews = null;
  const identity = state?.currentUser?.id || null;
  if (identity !== filterIdentity) {
    clearTimeout(searchTimer);
    Object.assign(filters, { query: '', tag: '', month: '', authorId: 'all' });
    calendarCursor = dayKey(new Date()).slice(0, 7);
    selectedDay = '';
    feedTagsExpanded = false;
    expandedEntries.clear();
    adminActivity = { days: 30, pending: false };
    filterIdentity = identity;
  }
  if (!identity) { delete app.dataset.scrollView; delete app.dataset.feedFilterKey; document.body.classList.remove('has-feed-layout'); }
  if (!state?.currentUser && (reconnectPending || reconnectError)) return renderReconnect(reconnectError);
  const feedView = isFeedView(route());
  document.body.classList.toggle('is-login', !state?.currentUser && CONFIG.mode !== 'demo');
  document.body.classList.toggle('has-feed-layout', Boolean(state?.currentUser) && feedView);
  if (!state?.currentUser) return renderLogin();
  preparePoints();
  loginVerification?.destroy(); loginVerification = null;
  loginCarousel?.destroy(); loginCarousel = null;
  const active = document.activeElement?.id, selection = document.activeElement?.selectionStart;
  const scrollView = `${state.currentUser.id}:${route()}`;
  const enteredTrash = route() === 'trash' && app.dataset.scrollView !== scrollView && provider?.purgeTrash;
  const current = state.currentUser;
  const accountLabel = CONFIG.mode === 'demo' ? '示例视角' : current.role === 'admin' ? '维护账号' : '共同空间成员';
  const accountSummary = `${avatar(current)}<div><strong>${esc(current.name)}</strong><small>${accountLabel}</small></div>`;
  const accountProfile = provider?.saveProfile
    ? `<button type="button" id="desktop-profile" class="account-profile" data-action="profile" aria-label="编辑个人资料" aria-haspopup="dialog">${accountSummary}${icon('chevron')}</button>`
    : accountSummary;
  const mobileProfile = provider?.saveProfile
    ? `<button type="button" id="mobile-profile" class="mobile-profile" data-action="profile" aria-label="编辑个人资料" aria-haspopup="dialog">${avatar(current, true)}</button>`
    : '';
  const content = renderView(computeStats(visibleEntries()));
  const feedFilterKey = JSON.stringify({ ...filters, selectedDay });
  const scrollPositions = app.dataset.scrollView === scrollView ? ['.feed-column', '.right-rail'].map(selector => [selector, selector === '.feed-column' && app.dataset.feedFilterKey !== feedFilterKey ? 0 : app.querySelector(selector)?.scrollTop || 0]) : [];
  const footerNotice = CONFIG.mode === 'demo'
    ? '<span>演示内容为虚构，勿上传私密资料</span>'
    : current.role === 'admin' ? '<button class="text-button" data-action="about-mode">可见范围</button>' : '';
  app.innerHTML = `
    <aside class="sidebar" aria-label="主导航">
      <a class="wordmark" href="#timeline"><img src="./assets/mark.svg" alt="" width="43" height="43" /><span>朝夕<small>我们的记忆</small></span></a>
      ${pointsUi ? `<div class="points-desktop-bell">${pointsUi.renderBell()}</div>` : ''}
      <div class="space-label">${icon('lock')} ${esc(state.settings.spaceName || '两个人的小世界')}</div>
      <nav>${navItems.map(navLink).join('')}</nav>
      <div class="sidebar-group"><span class="group-label">好好收藏</span>${navLink(['favorites', 'bookmark', '我的收藏'])}${navLink(['anniversaries', 'heart', '纪念日'])}</div>
      ${pointsUi && current.role === 'member' ? `<nav aria-label="积分与商城">${pointsNavLink()}</nav>` : ''}
      <div class="sidebar-bottom">${navLink(['us', 'settings', '我们与设置'])}${navLink(['trash', 'trash', '回收站'])}${current.role === 'admin' ? navLink(['admin', 'shield', '管理小屋']) : ''}
      ${pointsUi && current.role === 'admin' ? navLink(['shop-admin', 'gift', '商城管理']) : ''}
      <div class="account-row">${accountProfile}${CONFIG.mode === 'demo' ? `<label class="switch-view" title="切换示例视角">${icon('down')}<span class="sr-only">切换示例视角</span><select id="user-switch">${state.users.map(u => `<option value="${esc(u.id)}" ${u.id === current.id ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? '（管理员）' : ''}</option>`).join('')}</select></label>` : `<button class="icon-button" data-action="logout" aria-label="退出登录">${icon('logout')}</button>`}</div>
      <div class="sidebar-utilities"><button class="credits-link" data-action="updates">系统更新信息</button><button class="credits-link" data-action="credits">关于朝夕与素材</button></div></div>
    </aside>
    <div class="workspace">
      <header class="mobile-header">
        <a href="#timeline"><img src="./assets/mark.svg" alt="" width="30" height="30" /><strong>朝夕</strong></a>
        <span class="mobile-space-name">${esc(state.settings.spaceName)}</span>
        ${feedView ? `<button type="button" id="mobile-search-button" class="icon-button mobile-search-button${filters.query ? ' is-active' : ''}" data-action="open-search" aria-label="${filters.query ? '搜索回忆，已应用关键词' : '搜索回忆'}" aria-haspopup="dialog">${icon('search')}</button>` : ''}
        ${pointsUi?.renderBell() || ''}
        ${CONFIG.mode === 'demo' ? `<label class="mobile-account">${avatar(current, true)}${icon('down')}<span class="sr-only">切换示例视角</span><select id="mobile-user-switch">${state.users.map(u => `<option value="${esc(u.id)}" ${u.id === current.id ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? '（管理员）' : ''}</option>`).join('')}</select></label>` : `${mobileProfile}<button class="icon-button" data-action="logout" aria-label="退出登录">${icon('logout')}</button>`}
      </header>
      ${CONFIG.mode === 'demo' ? `<div class="mode-note">${icon('info')}<span>演示空间 · 示例内容与试写仅保存在当前浏览器</span><button data-action="about-mode">了解演示</button></div>` : ''}
      <main id="main-content" class="canvas" tabindex="-1">${content}</main>
      <footer class="page-footer"><button class="text-button" data-action="updates">系统更新信息 <span>${esc(releaseHistory[0]?.version || '')}</span></button>${footerNotice}</footer>
    </div>
    <nav class="mobile-nav" aria-label="手机导航">${[['timeline', 'book', '时光'], ['album', 'photo', '相册']].map(navLink).join('')}<button class="mobile-compose" data-action="new" aria-label="记录这一刻">${icon('plus')}</button>${[['stats', 'chart', '统计'], ['us', 'settings', '我们']].map(navLink).join('')}</nav>`;
  app.dataset.scrollView = scrollView;
  app.dataset.feedFilterKey = feedFilterKey;
  unmountEntryPreviews = mountEntryPreviews(app, expandedEntries);
  for (const [selector, top] of scrollPositions) { const region = app.querySelector(selector); if (region) region.scrollTop = top; }
  if (active) { const el = document.getElementById(active); if (el) { el.focus({ preventScroll: true }); if (typeof selection === 'number' && el.setSelectionRange) el.setSelectionRange(selection, selection); } }
  mountDatePickers(app);
  const anniversaryEditor = app.querySelector('#anniversary-fields');
  unmountAnniversaryEditor = mountAnniversaryEditor(anniversaryEditor);
  unmountAnniversarySorter = mountAnniversarySorter(anniversaryEditor);
  unmountTagOverflow = mountTagOverflow(app.querySelector('.tag-filter-list'), feedTagsExpanded,
    expanded => { feedTagsExpanded = expanded; });
  syncAssistant();
  if (enteredTrash) {
    void provider.refresh().then(() => {
      if (route() === 'trash' && state.currentUser?.id === current.id) render();
    }).catch(() => {});
  }
  if (route() === 'admin' && current.role === 'admin' && provider?.loadAdminActivity && !adminActivity.started) {
    queueMicrotask(() => { if (!adminActivity.started) loadAdminActivity(); });
  }
}
function heading(title, subtitle, action = true) {
  const searchable = action && isFeedView(route());
  const compose = action ? `<button class="primary" data-action="new">${icon('plus')}<span>记录这一刻</span></button>` : '';
  const search = `<form id="search-form" class="compact-search" role="search">
    <label class="sr-only" for="search">搜索回忆</label>
    <input id="search" name="query" type="search" value="${esc(filters.query)}" placeholder="搜索回忆…" autocomplete="off" />
    <button type="submit" aria-label="搜索回忆">${icon('search')}</button>
  </form>`;
  return `<header class="page-heading"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${searchable ? `<div class="page-heading-actions">${search}${compose}</div>` : compose}</header>`;
}
function renderView(stats) {
  if (pointsRoutes.has(route()) && pointsUi) return pointsUi.renderView(route());
  switch (route()) {
    case 'album': return renderAlbum();
    case 'stats': return renderStats();
    case 'us': return renderSettings();
    case 'anniversaries': return renderAnniversaries();
    case 'admin': return renderAdmin(stats);
    case 'trash': return renderTrash();
    default: {
      const view = route();
      const title = view === 'events' ? '那些重要的时刻' : view === 'favorites' ? '舍不得忘的小事' : '把日子，慢慢收藏。';
      const filterControls = renderFilters();
      const rows = filtered();
      return `${heading(title, view === 'favorites' ? '你标记过的片段，都在这里。' : view === 'events' ? '第一次、纪念日，还有一起经历的每一个特别。' : `${dateLabel(new Date(), true)} · ${esc(state.settings.subtitle || '平凡的小事，也值得被记住。')}`)}
        <div class="home-grid"><section class="feed-column" tabindex="0" aria-label="我们的时光线">
        ${filterControls}<div class="feed-summary"><span>${selectedDay ? `${esc(selectedDay)} · ` : ''}共 ${rows.length} 条${view === 'favorites' ? '收藏' : '回忆'}</span>${selectedDay || filters.query || filters.tag || filters.mood !== 'all' || filters.authorId !== 'all' || filters.type !== 'all' || filters.month ? '<button class="text-button" data-action="clear-filters">清除筛选</button>' : '<span>按发生时间排列</span>'}</div>
        ${renderFeed(rows)}</section><aside class="right-rail" tabindex="0" aria-label="共同空间信息">${renderTogether(stats)}${renderCalendar()}${renderUpcoming()}</aside></div>`;
    }
  }
}
function feedScope(view) {
  return { type: view === 'events' ? 'event' : 'all', favoritesOnly: view === 'favorites', userId: state.currentUser.id };
}
function renderFilters() {
  const view = route();
  const type = view === 'events' ? 'event' : filters.type;
  const tags = collectEntryTags(visibleEntries(), state.currentUser, feedScope(view));
  const authors = state.users.filter(person => person.role !== 'admin');
  if (filters.tag && !tags.includes(filters.tag)) filters.tag = '';
  if (filters.authorId !== 'all' && !authors.some(person => person.id === filters.authorId)) filters.authorId = 'all';
  const orderedTags = filters.tag ? [filters.tag, ...tags.filter(tag => tag !== filters.tag)] : tags;
  const date = selectedDay || filters.month;
  const dateText = date ? date.replaceAll('-', '/') : '全部日期';
  return `<div class="filters"><div class="filter-row">
    <div class="segmented" aria-label="记录类型">${[['all', '全部'], ['note', '随记'], ['event', '事件'], ['whisper', '悄悄话']].map(([id, label]) => `<button data-action="filter-type" data-value="${id}" aria-pressed="${type === id}" ${view === 'events' && id !== 'event' ? 'disabled' : ''}>${label}</button>`).join('')}</div>
    ${tags.length ? `<div class="tag-filter-list" role="group" aria-label="按小标签筛选"><div id="feed-tag-items" class="feed-tag-items"><button id="filter-tag-all" class="tag-filter" data-action="filter-tag" data-value="" aria-pressed="${!filters.tag}">全部标签</button>${orderedTags.map(tag => `<button id="filter-tag-value-${esc(encodeURIComponent(tag))}" class="tag-filter" data-action="filter-tag" data-value="${esc(tag)}" aria-pressed="${filters.tag === tag}" title="#${esc(tag)}">#${esc(tag)}</button>`).join('')}</div><button type="button" class="feed-tag-toggle" aria-controls="feed-tag-items" aria-expanded="false" hidden>展开</button></div>` : ''}
    <div class="feed-selects">
      <label class="select-field"><span class="sr-only">按作者筛选</span><select id="filter-author" ${filters.authorId !== 'all' ? 'data-active' : ''}><option value="all">所有作者</option>${authors.map(u => `<option value="${esc(u.id)}" ${filters.authorId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>${icon('down')}</label>
      <label class="select-field"><span class="sr-only">按心情筛选</span><select id="filter-mood" ${filters.mood !== 'all' ? 'data-active' : ''}><option value="all">所有心情</option>${Object.entries(moodNames).map(([id, label]) => `<option value="${id}" ${filters.mood === id ? 'selected' : ''}>${label}</option>`).join('')}</select>${icon('down')}</label>
      <button type="button" id="filter-feed-date" class="feed-date-trigger" data-action="open-feed-date"
        aria-label="日期筛选，${esc(dateText)}" aria-haspopup="dialog" ${date ? 'data-active' : ''}>${icon('calendar')}<span>${esc(dateText)}</span></button>
    </div></div></div>`;
}
function renderFeed(rows, trash = false) {
  if (!rows.length) return `<div class="empty-state">${icon(trash ? 'restore' : 'book')}<h2>${trash ? '这里干干净净' : '这一页，留给新的回忆'}</h2><p>${trash ? '删除的记录会先来到这里。' : '换个筛选条件，或者写下今天的一件小事。'}</p>${!trash ? '<button class="secondary" data-action="new">写下第一笔</button>' : ''}</div>`;
  let lastMonth = '';
  return `<div class="timeline">${rows.map(entry => { const month = dayKey(entry.occurredAt).slice(0, 7); const marker = month !== lastMonth ? `<div class="month-marker"><span>${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月</span></div>` : ''; lastMonth = month; return marker + renderEntry(entry, trash); }).join('')}</div>`;
}
function memoryConfirmationState(memory) {
  if (memory?.confirmed_by?.includes(state.currentUser.id)) {
    return { label: memory.complete ? '回忆已确认' : '待对方确认', hint: '再次点击取消你的确认。', confirmed: true };
  }
  return { label: '确认回忆', hint: '双方确认后，发帖者获得 5 分。', confirmed: false };
}
function updateMemoryConfirmations(summary) {
  const memories = new Map(summary?.memories?.map(memory => [memory.entry_id, memory]));
  for (const button of app.querySelectorAll('[data-action="points-confirm-memory"]')) {
    const { label, hint, confirmed } = memoryConfirmationState(memories.get(button.dataset.id));
    button.querySelector('span').textContent = label;
    button.title = hint;
    button.setAttribute('aria-pressed', String(confirmed));
  }
}
function renderTrash() {
  const rows = visibleEntries().filter(entry => entry.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const canPurge = provider?.purgeTrash && rows.some(entry => canEdit(entry) && !entry.purgeRequestedAt);
  const clearText = state.currentUser.role === 'admin' ? '清空回收站' : '清空我的回收站';
  return `${heading('回收站', '', false)}<div class="trash-toolbar">
    <p>${provider?.purgeTrash ? '移入回收站后保留 7 天，期满自动清理。' : '误删的记录可以在这里恢复。'}</p>
    ${canPurge ? `<button class="secondary danger" data-action="purge-trash">${icon('trash')}${clearText}</button>` : ''}</div>
    ${renderFeed(rows, true)}`;
}
function trashActions(entry) {
  if (entry.purgeRequestedAt) return '<span class="muted">正在永久清理</span>';
  if (!canEdit(entry)) return '<span class="muted">由作者恢复</span>';
  const id = esc(entry.id);
  return `<button class="text-button" data-action="restore" data-id="${id}">${icon('restore')}恢复</button>
    ${provider?.purgeTrash ? `<button class="text-button danger" data-action="purge-trash" data-id="${id}">${icon('trash')}永久删除</button>` : ''}`;
}
function renderEntry(entry, trash = false) {
  const author = user(entry.authorId), liked = entry.reactionBy?.includes(state.currentUser.id), saved = entry.favoriteBy?.includes(state.currentUser.id);
  const askButton = provider?.askAssistant && ['note', 'event'].includes(entry.type) && !entry.deletedAt
    ? `<button class="reaction-button comment-button" data-action="ask-guazi" data-id="${esc(entry.id)}">${icon('cat')}<span>问瓜子</span></button>` : '';
  const allowConfirm = pointsUi && state.currentUser.role === 'member' && author.role === 'member'
    && entry.status !== 'draft' && ['note', 'event'].includes(entry.type) && !entry.deletedAt && !trash;
  const memory = allowConfirm ? memoryConfirmationState(pointsUi.getSummary()?.memories?.find(row => row.entry_id === entry.id)) : null;
  const confirmButton = memory ? `<button type="button" class="memory-confirm-button" data-action="points-confirm-memory"
    data-id="${esc(entry.id)}" aria-pressed="${memory.confirmed}" title="${memory.hint}">${icon('star')}<span>${memory.label}</span></button>` : '';
  return `<article class="memory-card ${entry.type === 'event' ? 'event-card' : entry.type === 'whisper' ? 'whisper-card' : ''}">
    <div class="memory-meta">${avatar(author, true)}<div><strong>${esc(author.name)}</strong><time datetime="${esc(entry.occurredAt)}">${dateLabel(entry.occurredAt, false, true)}${entry.createdAt && dayKey(entry.createdAt) !== dayKey(entry.occurredAt) ? ' · 补记' : ''}</time></div><span class="entry-kind" ${entry.type === 'whisper' ? 'title="仅作者和管理员可见"' : ''}>${entry.type === 'event' ? `${icon('calendar')}事件` : entry.type === 'whisper' ? `${icon('lock')}悄悄话` : '随记'}</span>${canEdit(entry) && !trash ? `<button class="icon-button" data-action="edit" data-id="${esc(entry.id)}" aria-label="编辑${esc(entry.title || '这条回忆')}">${icon('edit')}</button>` : ''}</div>
    ${entry.title ? `<h2>${esc(entry.title)}</h2>` : ''}${entryPreviewMarkup(entry)}
    ${renderEntryMedia(entry, safeUrl)}
    ${entry.mood || entry.tags?.length ? `<div class="entry-tags">${entry.mood ? `<span class="mood-tag ${entry.mood}">${icon(moodIcons[entry.mood])}${moodNames[entry.mood] || '未填写'}</span>` : ''}${(entry.tags || []).map(tag => `<button class="tag" data-action="search-tag" data-value="${esc(tag)}"># ${esc(tag)}</button>`).join('')}</div>` : ''}
    <div class="memory-actions">${trash ? trashActions(entry) : `<button class="reaction-button ${liked ? 'selected' : ''}" data-action="reaction" data-id="${esc(entry.id)}" aria-pressed="${Boolean(liked)}" aria-label="${liked ? '取消喜欢' : '喜欢这条回忆'}">${icon('heart')}<span>${liked ? '已喜欢' : '喜欢'}</span>${entry.reactionBy?.length ? `<span class="action-count num">${entry.reactionBy.length}</span>` : ''}</button><button class="reaction-button comment-button" data-action="detail" data-id="${esc(entry.id)}">${icon('comment')}<span>留言</span>${entry.comments?.length ? `<span class="action-count num">${entry.comments.length}</span>` : ''}</button>${askButton}<div class="memory-actions-end">${confirmButton}<button class="bookmark-button ${saved ? 'selected' : ''}" data-action="favorite" data-id="${esc(entry.id)}" aria-label="${saved ? '取消收藏' : '收藏这条回忆'}" aria-pressed="${Boolean(saved)}">${icon('bookmark')}<span>${saved ? '已收藏' : '收藏'}</span></button></div>`}</div>
  </article>`;
}
function renderTogether(stats) {
  const people = state.users.filter(u => u.role !== 'admin').slice(0, 2);
  const days = relationshipDays(state.settings.startDate, new Date());
  return `<section class="together-panel"><div class="couple-avatars">${people.map(u => avatar(u)).join(`<span class="between-heart">${icon('heart')}</span>`)}</div><h2>${people.map(u => esc(u.name)).join('<span class="amp"> & </span>')}</h2><p>一起走过的第</p><div class="together-days num">${Number.isFinite(days) ? days.toLocaleString() : '—'}<small>天</small></div><div class="together-date">从 ${esc(state.settings.startDate || '尚未设置')} 开始</div><div class="together-summary"><span><strong class="num">${stats.total}</strong> 段回忆</span><span><strong class="num">${stats.images}</strong> 张照片</span></div></section>`;
}
const monthAnniversaries = month => anniversariesInMonth(state.settings.anniversaries || [], month);

function renderCalendar() {
  const [year, month] = calendarCursor.split('-').map(Number);
  const dates = new Set(visibleEntries().filter(entry => !entry.deletedAt && entry.status !== 'draft').map(entry => dayKey(entry.occurredAt)));
  const anniversaries = monthAnniversaries(calendarCursor);
  return `<section class="calendar-panel"><div class="rail-heading"><h2>${year} 年 ${month} 月</h2><div><button class="icon-button previous" data-action="calendar-prev" aria-label="上个月">${icon('chevron')}</button><button class="icon-button" data-action="calendar-next" aria-label="下个月">${icon('chevron')}</button></div></div>${calendarGrid(calendarCursor, { dates, selectedDay, anniversaries })}
    <div class="calendar-footer"><div class="calendar-legend"><p class="calendar-caption"><span></span>有记录的日子</p>${anniversaries.size ? `<p class="calendar-caption calendar-anniversary-caption">${icon('heart')}纪念日</p>` : ''}</div>${pointsUi?.renderCheckin() || ''}</div></section>`;
}
function upcoming() {
  const today = dayKey(new Date());
  return (state.settings.anniversaries || []).map(a => anniversaryInfo(a, today)).filter(a => a && !a.isPast).sort((a, b) => a.daysUntil - b.daysUntil);
}
function renderUpcoming() { return `<section class="upcoming-panel"><div class="rail-heading"><h2>下一个小期待</h2><a class="small-link" href="#anniversaries">查看全部</a></div>${upcoming().slice(0, 2).map(a => `<div class="upcoming-row"><div><strong>${esc(a.title)}</strong><small>${esc(a.nextDate || a.date)}</small></div><span>${a.isToday ? '就是今天' : `<b class="num">${a.daysUntil}</b> 天后`}</span></div>`).join('') || '<p class="muted">设置一个值得期待的日子吧。</p>'}</section>`; }

function renderAlbum() {
  const entries = filtered().filter(e => !e.deletedAt), allMedia = entries.flatMap(entry => entry.media.map((file, index) => ({ ...file, entry, index })));
  const media = allMedia.filter(file => filters.mediaType === 'all' || file.type === filters.mediaType);
  const counts = { all: allMedia.length, image: allMedia.filter(file => file.type !== 'video').length, video: allMedia.filter(file => file.type === 'video').length };
  const items = media.map(file => `<button class="album-item" data-action="${file.unavailable ? 'retry-media' : 'media'}" data-id="${esc(file.entry.id)}" data-index="${file.index}">${file.unavailable ? `<span class="media-unavailable">附件暂时无法加载<small>${esc(file.error || '检查网络后重试')}</small><span>点击重新加载</span></span>` : file.type === 'video' ? `<video src="${safeUrl(file.url)}" preload="metadata"></video><span class="video-label">${icon('video')} 视频</span>` : `<img src="${safeUrl(file.url)}" alt="${esc(file.name || file.entry.title)}" loading="lazy" />`}<span class="album-caption"><strong>${esc(file.entry.title || '日常的一帧')}</strong><time>${dateLabel(file.entry.occurredAt, false, true)}</time></span></button>`).join('');
  return `${heading('光影里的我们', `${media.length} 个${filters.mediaType === 'video' ? '视频' : filters.mediaType === 'image' ? '照片' : '片段'}，把那天再看一遍。`)}<div class="album-toolbar"><div class="segmented" aria-label="附件类型">${[['all', '全部'], ['image', '图片'], ['video', '视频']].map(([id, name]) => `<button data-action="filter-media" data-value="${id}" aria-pressed="${filters.mediaType === id}">${name}<span class="filter-count num">${counts[id]}</span></button>`).join('')}</div><label class="select-field">月份 <input id="filter-month" type="month" value="${esc(filters.month)}" /></label><button class="text-button" data-action="clear-filters">显示全部</button></div>${media.length ? `<div class="album-grid">${items}</div>` : `<div class="empty-state"><h2>${allMedia.length ? '这个分类里还没有片段' : '照片会慢慢装满这里'}</h2><p>${allMedia.length ? '试试其他附件类型，或者记录一个新片段。' : '记录时选一张喜欢的照片或一段短视频吧。'}</p><button class="secondary" data-action="new">记录一个片段</button></div>`}`;
}
function renderStats() {
  const entries = visibleEntries(), members = state.users.filter(user => user.role === 'member').slice(0, 2);
  const rows = filterEntries(entries, { month: filters.month }), stats = computeStats(rows);
  const max = Math.max(1, ...stats.months.map(m => m.count)), filled = stats.moods.happy + stats.moods.neutral + stats.moods.sad;
  const monthlyMoods = month => ['happy', 'neutral', 'sad', 'unset'].map(mood => ({ mood, count: rows.filter(entry => !entry.deletedAt && dayKey(entry.occurredAt).startsWith(month) && (entry.mood || 'unset') === mood).length }));
  return `${heading('时光有迹可循', '我们留下的，是认真生活的痕迹。', false)}<div class="stats-toolbar"><label class="select-field">统计月份 <input id="filter-month" type="month" value="${esc(filters.month)}" /></label><button class="text-button" data-action="clear-filters">全部时间</button></div>
    <div class="stats-strip">${[['留下的回忆', stats.total, '条'], ['记录过的日子', stats.days, '天'], ['重要的事件', stats.events, '件'], ['记录的照片', stats.images, '张']].map(([name, value, unit]) => `<div><span>${name}</span><strong class="num">${value}<small>${unit}</small></strong></div>`).join('')}</div>
    <div class="stats-grid">${postTrendMarkup(entries, members, filters.month)}
    <section class="stat-panel"><h2>每个月的小事</h2><p class="muted">按发生日期统计，删除的记录不计入。</p><div class="chart-legend" aria-label="心情颜色">${['happy', 'neutral', 'sad', 'unset'].map(m => `<span class="mood-${m}"><i></i>${moodNames[m]}</span>`).join('')}</div><div class="bar-chart" role="img" aria-label="${esc(stats.months.map(m => `${m.month}：${m.count}条；${monthlyMoods(m.month).map(part => `${moodNames[part.mood]}${part.count}条`).join('，')}`).join('；') || '还没有记录')}"><div class="chart-scale"><span>${max}</span><span>0 条</span></div><div class="chart-bars">${stats.months.map(m => `<div class="bar-column"><span class="num">${m.count}</span><div class="bar-track"><div class="stacked-bar" style="height:${m.count / max * 100}%">${monthlyMoods(m.month).filter(part => part.count).map(part => `<span class="mood-${part.mood}" style="flex:${part.count}" title="${moodNames[part.mood]}：${part.count} 条"></span>`).join('')}</div></div><small>${esc(m.month.slice(2).replace('-', '.'))}</small></div>`).join('') || '<p class="muted">写下第一条后，这里会有变化。</p>'}</div></div></section>
    <section class="stat-panel"><h2>写下这些时的心情</h2><p class="muted">${filled} 条填写了心情，${stats.moods.unset} 条未填写。</p><div class="mood-distribution">${['happy', 'neutral', 'sad'].map(m => `<div class="mood-stat mood-${m}">${icon(moodIcons[m])}<span>${moodNames[m]}</span><div class="mood-track"><span style="width:${filled ? stats.moods[m] / filled * 100 : 0}%"></span></div><strong class="num">${stats.moods[m]}<small> 条</small></strong></div>`).join('')}</div><p class="stat-footnote">每次记录都是当时的感受，心情分布不代表关系的好坏。</p></section>
    ${tagDistributionMarkup(rows)}</div>`;
}
function renderAnniversaries() {
  const requested = new URLSearchParams(location.hash.split('?')[1]).get('day');
  const day = requested && dayKey(requested) === requested ? requested : '';
  const today = dayKey(new Date());
  const anniversaries = day ? monthAnniversaries(day.slice(0, 7)).get(day) || [] :
    (state.settings.anniversaries || []).map(a => anniversaryInfo(a, today)).filter(Boolean);
  const cards = anniversaries.map(a => {
    const date = a.calendar === 'lunar' ? lunarDateLabel(day ? solarToLunar(day) : a.lunar) : day || a.date;
    return `<article class="anniversary-card">${icon(day ? 'heart' : 'calendar')}<h2>${esc(a.title)}</h2>
      <p>${esc(date)}${a.yearly ? ' · 每年纪念' : ''}</p>
      ${day ? '' : `<div class="num">${a.isToday ? '今天' : a.isPast ? '已珍藏' : a.daysUntil}<small>${!a.isToday && !a.isPast ? '天后' : ''}</small></div>
        <span>${a.isPast ? '这一页已经成为回忆' : a.isToday ? '把今天也好好记下来' : `下一次：${esc(a.nextDate)}`}</span>`}</article>`;
  }).join('');
  return `${heading(day ? '当天的纪念日' : '值得记住的日子', day ? dateLabel(day, true) : '有些日期，一想到就会嘴角上扬。', false)}
    <div class="anniversary-grid">${cards || (day ? '<div class="empty-state"><h2>这一天没有纪念日</h2></div>' : '<div class="empty-state"><h2>留一个日子，给期待</h2><p>在“我们与设置”中添加纪念日。</p></div>')}</div>
    <div class="anniversary-page-actions">${day ? '<a href="#anniversaries" class="secondary inline-button">查看全部纪念日</a>' : ''}
    <a href="#us" class="secondary inline-button">${icon('settings')}管理纪念日</a></div>`;
}
function renderLoginPhotoSettings() {
  return loginPhotos ? `<section class="settings-section login-photo-settings"><h2>登录页照片</h2><div class="settings-actions"><button class="secondary" data-action="login-photos">${icon('edit')}编辑照片</button></div></section>` : '';
}
function mountLoginPhotoStory() {
  const story = app.querySelector('.login-story');
  if (!story || !loginPhotos || ['demo', 'preview'].includes(CONFIG.mode)) return;
  loginCarousel?.destroy();
  loginCarousel = mountLoginCarousel(story, { loadPhotos: () => loginPhotos.getLoginPhotos(), getPhotoUrl: id => loginPhotos.getLoginPhotoUrl(id) });
}
function loadOptionalLoginPhotos(create) {
  // Start independently from Auth restoration. A slow optional module cannot hold the first screen open.
  import('./login-photos-provider.js').then(create).then(photos => {
    loginPhotos = photos;
    if (bootPending) return;
    if (!state.currentUser) { mountLoginPhotoStory(); return; }
    const utilities = app.querySelector('.settings-utilities');
    if (route() === 'us' && utilities && !app.querySelector('.login-photo-settings')) {
      // Keep the actual form nodes, focus, and any unsaved shared settings intact.
      utilities.insertAdjacentHTML('afterbegin', renderLoginPhotoSettings());
    }
  }).catch(() => {}); // Keep the original login story and ordinary settings when the optional feature fails.
}
function renderSettings() {
  return `<header class="page-heading settings-title"><h1>我们与设置</h1><button class="primary" form="settings-form" type="submit">保存设置</button></header><div class="settings-board" data-ui>
    <nav class="settings-shortcuts" aria-label="更多回忆入口">${navLink(['favorites', 'bookmark', '我的收藏'])}${navLink(['anniversaries', 'heart', '纪念日'])}${navLink(['trash', 'trash', '回收站'])}${state.currentUser.role === 'admin' ? navLink(['admin', 'shield', '管理小屋']) : ''}
      ${pointsUi ? state.currentUser.role === 'admin' ? navLink(['shop-admin', 'gift', '商城管理']) : pointsNavLink() : ''}</nav>
    <form id="settings-form" class="settings-form">
      <section class="settings-section"><h2>共同空间</h2><fieldset class="settings-space-fields">
        <label>空间名字<input name="spaceName" value="${esc(state.settings.spaceName)}" maxlength="30" required /></label>
        <label>开始日期<input name="startDate" type="date" value="${esc(state.settings.startDate)}" required /></label>
        <label>一句喜欢的话<input name="subtitle" value="${esc(state.settings.subtitle || '')}" maxlength="80" /></label>
      </fieldset></section>
      <section class="settings-section"><div class="settings-card-head"><h2>纪念日</h2><button type="button" class="text-button" data-action="add-anniversary">${icon('plus')}加一个日子</button></div>
        <fieldset><div id="anniversary-fields">${(state.settings.anniversaries || []).map(a => anniversaryFields(a)).join('')}</div><span class="sr-only" role="status"></span></fieldset>
      </section>
    </form>
    ${provider?.loadMusic ? '<section id="bgm-settings" class="settings-section settings-music"></section><section id="points-bgm-settings" class="settings-section settings-music"></section>' : ''}
    <div class="settings-utilities">
      ${renderLoginPhotoSettings()}
      <section class="settings-section"><h2>数据与账号</h2><div class="settings-actions"><button class="secondary" data-action="export-mine">${icon('download')}导出我的回忆</button><button class="secondary" data-action="export-all">导出共同档案</button>${CONFIG.mode === 'demo' ? '<button class="text-button danger" data-action="reset-demo">恢复初始示例</button>' : '<button class="text-button" data-action="logout">退出当前账号</button>'}</div></section>
    </div>
  </div>`;
}
function renderAdmin(stats) {
  if (state.currentUser.role !== 'admin') return `${heading('这扇门留给维护账号', '日常记录不需要管理员权限。', false)}<a href="#timeline" class="secondary inline-button">回到时光线</a>`;
  const bytes = state.entries.flatMap(e => e.media).reduce((sum, m) => sum + (Number(m.size) || 0), 0);
  const activity = provider?.loadAdminActivity
    ? renderAdminActivity(adminActivity, {
      avatar: (account, small) => avatar(state.users.find(person => person.slot === account.slot) || account, small),
      dateLabel, supabaseUrl: CONFIG.supabaseUrl, resourceCapacity: CONFIG.resourceCapacity,
    })
    : '<p class="info-line">正式版管理小屋提供账号活动和服务资源统计。</p>';
  return `${heading('管理小屋', '查看账号活动、服务资源和备份。', false)}${activity}<div class="stats-strip"><div><span>回忆总数</span><strong class="num">${stats.total}<small>条</small></strong></div><div><span>记录附件大小</span><strong class="num">${(bytes / 1024 / 1024).toFixed(1)}<small>MiB</small></strong></div><div><span>回收站</span><strong class="num">${state.entries.filter(e => e.deletedAt).length}<small>条</small></strong></div></div><div class="settings-section"><div><h2>备份与恢复</h2><p>导出档案方便带走内容；完整系统恢复还需数据库、媒体与配置备份。</p></div><div class="settings-actions"><button class="secondary" data-action="export-all">${icon('download')}导出完整共同档案</button><a class="secondary inline-button" href="#trash">${icon('restore')}查看回收站</a><button class="text-button" data-action="backup-help">了解备份范围</button></div></div>`;
}

async function loadAdminActivity(days = adminActivity.days) {
  if (route() !== 'admin' || state.currentUser?.role !== 'admin' || !provider?.loadAdminActivity
      || (adminActivity.pending && days === adminActivity.days)) return;
  const request = { days, started: true, pending: true };
  adminActivity = request;
  render();
  try {
    request.report = await provider.loadAdminActivity(days);
  } catch (error) {
    request.error = error.message || '统计暂时无法读取，请刷新重试。';
  } finally {
    request.pending = false;
    if (adminActivity === request && route() === 'admin' && state.currentUser?.role === 'admin') render();
  }
}

function openDialog(content, cls = '', returnFocus = document.activeElement) {
  if (closeModal() === false) return;
  dialogReturnFocus = returnFocus;
  modalRoot.innerHTML = `<dialog class="dialog ${cls}">${content}<button class="dialog-close icon-button" data-action="close" aria-label="关闭窗口">${icon('close')}</button></dialog>`;
  const dialog = modalRoot.querySelector('dialog');
  const title = dialog.querySelector('h2');
  if (title) { title.id = 'dialog-title'; dialog.setAttribute('aria-labelledby', title.id); }
  dialog.showModal();
  mountDatePickers(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeModal(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) closeModal(); } });
}
function confirmTrashPurge(id, button) {
  if (!provider?.purgeTrash) return;
  const title = id ? '永久删除这条记录？' : state.currentUser.role === 'admin' ? '清空回收站？' : '清空我的回收站？';
  const scope = id ? '这条记录' : state.currentUser.role === 'admin' ? '回收站内的全部记录' : '回收站中你发布的全部记录';
  openDialog(`<h2>${title}</h2><p class="dialog-description">${scope}及附件将永久删除，无法恢复。</p>
    <p class="form-error" role="alert"></p>
    <div class="dialog-footer trash-confirm-actions"><button class="secondary" data-action="close">取消</button>
    <button class="primary" data-action="purge-trash-confirm"${id ? ` data-id="${esc(id)}"` : ''}>确认永久删除</button></div>`, 'trash-confirm-dialog', button);
  modalRoot.querySelector('.trash-confirm-actions [data-action="close"]').focus();
}
function closeModal(saveDraft = true) {
  if (saveDraft && modalRoot.querySelector('#entry-form[data-saving]')) return false;
  if (saveDraft && profileEditor?.isSaving) { toast('个人资料正在保存，请稍候。'); return; }
  if (saveDraft && loginPhotoEditor?.isSaving) { toast('照片正在保存，请稍候。'); return; }
  if (saveDraft) persistDraft();
  editorTags = null;
  unmountEntryBody?.(); unmountEntryBody = null;
  unmountEntryUpload?.(); unmountEntryUpload = null;
  unmountEntryEmoji?.(); unmountEntryEmoji = null;
  loginPhotoEditor?.destroy(); loginPhotoEditor = null;
  profileEditor?.destroy(); profileEditor = null;
  mediaViewer?.destroy(); mediaViewer = null;
  destroyDatePickers(modalRoot);
  destroyAttachmentSorter(modalRoot);
  clearTimeout(draftTimer);
  modalRoot.querySelector('dialog')?.close();
  assistant?.setContext(assistantRoot);
  modalRoot.innerHTML = '';
  previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls = [];
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus({ preventScroll: true });
  dialogReturnFocus = null;
}
function showProfileEditor(button) {
  const current = state.currentUser;
  if (!current || !provider?.saveProfile) return;
  openDialog(profileEditorMarkup(current, avatar, typeof provider.changePassword === 'function'), 'profile-dialog', button);
  profileEditor = mountProfileEditor(modalRoot.querySelector('dialog'), {
    user: current, avatar, saveProfile: provider.saveProfile, changePassword: provider.changePassword,
    getConfig: () => ({ configured: CONFIG.authReady, siteKey: CONFIG.turnstileSiteKey, action: 'login' }),
    onSaved() { closeModal(false); render(); toast('个人资料已保存。'); },
    async onPasswordSaved() {
      try { await provider.logout(); } catch { /* The local view is cleared after the confirmed password change. */ }
      finally { clearDrafts(); state.currentUser = null; closeModal(false); render(); }
      toast('密码已更新，请用新密码登录。');
    },
  });
}
function showFeedDatePicker(button) {
  const entries = visibleEntries().filter(entry => entry.status !== 'draft');
  const dates = new Set(filterEntries(entries, feedScope(route())).map(entry => dayKey(entry.occurredAt)).filter(Boolean));
  openDialog(feedDatePickerMarkup(pointsUi?.renderCheckin()), 'feed-date-dialog', button);
  mountFeedDatePicker(modalRoot.querySelector('dialog'), { selectedMonth: filters.month, selectedDay, dates, anniversariesForMonth: monthAnniversaries });
}
function showMobileSearch(button) {
  clearTimeout(searchTimer);
  openDialog(`<h2>搜索回忆</h2>
    <form id="mobile-search-form" role="search">
      <label class="sr-only" for="mobile-search-query">搜索关键词</label>
      <input id="mobile-search-query" name="query" type="search" value="${esc(filters.query)}"
        placeholder="标题、正文或小标签" autocomplete="off" enterkeyhint="search" autofocus />
      <button type="submit" class="primary">搜索</button>
    </form>`, 'search-dialog', button);
  modalRoot.querySelector('#mobile-search-query').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    closeModal();
  });
}
function openEditor(entry) {
  let draft = {};
  if (!entry) { try { draft = JSON.parse(sessionStorage.getItem(`memory-draft:${CONFIG.mode}:${state.currentUser.id}`) || '{}'); } catch {} }
  const data = entry || { ...draft, occurredAt: draft.occurredAt || new Date().toISOString() };
  const author = entry ? user(entry.authorId) : state.currentUser;
  const suggestions = collectEntryTags(state.entries, state.currentUser);
  openDialog(`<form id="entry-form" data-original-type="${esc(entry?.type || '')}"><header class="editor-header"><div><h2>${entry ? '再添一点细节' : '今天，也值得记住'}</h2></div><div class="editor-who">${avatar(author, true)}<div><span>${esc(author.name)}</span><span id="entry-visibility">${icon('lock')}${visibilityLabel(data.type)}</span></div></div></header>
    <div class="editor-layout"><div class="editor-story"><label>给这段回忆起个名字 <span class="optional">随记可不填</span><input name="title" value="${esc(data.title || '')}" placeholder="例如：下班路上，一起看了晚霞" maxlength="120" /></label>
    <p id="whisper-warning" class="privacy-warning" hidden>${icon('info')}改为悄悄话后，对方将不能再查看；此前的副本、缓存和已签发链接无法即时收回。</p>
    <div class="editor-content"><div class="editor-body-heading"><label for="entry-content">正文</label>${entryEmojiMarkup()}</div><div class="editor-body-field">
      <textarea id="entry-content" name="content" rows="2" placeholder="写下想记住的事" maxlength="20000">${esc(data.content || '')}</textarea>
      <button type="button" class="body-resize" aria-label="调整正文高度，可拖动或按上下方向键"></button></div></div></div>
    <div class="editor-side"><div class="form-two"><label>记录类型<select name="type"><option value="note" ${!['event', 'whisper'].includes(data.type) ? 'selected' : ''}>日常随记</option><option value="event" ${data.type === 'event' ? 'selected' : ''}>重要事件</option><option value="whisper" ${data.type === 'whisper' ? 'selected' : ''}>悄悄话</option></select></label><label>发生在<input name="occurredAt" type="datetime-local" value="${dateTimeInput(data.occurredAt)}" required /></label></div>
    <fieldset class="mood-options"><legend>心情</legend>${['happy', 'neutral', 'sad'].map(m => `<label class="mood-option mood-${m}"><input type="radio" name="mood" value="${m}" ${data.mood === m ? 'checked' : ''} />${icon(moodIcons[m])}<span>${moodNames[m]}</span>${icon('check', 'mood-check')}</label>`).join('')}<label class="mood-option no-mood"><input type="radio" name="mood" value="" ${!data.mood ? 'checked' : ''} /><span>未填写</span>${icon('check', 'mood-check')}</label></fieldset>
    <section class="editor-attachments" aria-label="照片与视频"><label class="upload-control editor-dropzone">${icon('photo')}<span>添加照片或视频</span><small>也可拖入文件</small><input id="media-input" type="file" accept="image/*,video/*" aria-describedby="editor-upload-limits" multiple /></label><small class="upload-hint" id="editor-upload-limits">最多 9 张图片 · 10 个附件 · 单个 ${CONFIG.mode === 'supabase' ? '50 MB' : '50 MiB'}</small><p id="editor-upload-error" class="form-error" role="alert"></p><div id="editor-previews" class="editor-previews"></div></section></div></div>
    ${entryTagsMarkup(suggestions)}
    <p id="form-error" class="form-error" role="alert"></p><div class="dialog-footer"><div>${entry && canEdit(entry) ? `<button type="button" class="text-button danger delete-entry" data-action="delete" data-id="${esc(entry.id)}">移到回收站</button>` : ''}<span id="draft-status" role="status">${!entry && (draft.content || draft.title || draft.tags?.length || draft.tagText) ? '已恢复草稿' : ''}</span></div><button type="submit" class="primary">${icon('check')}${entry ? '保存修改' : '收好这一刻'}</button></div></form>`, 'editor-dialog');
  editorId = entry?.id || null;
  editorTags = mountEntryTags(modalRoot.querySelector('.editor-tags'), { tags: data.tags, tagText: draft.tagText, onChange: scheduleDraft });
  editorAttachments = (entry?.media || []).map(media => ({ key: crypto.randomUUID(), kind: 'media', media }));
  unmountEntryBody = mountEntryBody(modalRoot.querySelector('.editor-body-field'));
  unmountEntryUpload = mountEntryUpload(modalRoot.querySelector('.editor-dropzone'), addEditorFiles);
  unmountEntryEmoji = mountEntryEmoji(modalRoot.querySelector('.entry-emoji'), modalRoot.querySelector('#entry-content'), addEditorFiles);
  renderEditorPreviews();
}
function addEditorFiles(files) {
  if (!files.length) return;
  const error = modalRoot.querySelector('#editor-upload-error');
  const badFile = files.find(file => !ALLOWED_FILE_TYPES[file.type] || file.size <= 0 || file.size > CONFIG.maxFileBytes);
  const existingImages = editorAttachments.filter(item => (item.kind === 'media' ? item.media.type : ALLOWED_FILE_TYPES[item.file.type]) === 'image').length;
  const totalImages = existingImages + files.filter(file => ALLOWED_FILE_TYPES[file.type] === 'image').length;
  if (badFile || editorAttachments.length + files.length > 10 || totalImages > CONFIG.maxImages) {
    error.textContent = badFile ? `无法添加“${badFile.name}”，请检查格式与大小。` : '每条记录最多添加 9 张图片、10 个附件。';
    return;
  }
  error.textContent = '';
  editorAttachments.push(...files.map(file => ({ key: crypto.randomUUID(), kind: 'file', file })));
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
  if (!handle?.closest('#editor-previews') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const from = editorAttachments.findIndex(item => item.key === handle.dataset.key);
  const to = event.key === 'Home' ? 0 : event.key === 'End' ? editorAttachments.length - 1 : from + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
  if (from < 0 || to < 0 || to >= editorAttachments.length || from === to) return;
  const [item] = editorAttachments.splice(from, 1); editorAttachments.splice(to, 0, item);
  renderEditorPreviews();
  document.querySelector(`.preview-handle[data-key="${item.key}"]`)?.focus({ preventScroll: true });
});
function showDetail(id, commentId) {
  const entry = visibleEntries().find(e => e.id === id); if (!entry) return;
  const shared = pointsUi && state.currentUser.role === 'member' && !entry.deletedAt && entry.type !== 'whisper';
  const comments = entry.comments || [];
  const commentsMarkup = comments.map(comment => {
    const author = user(comment.authorId), parent = comments.find(value => value.id === comment.replyToId);
    return `<div id="comment-${esc(comment.id)}" class="comment-row${comment.replyToId ? ' is-reply' : ''}">${avatar(author, true)}<div><strong>${esc(author.name)}</strong>
      ${parent ? `<small class="comment-reply-to">回复 ${esc(user(parent.authorId).name)}</small>` : ''}
      <p>${esc(comment.content)}</p><div class="comment-actions"><time datetime="${esc(comment.createdAt)}">${dateLabel(comment.createdAt, true, true)}</time>
      ${shared && comment.authorId !== state.currentUser.id ? `<button type="button" class="text-button" data-action="reply-comment" data-id="${esc(comment.id)}">回复</button>` : ''}</div></div></div>`;
  }).join('');
  openDialog(`<h2>${esc(entry.title || (entry.type === 'whisper' ? '给自己的一页' : '日常的一页'))}</h2><p class="dialog-description">${esc(user(entry.authorId).name)} · ${dateLabel(entry.occurredAt, true, true)}${entry.type === 'whisper' ? ' · 仅作者和管理员可见' : ''}</p><p class="detail-body">${renderEntryText(entry.title, entry.content)}</p>
    ${comments.length ? `<section class="comments" aria-label="留言">${commentsMarkup}</section>` : ''}
    <form id="comment-form" data-id="${esc(id)}"><div class="comment-reply-target" hidden><span></span><button type="button" class="text-button" data-action="cancel-comment-reply">取消回复</button></div>
    <label class="sr-only" for="comment-content">留言内容</label><textarea id="comment-content" name="content" rows="2" maxlength="2000" required placeholder="看到这段回忆，想起了什么？"></textarea><button class="primary" type="submit">留在这一页</button><p class="form-error" role="alert"></p></form>`, 'detail-dialog');
  const dialog = modalRoot.querySelector('.detail-dialog');
  if (!dialog) return;
  if (!entry.deletedAt && entry.type !== 'whisper') dialog.dataset.assistantArticle = entry.id;
  syncAssistant();
  if (commentId) {
    const comment = document.getElementById(`comment-${commentId}`);
    if (comment && dialog.contains(comment)) { comment.classList.add('comment-linked'); comment.scrollIntoView({ block: 'nearest' }); }
  }
}
function setCommentReply(id) {
  const form = modalRoot.querySelector('#comment-form'), target = form?.querySelector('.comment-reply-target');
  if (!target) return;
  const comment = visibleEntries().find(entry => entry.id === form.dataset.id)?.comments.find(item => item.id === id);
  form.dataset.replyTo = comment?.id || '';
  target.hidden = !comment;
  target.firstElementChild.textContent = comment ? `回复 ${user(comment.authorId).name}` : '';
  form.elements.content.focus();
}
async function openPointsNotification(item) {
  if (item.order_id && state.currentUser?.role === 'admin') {
    closeModal(false);
    location.hash = `shop-admin?order=${encodeURIComponent(item.order_id)}`;
    return;
  }
  if (!item.entry_id) return;
  const identity = state.currentUser?.id;
  await provider.refresh();
  if (state.currentUser?.id !== identity) return;
  const entry = visibleEntries().find(row => row.id === item.entry_id && !row.deletedAt && row.type !== 'whisper');
  if (!entry) { toast('这条记录已不可查看。', true); return; }
  showDetail(entry.id, item.comment_id);
}
function openLinkedEntry() {
  if (!state.currentUser || route() !== 'timeline') return;
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('entry');
  if (id && visibleEntries().some(entry => entry.id === id && !entry.deletedAt)) showDetail(id);
}
function showMedia(id, index = 0) {
  const entry = visibleEntries().find(e => e.id === id), file = entry?.media[index]; if (!file) return;
  if (file.unavailable) { toast('这份附件暂时无法加载，请刷新页面重试。', true); return; }
  openDialog(mediaViewerMarkup({ file, title: entry.title, date: dateLabel(entry.occurredAt, true, true), index, count: entry.media.length, entryId: id }), 'media-viewer');
  const dialog = modalRoot.querySelector('dialog');
  dialog.setAttribute('aria-label', `${file.type === 'video' ? '视频' : '图片'}预览`);
  mediaViewer = mountMediaViewer(dialog);
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
      case 'open-search': showMobileSearch(button); break;
      case 'profile': showProfileEditor(button); break;
      case 'open-feed-date': showFeedDatePicker(button); break;
      case 'apply-feed-date':
        filters.month = value.slice(0, 7);
        selectedDay = value.length === 10 ? value : '';
        if (filters.month) calendarCursor = filters.month;
        closeModal();
        render();
        scrollToPageTop();
        break;
      case 'filter-type': filters.type = value; render(); break;
      case 'filter-tag': filters.tag = filters.tag === value ? '' : value; render(); break;
      case 'refresh-admin-activity': await loadAdminActivity(); break;
      case 'filter-media': filters.mediaType = value; render(); break;
      case 'clear-filters': clearTimeout(searchTimer); Object.assign(filters, { query: '', tag: '', type: 'all', mood: 'all', authorId: 'all', month: '', mediaType: 'all' }); selectedDay = ''; render(); break;
      case 'search-tag': clearTimeout(searchTimer); filters.tag = value; filters.query = ''; filters.type = 'all'; selectedDay = ''; if (route() !== 'timeline') history.pushState(null, '', '#timeline'); render(); break;
      case 'stats-tag':
        event.preventDefault();
        clearTimeout(searchTimer);
        Object.assign(filters, { tag: value, query: '', type: 'all', mood: 'all', authorId: 'all' });
        selectedDay = ''; feedTagsExpanded = false;
        if (filters.month) calendarCursor = filters.month;
        history.pushState(null, '', '#timeline'); render(); scrollToPageTop();
        document.getElementById(`filter-tag-value-${encodeURIComponent(value)}`)?.focus({ preventScroll: true });
        break;
      case 'reaction': button.disabled = true; await provider.toggleReaction(id); render(); break;
      case 'favorite': button.disabled = true; await provider.toggleFavorite(id); render(); break;
      case 'detail': showDetail(id); break;
      case 'reply-comment': setCommentReply(id); break;
      case 'cancel-comment-reply': setCommentReply(null); break;
      case 'points-confirm-memory': {
        const identity = state.currentUser?.id;
        const confirmed = button.getAttribute('aria-pressed') !== 'true';
        button.disabled = true;
        try {
          const snapshot = await provider.pointsSetMemoryConfirmation(id, confirmed);
          if (state.currentUser?.id !== identity) break;
          pointsUi?.refreshSummary(snapshot);
          const memory = snapshot.memories?.find(entry => entry.entry_id === id);
          toast(!confirmed ? '已取消你的确认。' : memory?.complete ? '双方已确认这段回忆。' : '你已确认，等对方确认。');
        } finally { if (button.isConnected) button.disabled = false; }
        break;
      }
      case 'ask-guazi': {
        const entry = visibleEntries().find(row => row.id === id && !row.deletedAt && ['note', 'event'].includes(row.type));
        if (entry) assistant?.openForEntry?.(entry.id, entry.title);
        break;
      }
      case 'media': showMedia(id, Number(index)); break;
      case 'retry-media': {
        button.disabled = true; await provider.init(); render();
        const missing = state.entries.some(entry => entry.media.some(file => file.unavailable));
        toast(missing ? '部分附件仍未能连接，请检查网络或原文件。' : '附件已重新加载。', missing); break;
      }
      case 'delete': await provider.deleteEntry(id); closeModal(); render(); toast('已移到回收站，可以恢复。'); break;
      case 'restore': await provider.restoreEntry(id); render(); toast('这段回忆已经回来了。'); break;
      case 'purge-trash': confirmTrashPurge(id, button); break;
      case 'purge-trash-confirm': {
        const identity = state.currentUser?.id;
        button.disabled = true;
        try {
          const result = await provider.purgeTrash(id || null);
          if (state.currentUser?.id !== identity) break;
          if (button.isConnected) closeModal(false);
          render();
          toast(result.pending ? `已永久清理 ${result.deleted} 条，还有 ${result.pending} 条正在处理。`
            : result.deleted ? `已永久清理 ${result.deleted} 条记录和附件。` : '回收站已更新。');
        } catch (error) {
          if (!button.isConnected || state.currentUser?.id !== identity) throw error;
          button.closest('dialog').querySelector('.form-error').textContent = error.message;
        } finally { if (button.isConnected) button.disabled = false; }
        break;
      }
      case 'remove-media': editorAttachments.splice(Number(index), 1); modalRoot.querySelector('#editor-upload-error').textContent = ''; renderEditorPreviews(); break;
      case 'calendar-day':
        selectedDay = selectedDay === value ? '' : value;
        filters.month = value.slice(0, 7);
        render();
        break;
      case 'calendar-prev': case 'calendar-next':
        calendarCursor = shiftCalendarMonth(calendarCursor, action === 'calendar-next' ? 1 : -1);
        render();
        break;
      case 'add-anniversary': document.querySelector('#anniversary-fields').insertAdjacentHTML('beforeend', anniversaryFields()); mountDatePickers(app); break;
      case 'remove-anniversary': button.closest('.anniversary-fields').remove(); break;
      case 'export-mine': button.disabled = true; await exportData('mine'); button.disabled = false; break;
      case 'export-all': button.disabled = true; await exportData('all'); button.disabled = false; break;
      case 'reset-demo': info('恢复初始演示内容', '<p>这会替换此浏览器的试写和设置。需要的记录请先导出。</p><button class="secondary" data-action="confirm-reset">确认恢复示例</button>'); break;
      case 'confirm-reset': state = await provider.resetDemo(); closeModal(); render(); toast('已恢复初始示例。'); break;
      case 'resume-demo': await provider.switchUser(value); render(); break;
      case 'updates': showUpdates(); break;
      case 'login-photos': {
        if (!loginPhotos || !state.currentUser) throw new Error('请先登录后再编辑照片。');
        openDialog(loginPhotoEditorMarkup(), 'login-photos-dialog');
        loginPhotoEditor = mountLoginPhotoEditor(modalRoot, { provider: loginPhotos, prepareFile: prepareLoginPhoto,
          onSaved: manifest => { closeModal(false); toast(manifest?.cleanupPending ? '登录页照片已更新，部分旧文件等待清理。' : '登录页照片已更新。'); },
          onCancel: () => closeModal(),
        });
        break;
      }
      case 'logout': {
        let failure;
        syncAssistant(true);
        try { await provider.logout(); } catch (error) { failure = error; }
        finally { clearDrafts(); state.currentUser = null; closeModal(false); render(); }
        if (failure) toast('本机已退出；网络异常，服务器会话退出尚未确认。', true);
        break;
      }
      case 'about-mode':
        if (CONFIG.mode === 'demo') {
          info('现在是演示空间', '<p>你看到的称呼、日期和回忆都是示例。可以切换示例视角、试写、添加照片、留言、收藏和导出。</p><p>这些操作只保存在当前浏览器，不会同步到另一台设备。此公开演示不接收真实密码，请使用非私密的测试素材。</p>');
        } else if (state.currentUser?.role === 'admin') {
          info('共同空间的可见范围', '<p>日常随记和重要事件在共同空间内共享；悄悄话仅作者和管理员可见，对方无法查看。</p><p>管理员可读取和维护全部已发布内容。将共享记录改为悄悄话，无法即时收回此前的副本、缓存和已签发链接。</p><p>文字草稿留在当前会话，退出时清除。</p>');
        }
        break;
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
    if (!form || !editorTags || editorId || !state.currentUser) return;
    const data = Object.fromEntries(new FormData(form));
    data.occurredAt += ':00+08:00';
    Object.assign(data, editorTags.draft());
    sessionStorage.setItem(`memory-draft:${CONFIG.mode}:${state.currentUser.id}`, JSON.stringify(data));
    const status = document.querySelector('#draft-status');
    if (status) status.textContent = '草稿已保存';
  } catch {}
}
function scheduleDraft() {
  if (editorId) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 250);
}

function updateSearch(input) { filters.query = input.value; clearTimeout(searchTimer); searchTimer = setTimeout(render, 250); }
document.addEventListener('compositionend', event => { if (event.target.id === 'search') updateSearch(event.target); });
document.addEventListener('input', event => {
  if (event.target.id === 'search' && !event.isComposing) updateSearch(event.target);
  if (event.target.closest('#entry-form') && !event.target.closest('.editor-tags') && event.target.type !== 'file') scheduleDraft();
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
    if (event.target.id === 'admin-activity-period') await loadAdminActivity(Number(event.target.value));
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'search-form' || form.id === 'mobile-search-form') {
    event.preventDefault();
    clearTimeout(searchTimer);
    filters.query = new FormData(form).get('query').trim();
    const mobile = form.id === 'mobile-search-form';
    if (mobile) closeModal();
    render();
    if (mobile) scrollToPageTop();
    return;
  }
  if (!['entry-form', 'settings-form', 'comment-form', 'login-form'].includes(form.id)) return;
  event.preventDefault();
  if (form.id === 'login-form' && loginPending) return;
  if (form.id === 'entry-form' && form.hasAttribute('data-saving')) return;
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'entry-form') {
      const tags = editorTags.validatedTags();
      if (!tags) return;
      const identity = state.currentUser.id;
      const previous = editorId ? state.entries.find(entry => entry.id === editorId) : null;
      const files = editorAttachments.filter(item => item.kind === 'file').map(item => item.file);
      const media = editorAttachments.filter(item => item.kind === 'media').map(item => item.media);
      let fileIndex = 0;
      const mediaOrder = editorAttachments.map(item => item.kind === 'media' ? { id: item.media.id } : { fileIndex: fileIndex++ });
      const locked = [...form.closest('dialog').querySelectorAll('.editor-layout, .editor-tags, .delete-entry, .dialog-close')].filter(element => !element.inert);
      const draftStatus = form.querySelector('#draft-status'), previousLabel = submit.innerHTML;
      clearTimeout(draftTimer); persistDraft();
      const previousStatus = draftStatus.textContent;
      form.dataset.saving = '';
      locked.forEach(element => { element.inert = true; });
      form.querySelector('#form-error').textContent = '';
      submit.textContent = files.length ? '正在上传附件…' : '正在保存…';
      submit.setAttribute('aria-busy', 'true');
      draftStatus.classList.add('sr-only');
      draftStatus.textContent = submit.textContent;
      let saved;
      try {
        saved = await provider.saveEntry({ ...previous, title: data.title.trim(), content: data.content.trim(), type: data.type,
          occurredAt: `${data.occurredAt}:00+08:00`, mood: data.mood || null, tags, media, mediaOrder }, files);
      } finally {
        if (form.isConnected) {
          delete form.dataset.saving;
          locked.forEach(element => { element.inert = false; });
          submit.innerHTML = previousLabel;
          submit.removeAttribute('aria-busy');
          draftStatus.classList.remove('sr-only');
          draftStatus.textContent = previousStatus;
        }
      }
      if (!form.isConnected || state.currentUser?.id !== identity) return;
      sessionStorage.removeItem(`memory-draft:${CONFIG.mode}:${identity}`);
      closeModal(false); render(); toast(saved?.cleanupWarning || (previous ? '细节已经好好收好了。' : '这一刻，已经留住了。'));
      if (!previous?.id && ['note', 'event'].includes(data.type) && state.currentUser.role === 'member') pointsUi?.refreshSummary();
    } else if (form.id === 'settings-form') {
      if (!state.currentUser) throw new Error('请先登录。');
      const anniversaries = readAnniversaries(form.querySelector('#anniversary-fields'));
      await provider.saveSettings({ ...state.settings, spaceName: data.spaceName.trim(), subtitle: data.subtitle.trim(), startDate: data.startDate, anniversaries }); render(); toast('我们的小世界，已更新。');
    } else if (form.id === 'comment-form') {
      const id = form.dataset.id, replyTo = form.dataset.replyTo || null, content = data.content.trim();
      const key = JSON.stringify([state.currentUser.id, id, replyTo, content]);
      if (commentRequest?.key !== key) commentRequest = { key, id: crypto.randomUUID() };
      const saved = await provider.addComment(id, content, replyTo, commentRequest.id);
      commentRequest = null;
      render(); showDetail(id, saved?.id); toast(replyTo ? '回复已发送。' : '你的话，留在这段回忆里了。');
    }
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
      form.reset(); render(); openLinkedEntry();
    }
  } catch (error) {
    if (form.id === 'entry-form' && !form.isConnected) return;
    if (!state.currentUser && form.id !== 'login-form') {
      clearDrafts(); closeModal(false); render(); toast('登录已失效，请重新登录。', true);
    } else {
      const target = form.id === 'login-form' ? document.querySelector('#login-form .form-error')
        : form.querySelector(form.id === 'entry-form' ? '#form-error' : '.form-error');
      if (target) target.textContent = error.message; else toast(error.message, true);
    }
  }
  finally { if (submit?.isConnected) submit.disabled = form.id === 'login-form' ? !loginVerification?.getToken() : false; }
});
window.addEventListener('hashchange', () => {
  if (bootPending || (!provider && CONFIG.mode !== 'preview')) return;
  clearTimeout(searchTimer);
  if (modalRoot.querySelector('.search-dialog, .feed-date-dialog, .detail-dialog, .trash-confirm-dialog')) closeModal();
  feedTagsExpanded = false;
  expandedEntries.clear();
  selectedDay = '';
  Object.assign(filters, { query: '', tag: '', month: '', type: route() === 'events' ? 'event' : 'all' });
  render();
  openLinkedEntry();
  scrollToPageTop();
});
window.addEventListener('memory:session-ended', () => {
  unmountEntryPreviews?.();
  expandedEntries.clear();
  recoveryEpoch++; reconnectAttempt = null; reconnectError = null; reconnectPending = false; bootPending = true;
  provider?.dispose?.(); state.currentUser = null; syncAssistant(true); clearDrafts(); closeModal(false);
  loginCarousel?.destroy(); loginCarousel = null;
  app.innerHTML = '<main class="boot"><h1>登录状态已更新</h1><p>正在重新打开我们的空间…</p></main>';
});

function renderLogin() {
  loginVerification?.destroy(); loginVerification = null;
  loginCarousel?.destroy(); loginCarousel = null;
  if (CONFIG.mode === 'demo') {
    app.innerHTML = `<main class="boot"><img src="./assets/mark.svg" alt="" width="48" height="48" /><h1>选一个示例视角</h1><p>这是本机演示，不需要密码。</p>${state.users.map(u => `<button class="secondary" data-action="resume-demo" data-value="${esc(u.id)}">${esc(u.name)}</button>`).join('')}</main>`;
    return;
  }
  const preview = CONFIG.mode === 'preview';
  app.innerHTML = `<main class="login-page"><div class="login-layout"><section class="login-story" aria-label="朝夕"><div class="login-story-copy"><p class="login-intro">留给两个人的地方</p><h1>把日子过成故事，<br>把我们写进朝夕。</h1><p>一顿晚饭，一次远行，<br>还有那些说不完的小事。<br>都值得好好记住。</p></div><p class="login-story-end">朝夕之间，都是我们。</p></section><section class="login-panel" aria-labelledby="login-title"><header class="login-panel-heading"><div class="login-brand" aria-label="朝夕，我们的记忆"><img src="./assets/mark.svg" alt="" width="44" height="44" /><span>朝夕<small>我们的记忆</small></span></div><div class="login-lock">${icon('lock')}<span>${preview ? '登录预览' : '我们的共同空间'}</span></div></header><h2 id="login-title">好久不见，欢迎回家</h2><p>登录后，翻开属于我们的那一页。</p><form id="login-form"><label for="login-username">账号<input id="login-username" name="username" autocomplete="${preview ? 'off' : 'username'}" placeholder="输入你的账号" maxlength="64" autocapitalize="none" spellcheck="false" required ${preview ? 'disabled' : ''} /></label><label for="login-password">密码<input id="login-password" name="password" type="password" autocomplete="${preview ? 'off' : 'current-password'}" placeholder="输入你的密码" maxlength="256" required ${preview ? 'disabled' : ''} /></label><div class="login-verification"><div id="login-captcha"></div><p id="verification-status" role="status">${preview ? '正式登录服务尚未接通。' : '正在准备安全验证…'}</p><button type="button" id="verification-retry" class="text-button" hidden>重新加载验证</button></div><p class="form-error" role="alert"></p><button type="submit" class="primary" disabled>翻开我们的记忆${icon('arrow')}</button></form>${preview ? '<p class="login-preview-note">当前是 GitHub Pages 登录预览。私密空间待后端开通后启用，这里不会提交账号密码，也不会展示回忆。</p>' : `<p class="login-footnote">${icon('lock')}仅限受邀账号 · 不开放注册<br />本设备会保持登录，公用设备使用后请退出。</p>`}<button class="text-button login-updates" data-action="updates">系统更新信息</button></section></div></main>`;
  if (!preview) {
    mountLoginPhotoStory();
    if (loginPending) {
      document.querySelector('#login-form').setAttribute('aria-busy', 'true');
      document.querySelectorAll('#login-form input').forEach(input => { input.disabled = true; });
    }
    loginVerification = mountLoginVerification(app, {
      isBusy: () => loginPending,
      ...(CONFIG.mode === 'supabase' ? { getConfig: async () => ({ configured: CONFIG.authReady === true && Boolean(CONFIG.turnstileSiteKey), siteKey: CONFIG.turnstileSiteKey, action: 'login' }) } : {}),
    });
  }
  syncAssistant(true);
}

function renderReconnect(error = null) {
  loginVerification?.destroy(); loginVerification = null;
  loginCarousel?.destroy(); loginCarousel = null;
  app.innerHTML = `<main class="boot"><img src="./assets/mark.svg" alt="" width="48" height="48" /><h1>${error ? '暂时未能连接' : '正在恢复登录…'}</h1><p>${error ? esc(error.message || '请检查网络后重新连接。') : '正在确认本设备的登录状态。'}</p>${error ? `<button class="secondary" data-action="${provider ? 'reconnect' : 'retry'}">重新连接</button>` : ''}</main>`;
  syncAssistant(true);
}
async function reconnect() {
  if (reconnectAttempt) return reconnectAttempt;
  const epoch = recoveryEpoch;
  reconnectError = null; reconnectPending = true; renderReconnect();
  const attempt = (async () => {
    try { const restored = await provider.init(); if (epoch !== recoveryEpoch) return; state = restored; reconnectPending = false; render(); openLinkedEntry(); }
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
        syncAssistant(true); clearDrafts(); closeModal(false); reconnectError = null; reconnectPending = restore;
        // Restore only after Auth verifies the new identity. Never keep the old
        // account's rendered text or media while another tab changes accounts.
        if (restore) { const eventEpoch = recoveryEpoch; renderReconnect(); setTimeout(() => { if (eventEpoch === recoveryEpoch) reconnect(); }, 0); } else render();
      } });
      loadOptionalLoginPhotos(module => module.createLoginPhotosProvider({ client, getCurrentUser: () => state.currentUser }));
    } else {
      provider = (await import('./demo-provider.js')).createDemoProvider();
      loadOptionalLoginPhotos(module => module.createDemoLoginPhotosProvider({ getCurrentUser: () => state.currentUser }));
    }
    const restored = await provider.init(); if (bootEpoch === recoveryEpoch) state = restored;
  }
  if (bootEpoch === recoveryEpoch) { render(); openLinkedEntry(); }
}
catch (error) { if (bootEpoch === recoveryEpoch) showRestoreFailure(error); }
finally { bootPending = false; }
