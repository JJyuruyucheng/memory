import { dayKey, toUtcIso, validateEntry } from './domain.js';

// Memos 26.11.1 REST schema: https://github.com/usememos/memos/tree/26.11.1/proto/api
// Tokens deliberately live only in this closure. The browser owns the HttpOnly refresh cookie.
const ENTRY_PREFIX = '<!-- chaoxi-entry:v1:';
const SETTINGS_PREFIX = 'chaoxi-settings:v1:';
const HEART = '❤️'; // taste-skill-ignore: native Memos API reaction symbol; the UI renders an SVG, not emoji.
const STAR = '⭐';
const COLORS = ['#ca817f', '#729d99', '#a28aaa'];
const RESOURCE = /^(memos|users|attachments|spaces)\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,34}[A-Za-z0-9])?$/;
const DEFAULT_SETTINGS = { spaceName: '朝夕', subtitle: '把我们的日子，一页页留下来。', startDate: '', anniversaries: [] };

export class MemosError extends Error {
  constructor(message, code = 'MEMOS_ERROR', status = 0) {
    super(message); this.name = 'MemosError'; this.code = code; this.status = status;
  }
}

function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100000) throw new Error('Invalid envelope');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0))));
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function resource(value, type) {
  if (typeof value !== 'string' || !RESOURCE.test(value) || !value.startsWith(`${type}/`)) throw new MemosError('服务器返回了无效的资源标识。', 'INVALID_RESOURCE');
  return value;
}
function apiResource(value, type) { return `/api/${resource(value, type).split('/').map(encodeURIComponent).join('/')}`; }

export function encodeEntryContent(entry) {
  const metadata = { type: entry.type, title: String(entry.title || ''), occurredAt: entry.occurredAt, mood: entry.mood ?? null, tags: [...(entry.tags || [])], deletedAt: entry.deletedAt ?? null };
  return `${ENTRY_PREFIX}${encode(metadata)} -->\n\n${String(entry.content || '')}`;
}

export function decodeEntryContent(content, fallbackDate) {
  const text = String(content || '');
  if (!text.startsWith('<!-- chaoxi-entry:')) return { type: 'note', title: '', content: text, occurredAt: fallbackDate, mood: null, tags: [], deletedAt: null };
  const match = /^<!-- chaoxi-entry:v1:([A-Za-z0-9_-]+) -->\r?\n\r?\n([\s\S]*)$/.exec(text);
  try {
    if (!match) throw new Error('Unknown version or damaged envelope');
    const data = decode(match[1]);
    if (!data || !['note', 'event'].includes(data.type) || typeof data.title !== 'string' || !validDate(data.occurredAt) || ![null, 'happy', 'neutral', 'sad'].includes(data.mood) || !Array.isArray(data.tags) || data.tags.some(tag => typeof tag !== 'string') || !(data.deletedAt === null || validDate(data.deletedAt))) throw new Error('Invalid metadata');
    return { type: data.type, title: data.title, occurredAt: data.occurredAt, mood: data.mood, tags: [...data.tags], deletedAt: data.deletedAt, content: match[2] };
  } catch { throw new MemosError('记录的朝夕数据格式损坏或版本不受支持，已停止读取，避免覆盖原文。', 'INVALID_ENVELOPE'); }
}

export function encodeSpaceSettings(settings) { return `${SETTINGS_PREFIX}${encode(settings)}`; }

function readSettings(space) {
  const description = String(space.description || '');
  if (!description.startsWith('chaoxi-settings:')) return { ...clone(DEFAULT_SETTINGS), spaceName: space.title || DEFAULT_SETTINGS.spaceName, subtitle: description || DEFAULT_SETTINGS.subtitle };
  try {
    if (!description.startsWith(SETTINGS_PREFIX)) throw new Error('Unknown version');
    const value = decode(description.slice(SETTINGS_PREFIX.length));
    return checkedSettings({ ...value, spaceName: space.title });
  } catch { throw new MemosError('空间设置格式损坏或版本不受支持，请用备份恢复。', 'INVALID_SETTINGS'); }
}

