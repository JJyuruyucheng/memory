import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { loadLocalScript } from './local-script.js';
import { mountFileDrop } from './file-drop.js';

const routes = { points: '我的积分', shop: '积分商城', backpack: '我的背包', 'shop-admin': '商城管理' };
const milestones = [7, 30, 180, 365];
const coverOptions = Object.entries({
  drink: '饮料', dessert: '甜点', gift: '礼物', transport: '交通', reconcile: '和好',
  movie: '电影', cash: '现金券', flight: '机票',
}).map(([id, label]) => [`./assets/reward-covers/${id}.webp`, label]);
const coverMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
const amountFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const bell = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4"/></svg>';
const ledgerLabels = {
  checkin: '每日签到', daily_checkin: '每日签到', streak: '连续签到奖励', checkin_streak: '连续签到奖励',
  post: '发布记录', write: '发布记录', entry: '发布记录', publish: '发布记录', like: '点赞',
  comment: '评论', reply: '回复', anniversary: '纪念日', memory: '共同回忆', challenge: '共同挑战',
  redeem: '兑换', exchange: '兑换', redemption: '兑换',
};
const notificationLabels = {
  post: '发布了一篇新记录', like: '给你的记录点了赞', comment: '给你留了一条评论',
  reply: '回复了你的评论', exchange: '兑换了商城商品', redeem: '兑换了商城商品', redemption: '兑换了商城商品',
  memory: '确认了一段共同回忆', challenge: '确认了一项共同挑战',
};
const operationErrors = {
  POINTS_CHANGED: '商品已更新。请关闭窗口，查看最新价格和库存后再操作。',
  POINTS_SOLD_OUT: '这件商品已经兑完。',
  POINTS_LOW_BALANCE: '积分不足，请查看最新余额。',
  POINTS_UNAVAILABLE: '这项内容暂时不可用。',
  POINTS_INVALID_PRODUCT: '请检查商品资料、所需积分和库存。',
  POINTS_INVALID_CHALLENGE: '请检查挑战标题、说明和奖励积分。',
  POINTS_REQUEST_CONFLICT: '这次兑换请求已经处理，请先查看背包。',
};
const errorCode = error => /^POINTS_[A-Z_]+$/.test(error?.code ?? '') ? error.code : error?.message?.match(/POINTS_[A-Z_]+/)?.[0];

const amount = cents => Number.isSafeInteger(cents) ? amountFormat.format(cents / 100) : '—';
const credits = cents => `${amount(cents)} 分`;
function date(value) {
  if (!value) return '';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? '' : dateFormat.format(timestamp);
}
const time = value => value ? `<time datetime="${esc(value)}">${esc(date(value))}</time>` : '';
const link = (route, label = routes[route]) => `<a class="points-link" href="#${route}">${esc(label)}</a>`;
const button = (action, label, { id, primary = false, disabled = false, more = '' } = {}) =>
  `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-points-action="${action}"${id ? ` data-points-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}${more}>${esc(label)}</button>`;
const panel = (title, body, cls = '') => `<section class="points-panel ${cls}"><h2>${title}</h2>${body}</section>`;
const status = text => `<p class="points-feedback" role="status">${esc(text)}</p>`;
const err = text => `<p class="points-feedback points-error" role="status">${esc(text)}</p>`;

function coverUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  return coverOptions.some(([path]) => path === value)
    || (value.length <= 240023 && /^data:image\/webp;base64,[a-z0-9+/=]+$/i.test(value)) ? value : '';
}

function cover(value) {
  const url = coverUrl(value);
  return `<div class="points-cover" aria-hidden="true">${icon('bookmark')}${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" />` : ''}</div>`;
}

function coverUploadMarkup() {
  return `<div class="points-cover-upload">
    <label class="upload-control points-cover-dropzone" data-points-cover-drop>
      ${icon('photo')}<span>选择新封面</span><small>也可拖入图片</small>
      <input type="file" name="cover" accept="${coverMimeTypes.join(',')}" aria-describedby="points-cover-format points-cover-selection" />
    </label>
    <small class="points-cover-format" id="points-cover-format">一张 JPG、PNG 或 WebP，最多 10 MB。</small>
    <div class="points-cover-selection-row">
      <p id="points-cover-selection" class="points-cover-selection" role="status"></p>
      <button type="button" class="text-button" data-points-cover-clear hidden>清除选图</button>
    </div>
  </div>`;
}

function coverFileProblem(files) {
  if (files.length !== 1) return '一次只能选择一张封面图片。';
  const [file] = files;
  if (!file.size || file.size > 10_000_000) return '请选择不超过 10 MB 的图片文件。';
  const unknownType = !file.type || file.type === 'application/octet-stream';
  if (!coverMimeTypes.includes(file.type) && !(unknownType && /\.(?:jpe?g|png|webp)$/i.test(file.name))) {
    return '请选择 JPG、PNG 或 WebP 图片。';
  }
  return '';
}

function dataBody(key, store, render) {
  const current = store.get(key);
  if (current?.error && current.value === undefined) {
    return `${err(current.error)}${button('reload', '重试', { id: key })}`;
  }
  if (current?.value === undefined) return status('正在读取…');
  const feedback = current.error ? `${err(current.error)}${button('reload', '重新读取', { id: key })}` : '';
  return `${feedback}${render(current.value)}`;
}

function parseCredits(input) {
  const value = String(input).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('积分请填写至多两位小数的非负数字。');
  const [whole, fraction = ''] = value.split('.');
  const parsed = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(parsed)) throw new Error('积分数值太大。');
  return parsed;
}

function milestonesMarkup(streak) {
  return `<ul class="points-streak" aria-label="连续签到里程碑">${milestones.map(days => {
    const reached = streak >= days;
    return `<li data-achieved="${reached}"><strong>${days} 天</strong><span>${days} 分</span><span>${reached ? '已达到' : '未达到'}</span></li>`;
  }).join('')}</ul>`;
}

function checkinStatus(summary, countdown, failed) {
  if (summary?.checked_in) return `已签 · ${summary.streak ?? 0} 天`;
  if (countdown !== null) return countdown > 0 ? `签到 ${countdown} 秒` : '签到确认中';
  return failed ? '签到待重试' : summary ? '今日待签到' : '签到读取中';
}

const calendarBalanceLabel = balance => `可用积分 ${balance}，查看我的积分`;

function rulesMarkup() {
  return `<ol class="points-rule-list">
    <li>北京时间每日前台停留 60 秒自动签到，得 0.5 分。</li>
    <li>每轮连签满 7、30、180、365 天，分别奖同等积分。天数持续累计，断签后重开一轮。</li>
    <li>发布帖子得1分。收到对方有效点赞、评论或回复，各得 0.2 分。</li>
    <li>共同回忆双方都确认后，作者得 5 分。共同挑战按设定奖励发放。</li>
    <li>每年 1 月 1 日发放 50 分纪念日积分。</li>
    <li>兑换扣积分和库存，兑换及使用不可撤销。现金券与补贴按 1 分抵 1 元线下兑现。</li>
  </ol>`;
}

function balanceMarkup(summary, extra = '') {
  return panel('我的积分', `<strong>${amount(summary?.balance)}<small>分</small></strong>${extra}`, 'points-balance');
}

function ledgerMarkup(rows) {
  if (!rows?.length) return status('暂时还没有积分明细。');
  return `<ul class="points-list">${rows.map(row => {
    const label = ledgerLabels[row.kind] ?? '积分变动';
    const title = esc(row.title ?? label);
    const detail = row.entry_id ? `<a class="points-link" href="#timeline?entry=${encodeURIComponent(row.entry_id)}">${title}</a>` : `<strong>${title}</strong>`;
    return `<li class="points-row"><div>${detail}<p>${time(row.created_at)}</p></div>
      <span class="points-amount" data-credit="${row.amount > 0}">${row.amount > 0 ? '+' : ''}${credits(row.amount)}</span></li>`;
  }).join('')}</ul>`;
}

function confirmedBy(row, user) {
  const ids = row.confirmed_by ?? [];
  return Array.isArray(ids) && (ids.includes(user?.id) || ids.includes(user?.slot));
}

function challengeMarkup(rows, user) {
  if (!rows?.length) return status('暂时还没有共同挑战。');
  return `<ul class="points-list">${rows.map(row => {
    const confirmed = confirmedBy(row, user);
    const state = row.complete ? '已完成' : confirmed ? '等待对方确认' : '等待你确认';
    return `<li class="points-row"><div><h3>${esc(row.title)}</h3>${row.description ? `<p>${esc(row.description)}</p>` : ''}
      <p>${credits(row.reward)} · ${state}</p></div>${!row.complete && !confirmed ? button('confirm-challenge', '确认完成', { id: row.id }) : ''}</li>`;
  }).join('')}</ul>`;
}

function adminChallengeMarkup(rows) {
  if (!rows?.length) return status('还没有发布共同挑战。');
  return `<ul class="points-list">${rows.map(row => {
    const count = row.confirmed_by?.length ?? 0;
    return `<li class="points-row"><div><h3>${esc(row.title)}</h3>${row.description ? `<p>${esc(row.description)}</p>` : ''}</div>
      <div class="points-amount"><strong>${credits(row.reward)}</strong><p>${row.complete ? '已完成' : `${count}/2 已确认`}</p></div></li>`;
  }).join('')}</ul>`;
}

function memoriesMarkup(rows, user) {
  if (!rows?.length) return status('可以从符合条件的共同记录发起确认。');
  return `<ul class="points-list">${rows.map(row => {
    const state = row.complete ? '已完成' : confirmedBy(row, user) ? '等待对方确认' : '等待你确认';
    return `<li class="points-row"><div><h3>${esc(row.title || '共同回忆')}</h3><p>${state}</p></div>
      <a class="points-link" href="#timeline?entry=${encodeURIComponent(row.entry_id)}">查看记录</a></li>`;
  }).join('')}</ul>`;
}

function anniversaryMarkup(value) {
  if (!value) return status('暂时没有待领取的纪念日奖励。');
  const next = value.next_date || value.date;
  return `<p>${esc(value.title || '纪念日')}${next ? ` · ${esc(next)}` : ''}${Number.isSafeInteger(value.reward) ? ` · ${credits(value.reward)}` : ''}</p>`;
}