function checkedSettings(value) {
  if (!value || typeof value !== 'object') throw new MemosError('空间设置格式无效。', 'VALIDATION');
  const settings = { spaceName: value.spaceName, subtitle: value.subtitle, startDate: value.startDate, anniversaries: Array.isArray(value.anniversaries) ? value.anniversaries.map(item => item && ({ id: item.id, title: item.title, date: item.date, yearly: item.yearly })) : value.anniversaries };
  if (typeof settings.spaceName !== 'string' || !settings.spaceName.trim() || settings.spaceName.length > 60 || typeof settings.subtitle !== 'string' || settings.subtitle.length > 300 || typeof settings.startDate !== 'string' || (settings.startDate && dayKey(settings.startDate) !== settings.startDate) || !Array.isArray(settings.anniversaries) || settings.anniversaries.length > 100) throw new MemosError('空间名称、开始日期或纪念日设置无效。', 'VALIDATION');
  for (const anniversary of settings.anniversaries) {
    if (!anniversary || typeof anniversary.title !== 'string' || !anniversary.title.trim() || dayKey(anniversary.date) !== anniversary.date || typeof anniversary.yearly !== 'boolean') throw new MemosError('纪念日需要名称和有效日期。', 'VALIDATION');
    anniversary.id ||= crypto.randomUUID();
  }
  settings.spaceName = settings.spaceName.trim();
  return settings;
}

async function mapLimit(items, limit, callback) {
  const output = new Array(items.length); let cursor = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await callback(items[index], index); }
  }));
  const failed = workers.find(value => value.status === 'rejected'); if (failed) throw failed.reason;
  return output;
}