function productMarkup(row, balance, { admin = false, canSort = false } = {}) {
  const soldOut = row.stock <= 0;
  const insufficient = Number.isSafeInteger(balance) && balance < row.price;
  const label = soldOut ? '已兑完' : insufficient ? `还差 ${credits(row.price - balance)}` : '兑换';
  const productId = admin ? ` data-points-product="${esc(row.id)}"` : '';
  const offShelf = admin && row.active === false ? '<span class="points-product-off-shelf">已下架</span>' : '';
  const grip = canSort ? `<button class="points-product-grip" type="button" data-points-action="sort-grip" data-points-id="${esc(row.id)}"
    aria-label="调整${esc(row.name)}的顺序" title="拖动或使用方向键排序">${icon('grip')}</button>` : '';
  const tools = offShelf || grip ? `<div class="points-product-tools">${offShelf}${grip}</div>` : '';
  const action = admin ? button('edit-product', '编辑', { id: row.id, primary: true, more: ' aria-haspopup="dialog"' })
    : button('redeem', label, { id: row.id, primary: true, disabled: soldOut || insufficient || !Number.isSafeInteger(balance), more: ' aria-haspopup="dialog"' });
  return `<li class="points-panel points-product${admin ? ' points-admin-product' : ''}"${productId}>${cover(row.cover)}${tools}<div class="points-product-body">
    <h3>${esc(row.name)}</h3>${row.description ? `<p>${esc(row.description)}</p>` : ''}
    <div class="points-product-meta"><strong>${credits(row.price)}</strong><span>库存 ${esc(row.stock)}</span></div>
    ${action}
  </div></li>`;
}

function receiptMarkup(row, { admin = false, userName = '', selected = false } = {}) {
  return `<li class="points-row points-receipt"${selected ? ' data-points-selected tabindex="-1"' : ''}>
    <div class="points-receipt-details">${admin ? '' : cover(row.cover)}<div><h3>${esc(row.name)}</h3><p>${admin ? `${esc(userName)} · ` : ''}${credits(row.price)} · ${time(row.redeemed_at)}</p>
    ${row.used_at ? `<p>已使用 · ${time(row.used_at)}</p>` : '<p>待使用</p>'}</div></div>
    ${!admin && !row.used_at ? button('use', '使用', { id: row.id, more: ' aria-haspopup="dialog"' }) : ''}</li>`;
}

function orderList(rows, options = {}) {
  if (!rows.length) return status(options.emptyText ?? '还没有兑换记录。');
  return `<ul class="points-list">${rows.map(row => receiptMarkup(row, { ...options, selected: options.orderId === row.id, userName: options.name?.(row.user_id) })).join('')}</ul>`;
}

function adminProductMarkup(items, reorderable) {
  if (!items.length) return status('还没有商品。');
  const canSort = reorderable && items.length > 1;
  return `${canSort ? '<p class="points-sort-help" id="points-sort-help">拖动手柄排序，也可聚焦手柄后按方向键。</p>' : ''}
    <ol class="points-grid" aria-label="商品顺序"${canSort ? ' data-points-sort aria-describedby="points-sort-help"' : ''}>
      ${items.map(row => productMarkup(row, undefined, { admin: true, canSort })).join('')}</ol>`;
}