export function createMemosProvider(config = {}) {
  const spaceName = resource(config.space, 'spaces');
  const base = String(config.apiBase || '').replace(/\/$/, '');
  if (base && globalThis.location && new URL(base, location.href).origin !== location.origin) throw new MemosError('真实模式要求前端、API 和文件服务同源部署。', 'SAME_ORIGIN_REQUIRED');
  if (base && !/^https?:\/\//.test(base) && !/^\/[A-Za-z0-9/_-]+$/.test(base)) throw new MemosError('API 地址无效。', 'CONFIG');
  const fetcher = config.fetch || globalThis.fetch.bind(globalThis);
  const state = { mode: 'live', currentUser: null, users: [], entries: [], settings: clone(DEFAULT_SETTINGS) };
  let accessToken = ''; let expiresAt = 0; let refreshPromise = null; let spaceRole = ''; let queue = Promise.resolve(); let mediaGeneration = 0;
  const rawEntries = new Map(); const mediaCache = new Map();
  const retiredUrls = new Set();
  const urlAPI = config.urlAPI || globalThis.URL;

  function clearLocal() {
    accessToken = ''; expiresAt = 0; spaceRole = ''; rawEntries.clear();
    for (const cached of mediaCache.values()) urlAPI.revokeObjectURL(cached.url);
    for (const url of retiredUrls) urlAPI.revokeObjectURL(url);
    retiredUrls.clear();
    mediaCache.clear(); state.currentUser = null; state.users.splice(0); state.entries.splice(0);
    Object.assign(state.settings, clone(DEFAULT_SETTINGS));
  }

  async function transport(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 45000);
    try { return await fetcher(`${base}${path}`, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal }); }
    catch {
      throw new MemosError(options.method && options.method !== 'GET' ? '网络请求中断，操作结果尚未确认。请刷新核对后再重试。' : '无法连接记录服务，请检查网络和同源部署配置。', 'NETWORK');
    } finally { clearTimeout(timeout); }
  }

  async function jsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      try { data = await response.json(); } catch { throw new MemosError('记录服务返回了无效 JSON。', 'INVALID_RESPONSE', response.status); }
    } else if (response.ok && response.status !== 204) throw new MemosError('接口返回了网页而非数据，请检查 nginx 的 /api/ 反向代理。', 'INVALID_RESPONSE', response.status);
    if (!response.ok) {
      const messages = { 400: '请求未被服务接受，请检查填写内容和服务版本。', 401: '登录已失效，请重新登录。', 403: '当前账号没有这项操作的权限。', 404: '记录或空间不存在，或你没有访问权限。', 409: '数据发生冲突，请刷新后重试。', 413: '文件或记录超过服务器允许的大小。', 429: '请求过于频繁或已达存储额度，请稍后重试。' };
      // Error bodies are untrusted. Never render server HTML or echo passwords/tokens.
      throw new MemosError(messages[response.status] || '记录服务暂时出错，操作未获确认。', 'HTTP_ERROR', response.status);
    }
    return data || {};
  }

  function rememberToken(data) {
    if (typeof data.accessToken !== 'string' || !data.accessToken) throw new MemosError('登录接口缺少访问令牌，请确认使用 Memos 26.11.1。', 'INVALID_RESPONSE');
    accessToken = data.accessToken;
    expiresAt = Date.parse(data.accessTokenExpireTime) || Date.now() + 14 * 60000;
  }

  async function refresh(allowAnonymous = false) {
    if (!refreshPromise) refreshPromise = (async () => {
      const response = await transport('/memos.api.AuthService/RefreshToken', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' }, body: '{}' });
      if (response.status === 401) { clearLocal(); if (allowAnonymous) return false; }
      const data = await jsonResponse(response); rememberToken(data); return true;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function request(path, { method = 'GET', body, binary = false } = {}, retried = false) {
    if (!accessToken || (expiresAt && expiresAt - Date.now() < 15000)) await refresh();
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await transport(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 && !retried) { await refresh(); return request(path, { method, body, binary }, true); }
    if (binary && response.ok) {
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('image/') && !type.startsWith('video/')) throw new MemosError('媒体接口返回了不支持的文件类型。', 'INVALID_MEDIA');
      return response.blob();
    }
    return jsonResponse(response);
  }

  async function list(path, field, query = {}) {
    const values = []; const seen = new Set(); let token = '';
    do {
      const parameters = new URLSearchParams({ pageSize: '100', ...query, ...(token ? { pageToken: token } : {}) });
      const result = await request(`${path}?${parameters}`);
      if (result[field] !== undefined && !Array.isArray(result[field])) throw new MemosError('服务器列表格式不受支持。', 'INVALID_RESPONSE');
      values.push(...(result[field] || [])); token = result.nextPageToken || '';
      if (token && seen.has(token)) throw new MemosError('服务器分页重复，请刷新或检查版本。', 'INVALID_RESPONSE');
      seen.add(token);
    } while (token);
    return values;
  }

  function user(raw, index = 0) {
    const id = resource(raw.name, 'users');
    return { id, username: String(raw.username || id.slice(6)), name: String(raw.displayName || raw.username || id.slice(6)), role: raw.role === 'ADMIN' || raw.role === 1 ? 'admin' : 'member', color: COLORS[index % COLORS.length] };
  }

  async function media(attachment) {
    const id = resource(attachment.name, 'attachments');
    if (attachment.externalLink) throw new MemosError('此记录含外部附件；朝夕仅读取受 Memos 鉴权保护的托管媒体。', 'EXTERNAL_MEDIA');
    const mime = String(attachment.type || '');
    if (!/^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm|ogg|quicktime))$/i.test(mime)) throw new MemosError('此记录含不支持的媒体格式，请用原生 Memos 查看并转换。', 'UNSUPPORTED_MEDIA');
    const name = String(attachment.filename || 'media');
    let cached = mediaCache.get(id);
    if (!cached || cached.generation !== mediaGeneration) {
      const blob = await request(`/file/attachments/${encodeURIComponent(id.slice(12))}/${encodeURIComponent(name)}`, { binary: true });
      if (blob.type === 'image/svg+xml' || blob.type === 'text/html') throw new MemosError('此媒体格式不允许显示。', 'INVALID_MEDIA');
      if (cached) retiredUrls.add(cached.url);
      cached = { blob, url: urlAPI.createObjectURL(blob), generation: mediaGeneration }; mediaCache.set(id, cached);
    }
    return { id, type: mime.startsWith('image/') ? 'image' : 'video', url: cached.url, name, size: Number(attachment.size || cached.blob.size) };
  }

  function checkMemo(raw) {
    resource(raw.name, 'memos'); resource(raw.creator, 'users');
    if (raw.space !== spaceName || !(raw.visibility === 'SPACE' || raw.visibility === 4)) throw new MemosError('服务器返回了不属于当前私密空间的记录，已停止读取。', 'WRONG_SPACE');
    if (!validDate(raw.createTime) || !validDate(raw.updateTime)) throw new MemosError('记录时间格式无效。', 'INVALID_RESPONSE');
  }

  function comment(raw) {
    checkMemo(raw);
    return { id: raw.name, authorId: raw.creator, content: String(raw.content || ''), createdAt: raw.createTime };
  }

  async function entry(raw) {
    checkMemo(raw);
    const metadata = decodeEntryContent(raw.content, raw.createTime);
    const comments = await list(`${apiResource(raw.name, 'memos')}/comments`, 'comments');
    const reactions = raw.reactions || [];
    return {
      id: raw.name, authorId: raw.creator, ...metadata, createdAt: raw.createTime, updatedAt: raw.updateTime,
      media: await mapLimit(raw.attachments || [], 3, media), comments: comments.map(comment),
      reactionBy: [...new Set(reactions.filter(reaction => reaction.reactionType === HEART).map(reaction => resource(reaction.creator, 'users')))],
      favoriteBy: [...new Set(reactions.filter(reaction => reaction.reactionType === STAR).map(reaction => resource(reaction.creator, 'users')))],
    };
  }

  function updateStateEntry(value, raw) {
    rawEntries.set(value.id, raw);
    const index = state.entries.findIndex(item => item.id === value.id);
    if (index < 0) state.entries.push(value); else state.entries.splice(index, 1, value);
    state.entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return value;
  }

  async function loadState() {
    const profile = await request('/api/instance/profile');
    if (profile.version !== '26.11.1') throw new MemosError('当前后端版本未获此版本前端验证，请使用 Memos 26.11.1。', 'UNSUPPORTED_VERSION');
    if (profile.accessMode !== 'INSTANCE_ACCESS_MODE_PRIVATE') throw new MemosError('后端尚未启用私密访问，请先运行初始化脚本。', 'PUBLIC_INSTANCE');
    const general = await request('/api/instance/settings/GENERAL');
    if (!general.generalSetting?.disallowUserRegistration) throw new MemosError('后端仍允许开放注册，请先关闭注册。', 'REGISTRATION_OPEN');
    const current = await request('/api/auth/me');
    if (!current.user) throw new MemosError('无法确认当前账号，请重新登录。', 'INVALID_RESPONSE');
    const currentUser = user(current.user);
    const space = await request(apiResource(spaceName, 'spaces'));
    const members = await list(`${apiResource(spaceName, 'spaces')}/members`, 'spaceMembers');
    const memberUsers = await mapLimit(members, 3, member => request(apiResource(member.user, 'users')));
    const raw = await list('/api/memos', 'memos', { filter: `space == "${spaceName}" && visibility == "SPACE"` });
    mediaGeneration++;
    const hydrated = await mapLimit(raw, 3, entry);
    const settings = readSettings(space);
    state.currentUser = currentUser; spaceRole = space.currentUserRole;
    state.users.splice(0, state.users.length, ...memberUsers.map(user));
    if (!state.users.some(item => item.id === currentUser.id)) state.users.push(currentUser);
    state.entries.splice(0, state.entries.length, ...hydrated.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)));
    Object.assign(state.settings, settings); rawEntries.clear(); raw.forEach(value => rawEntries.set(value.name, value));
    const activeMedia = new Set(hydrated.flatMap(item => item.media.map(file => file.id)));
    for (const [id, cached] of mediaCache) if (!activeMedia.has(id)) { urlAPI.revokeObjectURL(cached.url); mediaCache.delete(id); }
    for (const url of retiredUrls) urlAPI.revokeObjectURL(url);
    retiredUrls.clear();
    return state;
  }

  function requireUser() {
    if (!state.currentUser) throw new MemosError('请先登录。', 'UNAUTHENTICATED', 401);
  }

  async function editable(id) {
    requireUser();
    if (!rawEntries.has(id)) throw new MemosError('这条记录不在当前空间中，请刷新核对。', 'NOT_FOUND');
    const raw = await request(apiResource(id, 'memos')); checkMemo(raw);
    if (raw.creator !== state.currentUser.id && state.currentUser.role !== 'admin') throw new MemosError('只能修改自己的记录；管理员可维护空间内的记录。', 'FORBIDDEN', 403);
    if (raw.updateTime !== rawEntries.get(id).updateTime) throw new MemosError('记录已在其他设备被修改，请刷新后再编辑。', 'CONFLICT', 409);
    return raw;
  }

  async function upload(file) {
    let offset = 0; let uploadId = ''; let maxChunk = 1024 * 1024;
    do {
      const bytes = new Uint8Array(await file.slice(offset, offset + maxChunk).arrayBuffer());
      let binary = ''; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      const body = { ...(uploadId ? { uploadId } : { spec: { attachment: { filename: file.name, type: file.type }, totalSize: String(file.size) } }), writeOffset: String(offset), data: btoa(binary), finishWrite: offset + bytes.length === file.size };
      const result = await request('/api/attachments:upload', { method: 'POST', body });
      if (result.attachment) return result.attachment;
      if (!result.uploadId || Number(result.committedSize) !== offset + bytes.length || !Number(result.maxChunkSize) || bytes.length === 0) throw new MemosError('文件上传进度异常，记录尚未发布。', 'INVALID_UPLOAD');
      offset = Number(result.committedSize); uploadId = result.uploadId; maxChunk = Math.min(Number(result.maxChunkSize), 1024 * 1024);
    } while (offset <= file.size);
    throw new MemosError('文件上传没有完成，记录尚未发布。', 'INVALID_UPLOAD');
  }

  async function saveEntry(input, files = []) {
    requireUser();
    if (!input || typeof input !== 'object') throw new MemosError('记录格式无效。', 'VALIDATION');
    const existing = input.id ? await editable(input.id) : null;
    const previous = existing ? decodeEntryContent(existing.content, existing.createTime) : {};
    const candidate = { type: 'note', title: '', content: '', occurredAt: new Date().toISOString(), mood: null, tags: [], ...previous, ...input };
    const currentMedia = state.entries.find(item => item.id === input.id)?.media || [];
    if (candidate.media === undefined) candidate.media = currentMedia;
    const validation = validateEntry(candidate, files, config);
    if (!validation.valid) throw new MemosError(validation.errors.join('；'), 'VALIDATION');
    for (const file of files) if (!/^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm|ogg|quicktime))$/i.test(file.type)) throw new MemosError('仅支持 JPEG、PNG、GIF、WebP、AVIF 图片和 MP4、WebM、OGG、MOV 视频。SVG 不接受上传。', 'UNSUPPORTED_MEDIA');
    if (!existing && candidate.media.length) throw new MemosError('新记录的附件需要通过文件上传添加。', 'INVALID_MEDIA');
    if (new Set(candidate.media.map(item => item.id)).size !== candidate.media.length) throw new MemosError('附件不能重复。', 'INVALID_MEDIA');
    const kept = existing ? candidate.media.map(item => {
      const attachment = (existing.attachments || []).find(value => value.name === item.id);
      if (!attachment) throw new MemosError('附件不属于这条记录，请刷新后重试。', 'INVALID_MEDIA');
      return { name: attachment.name };
    }) : [];
    if (previous.deletedAt) throw new MemosError('请先恢复回收站中的记录再编辑。', 'DELETED');
    const uploaded = []; for (const file of files) uploaded.push(await upload(file));
    const body = { content: encodeEntryContent({ ...candidate, title: candidate.title.trim(), content: candidate.content.trim(), occurredAt: toUtcIso(candidate.occurredAt), tags: [...new Set(candidate.tags.map(tag => tag.trim()).filter(Boolean))], deletedAt: null }), space: spaceName, visibility: 'SPACE', attachments: [...kept, ...uploaded.map(value => ({ name: value.name }))] };
    const raw = existing
      ? await request(`${apiResource(existing.name, 'memos')}?updateMask=content,space,visibility,attachments`, { method: 'PATCH', body })
      : await request('/api/memos', { method: 'POST', body });
    return updateStateEntry(await entry(raw), raw);
  }

  async function setDeleted(id, deletedAt) {
    const raw = await editable(id); const value = decodeEntryContent(raw.content, raw.createTime);
    const updated = await request(`${apiResource(id, 'memos')}?updateMask=content`, { method: 'PATCH', body: { content: encodeEntryContent({ ...value, deletedAt }) } });
    updateStateEntry(await entry(updated), updated);
  }

  async function toggle(id, reactionType) {
    requireUser();
    if (!rawEntries.has(id)) throw new MemosError('这条记录不在当前空间中。', 'NOT_FOUND');
    const current = await request(apiResource(id, 'memos')); checkMemo(current);
    if (decodeEntryContent(current.content, current.createTime).deletedAt) throw new MemosError('请先恢复回收站中的记录。', 'DELETED');
    const reaction = (current.reactions || []).find(item => item.creator === state.currentUser.id && item.reactionType === reactionType);
    if (reaction) {
      if (!new RegExp(`^${id}/reactions/[A-Za-z0-9-]+$`).test(reaction.name)) throw new MemosError('回应标识无效。', 'INVALID_RESPONSE');
      await request(`/api/${reaction.name}`, { method: 'DELETE' });
    } else await request(`${apiResource(id, 'memos')}/reactions`, { method: 'POST', body: { reaction: { reactionType } } });
    const updated = await request(apiResource(id, 'memos'));
    return updateStateEntry(await entry(updated), updated);
  }

  async function addComment(id, text) {
    requireUser();
    if (!rawEntries.has(id)) throw new MemosError('这条记录不在当前空间中。', 'NOT_FOUND');
    const content = String(text || '').trim();
    if (!content || content.length > 5000) throw new MemosError('留言需要 1—5000 个字符。', 'VALIDATION');
    const raw = await request(apiResource(id, 'memos')); checkMemo(raw);
    if (decodeEntryContent(raw.content, raw.createTime).deletedAt) throw new MemosError('回收站记录不能添加留言。', 'DELETED');
    const result = comment(await request(`${apiResource(id, 'memos')}/comments`, { method: 'POST', body: { content, space: spaceName, visibility: 'SPACE' } }));
    state.entries.find(item => item.id === id)?.comments.push(result);
    return result;
  }

  async function saveSettings(settings) {
    requireUser();
    if (state.currentUser.role !== 'admin' || !['ADMIN', 1].includes(spaceRole)) throw new MemosError('共同设置由管理员账号维护，日常账号可查看。', 'FORBIDDEN', 403);
    const value = checkedSettings(settings);
    const raw = await request(`${apiResource(spaceName, 'spaces')}?updateMask=title,description`, { method: 'PATCH', body: { title: value.spaceName, description: encodeSpaceSettings(value) } });
    Object.assign(state.settings, readSettings(raw)); return state.settings;
  }

  async function exportData(scope = 'all') {
    requireUser();
    if (!['all', 'mine'].includes(scope)) throw new MemosError('不支持的导出范围。', 'VALIDATION');
    await loadState();
    const selected = state.entries.filter(value => scope === 'all' || value.authorId === state.currentUser.id);
    const entries = [];
    for (const value of selected) {
      const exported = clone(value);
      for (const item of exported.media) {
        const cached = mediaCache.get(item.id);
        if (!cached) throw new MemosError('导出缺少媒体文件，请刷新后重试。', 'MISSING_MEDIA');
        const bytes = new Uint8Array(await cached.blob.arrayBuffer()); let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        delete item.url; item.data = btoa(binary); item.mimeType = cached.blob.type;
      }
      entries.push(exported);
    }
    return new Blob([JSON.stringify({ format: 'chaoxi-memory', version: 1, mode: 'live', mediaEncoding: 'base64', exportedAt: new Date().toISOString(), scope, users: state.users, settings: state.settings, entries }, null, 2)], { type: 'application/json' });
  }

  function enqueue(action) {
    const pending = queue.then(action); queue = pending.catch(() => {}); return pending;
  }

  return {
    async init() { if (!await refresh(true)) return state; return loadState(); },
    async login(username, password) {
      clearLocal();
      if (!String(username || '').trim() || !password) throw new MemosError('请填写账号和密码。', 'VALIDATION');
      const response = await transport('/memos.api.AuthService/SignIn', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' }, body: JSON.stringify({ passwordCredentials: { username: String(username).trim(), password } }) });
      rememberToken(await jsonResponse(response));
      return loadState();
    },
    async logout() {
      try { if (accessToken) await request('/memos.api.AuthService/SignOut', { method: 'POST', body: {} }); }
      finally { clearLocal(); }
    },
    saveEntry: (...args) => enqueue(() => saveEntry(...args)), deleteEntry: id => enqueue(() => setDeleted(id, new Date().toISOString())), restoreEntry: id => enqueue(() => setDeleted(id, null)),
    toggleReaction: id => enqueue(() => toggle(id, HEART)), toggleFavorite: id => enqueue(() => toggle(id, STAR)),
    addComment: (...args) => enqueue(() => addComment(...args)), saveSettings: settings => enqueue(() => saveSettings(settings)), exportData: scope => enqueue(() => exportData(scope)),
    dispose: clearLocal,
  };
}