export function mountPointsUi({ app, modalRoot, provider, getUser, getUsers = () => [], getRoute, toast = () => {}, openNotification, onSummary }) {
  const store = new Map();
  const events = new AbortController();
  const { signal } = events;
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog points-dialog';
  dialog.setAttribute('aria-labelledby', 'points-dialog-title');
  document.body.append(dialog);
  let countdown = null;
  let previousRoute;
  let previousOrder;
  let inboxOpen = false;
  let dialogueBusy = false;
  let returnFocus;
  let busyChallenge = false;
  let dialogVersion = 0;
  let selectedCoverFile, coverDropEvents;
  let sortableList, sortable, dragging = false, savingOrder = false, adminDrawPending = false;
  const pendingRedemptions = new Map();

  const summary = () => store.get('summary')?.value;
  const notifications = () => store.get('notifications')?.value;
  const isAdmin = () => getUser()?.role === 'admin';
  const isMember = () => getUser()?.role === 'member';
  const userName = id => {
    const users = getUsers();
    const match = Array.isArray(users) ? users.find(user => user.id === id) : (users?.get?.(id) ?? users?.[id]);
    return typeof match === 'string' ? match : match?.name || '另一位成员';
  };
  const loadMethod = {
    summary: 'pointsSummary', catalog: 'pointsCatalog', backpack: 'pointsBackpack',
    notifications: 'pointsNotifications', adminCatalog: 'pointsAdminCatalog', adminOrders: 'pointsAdminOrders',
    adminChallenges: 'pointsAdminChallenges',
  };

  function set(key, value) {
    const item = store.get(key) ?? {};
    item.value = value;
    item.error = '';
    item.version = (item.version || 0) + 1;
    store.set(key, item);
    draw(key);
    if (key === 'summary') onSummary?.(value);
  }

  async function load(key, refresh = false) {
    const item = store.get(key) ?? {};
    if (signal.aborted || (!refresh && (item.value !== undefined || item.error))) return;
    if (item.loading) { item.reload ||= refresh; return; }
    item.loading = true; item.error = ''; store.set(key, item);
    const version = item.version;
    try {
      const value = await provider[loadMethod[key]]();
      if (!signal.aborted && item.version === version) set(key, value);
    } catch (error) {
      if (!signal.aborted && item.version === version) { item.error = error?.message || '读取失败，请稍后重试。'; draw(key); }
    } finally {
      item.loading = false;
      if (item.reload) { item.reload = false; void load(key, true); }
    }
  }

  const linkedOrder = () => new URLSearchParams(location.hash.split('?')[1] || '').get('order');

  function renderView(route) {
    if (!Object.hasOwn(routes, route)) return '';
    const allowed = isAdmin() ? route === 'shop-admin' : isMember() && route !== 'shop-admin';
    if (!allowed) return `<section class="points-page" data-ui><div class="points-heading"><h1>${routes[route]}</h1></div>${status('当前账号无法使用这一页。')}</section>`;
    const nav = isAdmin() ? '' : `<nav class="points-nav" aria-label="积分导航">${['points', 'shop', 'backpack'].map(key =>
      `<a href="#${key}"${key === route ? ' aria-current="page"' : ''}>${routes[key]}</a>`).join('')}</nav>`;
    return `<section class="points-page" data-ui><div class="points-heading"><h1>${routes[route]}</h1></div>
      ${nav}<div data-points-view="${route}" tabindex="-1">${viewBody(route)}</div></section>`;
  }

  function viewBody(route) {
    const wallet = summary();
    if (route === 'points') return dataBody('summary', store, state => `<div class="points-layout">
      <div class="points-wallet">${balanceMarkup(state, `<div class="points-card-actions">${link('shop', '去兑换')}</div>`)}</div>
      <div class="points-stack points-main">
        ${panel('积分规则', rulesMarkup())}
        ${panel('积分明细', ledgerMarkup(state.ledger))}
        ${panel('共同挑战', challengeMarkup(state.challenges, getUser()))}
        ${panel('共同回忆', memoriesMarkup(state.memories, getUser()))}
      </div><aside class="points-stack points-details" aria-label="积分概览">
        ${panel('连续签到', `<p>已连续 ${esc(state.streak ?? 0)} 天</p>${milestonesMarkup(state.streak ?? 0)}`)}
        ${panel('纪念日奖励', anniversaryMarkup(state.anniversary))}
      </aside></div>`);
    if (route === 'shop') return `<div class="points-store-balance">${link('points', `可用积分 ${credits(wallet?.balance)}`)}</div>
      ${store.get('summary')?.error ? dataBody('summary', store, () => '') : ''}
      <section aria-labelledby="points-shop-catalog"><h2 id="points-shop-catalog" class="sr-only">可兑换商品</h2>
      ${dataBody('catalog', store, items => {
        const available = items.filter(row => row.active !== false);
        return available.length ? `<ul class="points-grid">${available.map(row => productMarkup(row, wallet?.balance)).join('')}</ul>` : status('暂时没有上架商品。');
      })}</section>`;
    if (route === 'backpack') return dataBody('backpack', store, items => {
      const available = items.filter(item => !item.used_at);
      const used = items.filter(item => item.used_at);
      return `<div class="points-stack">
        ${panel('待使用', orderList(available, { emptyText: '没有待使用的商品。' }))}
        ${panel('已使用', orderList(used, { emptyText: '还没有使用过商品。' }))}
      </div>`;
    });
    if (route === 'shop-admin') return `<div class="points-stack">
      <section class="points-admin-products" aria-labelledby="points-admin-products-title">
        <div class="points-panel-header"><h2 id="points-admin-products-title">商品与库存</h2>${button('edit-product', '添加商品', { primary: true, more: ' aria-haspopup="dialog"' })}</div>
        ${dataBody('adminCatalog', store, items => adminProductMarkup(items, Boolean(provider.pointsAdminReorder)))}
      </section>
      ${panel('共同挑战', `<p>双方确认完成后发放积分。</p><div class="points-card-actions">${button('new-challenge', '发布挑战', { more: ' aria-haspopup="dialog"' })}</div>
        ${dataBody('adminChallenges', store, adminChallengeMarkup)}`)}
      ${panel('兑换记录', dataBody('adminOrders', store, items => orderList(items, { admin: true, name: userName, orderId: linkedOrder() })))}
    </div>`;
    return '';
  }

  function renderBell() {
    if (!isMember() && !isAdmin()) return '';
    return `<button type="button" class="points-bell" data-points-bell data-points-action="inbox" aria-label="消息通知" aria-haspopup="dialog">${bell}<span class="points-bell-count" hidden aria-hidden="true"></span></button>`;
  }

  function renderCheckin() {
    if (!isMember()) return '';
    const wallet = summary();
    const text = checkinStatus(wallet, countdown, Boolean(store.get('summary')?.error));
    const balance = credits(wallet?.balance);
    return `<span class="points-checkin" data-points-checkin>
      <span data-points-checkin-label title="在前台连续停留 60 秒自动签到">${esc(text)}</span>
      <a class="points-checkin-balance" data-points-checkin-balance href="#points" aria-label="${esc(calendarBalanceLabel(balance))}">${esc(balance)}</a>
      <span class="sr-only" role="status" data-points-checkin-status></span>
    </span>`;
  }

  function updateBell() {
    const count = notifications()?.unread ?? 0;
    for (const control of app.querySelectorAll('[data-points-bell]')) {
      control.setAttribute('aria-label', count ? `消息通知，${count} 条未读` : '消息通知');
      const badge = control.querySelector('.points-bell-count');
      badge.hidden = !count;
      badge.textContent = count > 99 ? '99+' : String(count);
    }
  }

  function updateCheckin(seconds) {
    const next = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
    if (countdown === next) return;
    countdown = next;
    paintCheckin();
  }

  function paintCheckin() {
    const wallet = summary(), failed = Boolean(store.get('summary')?.error);
    const text = checkinStatus(wallet, countdown, failed);
    const available = credits(wallet?.balance);
    const regions = [app, modalRoot].filter(Boolean).flatMap(root => [...root.querySelectorAll('[data-points-checkin]')]);
    for (const region of regions) {
      const balance = region.querySelector('[data-points-checkin-balance]');
      if (balance.textContent !== available) {
        balance.textContent = available;
        balance.setAttribute('aria-label', calendarBalanceLabel(available));
      }
      const label = region.querySelector('[data-points-checkin-label]');
      if (label.textContent === text) continue;
      label.textContent = text;
      if (wallet?.checked_in || failed) {
        region.querySelector('[data-points-checkin-status]').textContent = wallet?.checked_in ? `今日已签到，连续 ${wallet.streak ?? 0} 天` : '签到状态暂时无法读取';
      }
    }
  }

  const productRows = list => [...list.querySelectorAll(':scope > [data-points-product]')];
  const productIds = list => productRows(list).map(row => row.dataset.pointsProduct);

  function syncAdminSort() {
    const list = app.querySelector('[data-points-sort]');
    if (list === sortableList) return;
    sortable?.destroy();
    sortable = null;
    sortableList = list;
    dragging = false;
    if (!list) return;
    if (savingOrder) list.setAttribute('aria-busy', 'true');
    void loadLocalScript({
      url: new URL('../assets/sortable-1.15.7.js', import.meta.url),
      read: () => globalThis.Sortable,
      label: '商品排序组件',
    }).then(Sortable => {
      if (signal.aborted || list !== sortableList || !list.isConnected) return;
      sortable = new Sortable(list, {
        handle: '.points-product-grip', draggable: '.points-admin-product',
        direction(_event, target, item) { return target && item && target.offsetTop === item.offsetTop ? 'horizontal' : 'vertical'; },
        forceFallback: true, fallbackOnBody: true, fallbackClass: 'points-sort-fallback', fallbackTolerance: 4,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
        delay: 180, delayOnTouchOnly: true, ghostClass: 'points-sort-ghost', disabled: savingOrder,
        onStart() { dragging = true; },
        onEnd(event) {
          dragging = false;
          queueMicrotask(() => {
            if (signal.aborted || list !== sortableList) return;
            if (event.oldIndex !== event.newIndex) void saveProductOrder(list);
            else if (adminDrawPending) draw('adminCatalog');
          });
        },
      });
    }).catch(() => {});
  }

  async function saveProductOrder(list) {
    if (savingOrder) return;
    const ids = productIds(list);
    const current = store.get('adminCatalog')?.value ?? [];
    const products = new Map(current.map(row => [row.id, row]));
    if (ids.length !== products.size || ids.some(id => !products.has(id))) {
      draw('adminCatalog');
      toast('商品清单刚更新，请按最新清单重新排序。', true);
      return;
    }
    if (ids.every((id, index) => current[index].id === id)) {
      if (adminDrawPending) draw('adminCatalog');
      return;
    }
    savingOrder = true;
    list.setAttribute('aria-busy', 'true');
    sortable?.option('disabled', true);
    let reload = false;
    try {
      const result = await provider.pointsAdminReorder(ids);
      if (!signal.aborted) {
        set('adminCatalog', Array.isArray(result) ? result : ids.map(id => products.get(id)));
        toast('已保存商品顺序。');
      }
    } catch (error) {
      if (!signal.aborted) {
        reload = true;
        const changed = errorCode(error) === 'POINTS_CHANGED';
        toast(changed ? '商品清单刚更新，请按最新清单重新排序。' : error?.message || '商品顺序暂时无法保存。', true);
      }
    } finally {
      savingOrder = false;
      if (!signal.aborted) {
        draw('adminCatalog');
        if (reload) void load('adminCatalog', true);
      }
    }
  }

  function nextGridRow(rows, from, direction) {
    const origin = rows[from].getBoundingClientRect();
    const candidates = rows.map((row, index) => ({ index, box: row.getBoundingClientRect() }))
      .filter(({ box }) => (box.top - origin.top) * direction > 1)
      .sort((a, b) => Math.abs(a.box.top - origin.top) - Math.abs(b.box.top - origin.top)
        || Math.abs(a.box.left - origin.left) - Math.abs(b.box.left - origin.left));
    return candidates[0]?.index ?? -1;
  }

  function sortByKeyboard(event) {
    const grip = event.target.closest?.('.points-product-grip');
    const list = grip?.closest('[data-points-sort]');
    if (!list || dragging || savingOrder || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const rows = productRows(list);
    const row = grip.closest('[data-points-product]');
    const from = rows.indexOf(row);
    const to = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: rows.length - 1 }[event.key]
      ?? nextGridRow(rows, from, event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to === from || to >= rows.length) return;
    if (to < from) rows[to].before(row);
    else rows[to].after(row);
    grip.focus({ preventScroll: true });
    void saveProductOrder(list);
  }

  function draw(key) {
    const region = app.querySelector('[data-points-view]');
    const route = region?.dataset.pointsView;
    const dependencies = {
      points: ['summary'], shop: ['summary', 'catalog'], backpack: ['backpack'],
      'shop-admin': ['adminCatalog', 'adminOrders', 'adminChallenges'],
    };
    if (key !== 'notifications' && region && dependencies[route]?.includes(key)) {
      if (route === 'shop-admin' && (dragging || savingOrder)) { adminDrawPending = true; return; }
      const active = document.activeElement;
      const action = region.contains(active) ? active.dataset.pointsAction : null;
      const id = action ? active.dataset.pointsId : null;
      region.innerHTML = viewBody(route);
      if (action) (findControl(action, id, region) ?? region).focus({ preventScroll: true });
      if (route === 'shop-admin') {
        adminDrawPending = false;
        syncAdminSort();
        focusLinkedOrder();
      }
    }
    if (key === 'summary') paintCheckin();
    if (key === 'notifications') {
      updateBell();
      if (inboxOpen && dialog.open) updateInbox();
    }
  }

  function focusLinkedOrder() {
    const target = app.querySelector('[data-points-selected]');
    if (!target || previousOrder === linkedOrder()) return;
    previousOrder = linkedOrder();
    target.focus();
  }

  function sync() {
    const route = getRoute();
    const changed = route !== previousRoute;
    previousRoute = route;
    if (route !== 'shop-admin' || !linkedOrder()) previousOrder = null;
    if (changed && dialog.open && !inboxOpen) closeDialog();
    syncAdminSort();
    updateBell();
    paintCheckin();
    if (isMember() || isAdmin()) void load('notifications');
    if (isMember()) {
      void load('summary', changed && ['points', 'shop'].includes(route));
      if (route === 'shop') void load('catalog', changed);
      if (route === 'backpack') void load('backpack', changed);
    } else if (isAdmin() && route === 'shop-admin') {
      void load('adminCatalog', changed);
      void load('adminOrders', changed);
      void load('adminChallenges', changed);
      focusLinkedOrder();
    }
  }

  function findControl(action, id, host = app) {
    return [...host.querySelectorAll('[data-points-action]')].find(el => el.dataset.pointsAction === action && el.dataset.pointsId === id);
  }

  function closeDialog({ restore = true } = {}) {
    if (!dialog.open) return;
    inboxOpen = false;
    dialogVersion++;
    coverDropEvents?.abort();
    coverDropEvents = null;
    selectedCoverFile = null;
    dialog.close();
    const restoreTarget = returnFocus?.isConnected ? returnFocus : findControl(returnFocus?.dataset.pointsAction, returnFocus?.dataset.pointsId);
    if (restore) ((restoreTarget && !restoreTarget.disabled ? restoreTarget : app.querySelector('#main-content'))?.focus({ preventScroll: true }));
    returnFocus = undefined;
  }

  function openDialog(title, body, origin) {
    if (dialog.open) closeDialog({ restore: false });
    dialogueBusy = false;
    returnFocus = origin;
    dialog.innerHTML = `<h2 id="points-dialog-title" tabindex="-1">${esc(title)}</h2>
      <button type="button" class="icon-button dialog-close" data-points-action="close" aria-label="关闭窗口">${icon('close')}</button>${body}`;
    dialog.showModal();
    (dialog.querySelector('[data-points-action="cancel"]') ?? dialog.querySelector('h2')).focus({ preventScroll: true });
  }

  function form(body, submit, action) {
    return `<form data-points-form="${action}">${body}<p class="form-error points-dialog-error" role="alert"></p>
      <div class="dialog-footer">${button('cancel', '取消')}<button class="primary" type="submit">${esc(submit)}</button></div></form>`;
  }

  async function submitForm(event) {
    const formNode = event.target.closest('[data-points-form]');
    if (!formNode || !dialog.contains(formNode)) return;
    event.preventDefault();
    if (dialogueBusy) return;
    const submit = formNode.querySelector('[type="submit"]');
    const errorMessage = formNode.querySelector('[role="alert"]');
    const action = formNode.dataset.pointsForm;
    const version = dialogVersion;
    dialogueBusy = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    errorMessage.textContent = '';
    try {
      await dialogActions[action]?.(new FormData(formNode), version);
    } catch (error) {
      if (dialog.open && version === dialogVersion) {
        const code = errorCode(error);
        errorMessage.textContent = operationErrors[code] || error?.message || '操作失败，请稍后重试。';
        if (action === 'redeem' && !code) {
          errorMessage.textContent = '暂未收到兑换结果。再次确认会重试同一次兑换，也可以先打开背包核对。';
          void load('backpack', true);
        }
        if (['POINTS_CHANGED', 'POINTS_SOLD_OUT', 'POINTS_LOW_BALANCE', 'POINTS_UNAVAILABLE'].includes(code)) {
          if (action === 'redeem') { void load('catalog', true); void load('summary', true); }
          if (action === 'product') void load('adminCatalog', true);
        }
      }
    } finally {
      if (version === dialogVersion) dialogueBusy = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  }

  let requestedProduct;
  let requestedOrder;
  let editingProduct;
  const dialogActions = {
    async redeem(_fields, version) {
      const { row, requestId } = requestedProduct;
      pendingRedemptions.set(row.id, requestedProduct);
      try {
        await provider.pointsRedeem(row.id, row.version, requestId);
      } catch (error) {
        if (errorCode(error)) pendingRedemptions.delete(row.id);
        throw error;
      }
      pendingRedemptions.delete(row.id);
      if (signal.aborted) return;
      if (version === dialogVersion) closeDialog();
      toast(`已兑换「${row.name}」，可在背包查看。`);
      void load('summary', true); void load('catalog', true); void load('backpack', true);
    },
    async use(_fields, version) {
      const row = requestedOrder;
      await provider.pointsUse(row.id);
      if (signal.aborted) return;
      if (version === dialogVersion) closeDialog();
      toast(`已使用「${row.name}」。`);
      void load('backpack', true);
    },
    async product(fields, version) {
      const previous = editingProduct;
      const name = fields.get('name').trim();
      const description = fields.get('description').trim();
      const price = parseCredits(fields.get('price'));
      const stock = Number(fields.get('stock'));
      if (!name) throw new Error('请填写商品名称。');
      if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('库存请填写非负整数。');
      const selection = fields.get('defaultCover');
      let image = selection === 'keep' ? previous?.cover ?? null : selection || null;
      const file = selectedCoverFile;
      if (file) image = await provider.pointsUploadCover(file);
      if (typeof image === 'object' && image !== null) image = image.cover ?? image.path ?? image.url ?? null;
      if (signal.aborted) return;
      await provider.pointsAdminSaveProduct({
        id: previous?.id ?? null, version: previous?.version ?? null, name, description, price, stock, cover: image,
        active: fields.has('active'),
      });
      if (signal.aborted) return;
      if (version === dialogVersion) closeDialog();
      toast('已保存商品。');
      void load('adminCatalog', true);
    },
    async challenge(fields, version) {
      const title = fields.get('title').trim();
      const description = fields.get('description').trim();
      const reward = parseCredits(fields.get('reward'));
      if (!title) throw new Error('请填写挑战标题。');
      if (reward <= 0) throw new Error('挑战奖励需大于 0 分。');
      await provider.pointsAdminCreateChallenge({ title, description, reward });
      if (signal.aborted) return;
      if (version === dialogVersion) closeDialog();
      toast('已发布共同挑战。');
      void load('adminChallenges', true);
    },
  };

  function showRedemption(id, origin) {
    const pending = pendingRedemptions.get(id);
    const row = pending?.row ?? store.get('catalog')?.value?.find(item => item.id === id);
    const balance = summary()?.balance;
    if (!row || row.stock < 1 || !Number.isSafeInteger(balance) || balance < row.price) return;
    requestedProduct = pending ?? { row, requestId: crypto.randomUUID() };
    openDialog('确认兑换', form(`<p class="dialog-description">兑换「${esc(row.name)}」。</p><dl class="points-confirm-summary">
      <div><dt>当前积分</dt><dd>${credits(balance)}</dd></div><div><dt>本次扣除</dt><dd>${credits(row.price)}</dd></div>
      <div><dt>兑换后余额</dt><dd>${credits(balance - row.price)}</dd></div></dl>`, '确认兑换', 'redeem'), origin);
  }

  function showUse(id, origin) {
    const row = store.get('backpack')?.value?.find(item => item.id === id);
    if (!row || row.used_at) return;
    requestedOrder = row;
    openDialog('确认使用', form(`<p class="dialog-description">将「${esc(row.name)}」标记为已使用。使用后无法撤销。</p>`, '确认使用', 'use'), origin);
  }

  function editProduct(id, origin) {
    const row = store.get('adminCatalog')?.value?.find(item => item.id === id);
    if (id && !row) return;
    editingProduct = row;
    const currency = row ? (row.price / 100).toFixed(2).replace(/\.?0+$/, '') : '';
    openDialog(row ? '编辑商品' : '添加商品', form(`<div class="points-form-row">
      <label>商品名称<input name="name" maxlength="80" value="${esc(row?.name ?? '')}" required /></label>
      <label>库存<input name="stock" type="number" min="0" step="1" value="${esc(row?.stock ?? 1)}" required /></label></div>
      <label>说明<textarea name="description" maxlength="1000" rows="3">${esc(row?.description ?? '')}</textarea></label>
      <div class="points-form-row">
      <label>所需积分<input name="price" inputmode="decimal" value="${esc(row?.price === 0 ? '0' : currency)}" required /></label>
      <label>商品封面<select name="defaultCover">
        ${row?.cover ? '<option value="keep">保留当前封面</option>' : ''}<option value="">无封面</option>
        ${coverOptions.map(([path, name]) => `<option value="${path}">${name}</option>`).join('')}
      </select></label></div>
      ${provider.pointsUploadCover ? coverUploadMarkup() : ''}
      <label class="points-form-check"><input name="active" type="checkbox" ${row?.active !== false ? 'checked' : ''} /> 上架商品</label>`, '保存商品', 'product'), origin);
    if (provider.pointsUploadCover) mountCoverUpload();
  }

  function mountCoverUpload() {
    const dropzone = dialog.querySelector('[data-points-cover-drop]');
    const input = dropzone.querySelector('input');
    const status = dialog.querySelector('#points-cover-selection');
    const clear = dialog.querySelector('[data-points-cover-clear]');
    coverDropEvents = new AbortController();
    const { signal } = coverDropEvents;

    function select(files) {
      if (dialogueBusy) return;
      const problem = coverFileProblem(files);
      status.dataset.invalid = String(Boolean(problem));
      if (problem) {
        status.textContent = selectedCoverFile ? `${problem}已保留 ${selectedCoverFile.name}。` : problem;
        return;
      }
      [selectedCoverFile] = files;
      status.textContent = `已选择 ${selectedCoverFile.name}`;
      clear.hidden = false;
    }

    input.addEventListener('change', () => {
      if (input.files.length) select(Array.from(input.files));
      input.value = '';
    }, { signal });
    clear.addEventListener('click', () => {
      if (dialogueBusy) return;
      selectedCoverFile = null;
      status.dataset.invalid = 'false';
      status.textContent = '已清除选图。';
      clear.hidden = true;
      input.focus();
    }, { signal });
    mountFileDrop(dropzone, select, { signal, enabled: () => !dialogueBusy });
  }

  function newChallenge(origin) {
    openDialog('发布共同挑战', form(`<label>挑战标题<input name="title" maxlength="120" required /></label>
      <label>挑战说明<textarea name="description" maxlength="1500" rows="3"></textarea></label>
      <label>每位成员奖励积分<input name="reward" inputmode="decimal" required /></label>`, '发布挑战', 'challenge'), origin);
  }

  function updateInbox() {
    const region = dialog.querySelector('[data-points-inbox]');
    if (!region) return;
    region.innerHTML = dataBody('notifications', store, value => {
      if (!value.items?.length) return status('暂时还没有新消息。');
      return `${value.unread ? `<div class="points-card-actions">${button('read-all', '全部标为已读')}</div>` : ''}
        <ul class="points-list">${value.items.map(row => {
          const description = notificationLabels[row.kind] ?? '有一条新动态';
          return `<li class="points-row points-notice" data-unread="${!row.read_at}"><div><strong>${esc(row.actor_name || userName(row.actor_id))}${esc(description)}</strong>
            ${row.order_name || row.entry_title ? `<p>${esc(row.order_name || row.entry_title)}${Number.isSafeInteger(row.order_price) ? ` · ${credits(row.order_price)}` : ''}</p>` : ''}
            <p>${time(row.created_at)}${row.read_at ? '' : ' · 未读'}</p></div>${button('open-notice', '查看', { id: row.id })}</li>`;
        }).join('')}</ul>`;
    });
  }

  function showInbox(origin) {
    openDialog('消息通知', '<div data-points-inbox></div>', origin);
    inboxOpen = true;
    updateInbox();
    void load('notifications', true);
  }

  async function readNotices(ids, row) {
    const origin = document.activeElement;
    if (origin instanceof HTMLButtonElement) origin.disabled = true;
    try {
      const result = await provider.pointsReadNotifications(ids);
      if (signal.aborted) return;
      set('notifications', result);
      if (!row) {
        dialog.querySelector('h2')?.focus({ preventScroll: true });
        toast('消息已标为已读。');
      }
    } catch (error) {
      if (!signal.aborted) toast(error?.message || '消息状态暂时无法保存。', true);
    } finally {
      if (origin instanceof HTMLButtonElement && origin.isConnected) origin.disabled = false;
    }
    if (row && !signal.aborted) {
      closeDialog();
      if (openNotification) openNotification(row);
      else if (row.entry_id) location.hash = `#timeline?entry=${encodeURIComponent(row.entry_id)}`;
    }
  }

  async function confirmChallenge(id, origin) {
    if (busyChallenge) return;
    busyChallenge = true; origin.disabled = true;
    try {
      const value = await provider.pointsConfirmChallenge(id);
      if (!signal.aborted) { set('summary', value); toast('已确认共同挑战。'); }
    } catch (error) {
      if (!signal.aborted) toast(error?.message || '确认失败，请稍后重试。', true);
    } finally { busyChallenge = false; origin.disabled = false; }
  }

  function click(event) {
    const target = event.target.closest?.('[data-points-action]');
    if (target === null || !target || target.disabled) return;
    const { pointsAction: action, pointsId: id } = target.dataset;
    if (action === 'inbox') showInbox(target);
    else if (action === 'reload') void load(id, true);
    else if (action === 'cancel' || action === 'close') { if (!dialogueBusy) closeDialog(); }
    else if (action === 'read-all') void readNotices(null);
    else if (action === 'open-notice') {
      const row = notifications()?.items?.find(item => item.id === id);
      if (row) void readNotices([id], row);
    } else if (action === 'redeem') showRedemption(id, target);
    else if (action === 'use') showUse(id, target);
    else if (action === 'confirm-challenge') void confirmChallenge(id, target);
    else if (action === 'edit-product') editProduct(id, target);
    else if (action === 'new-challenge') newChallenge(target);
  }

  app.addEventListener('click', click, { signal });
  app.addEventListener('keydown', sortByKeyboard, { signal });
  app.addEventListener('error', event => { if (event.target.matches?.('.points-cover img')) event.target.hidden = true; }, { signal, capture: true });
  dialog.addEventListener('click', click, { signal });
  dialog.addEventListener('submit', submitForm, { signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!dialogueBusy) closeDialog(); }, { signal });
  window.addEventListener('focus', () => {
    if (isMember() || isAdmin()) void load('notifications', true);
    if (isMember()) void load('summary', true);
  }, { signal });
  const notificationPoll = setInterval(() => {
    if ((isMember() || isAdmin()) && document.visibilityState === 'visible') void load('notifications', true);
  }, 30_000);

  return {
    renderView, renderBell, renderCheckin, sync, updateCheckin, getSummary: summary,
    refreshSummary(value) { return value ? set('summary', value) : load('summary', true); },
    refreshNotifications() { return load('notifications', true); },
    destroy() { events.abort(); clearInterval(notificationPoll); sortable?.destroy(); closeDialog({ restore: false }); dialog.remove(); },
  };
}
