import { BGM_BUCKET, MUSIC_UUID, musicFileType, musicState } from './background-music-data.js';
import { ALLOWED_FILE_TYPES, canReadEntry, dayKey, toUtcIso, validateEntry } from './domain.js';
import { planAttachmentOrder, resolveAttachmentOrder } from './attachment-order.js';
import { MAX_PROFILE_NAME, validAvatarJpeg } from './profile.js';
import { requestAssistant } from './assistant-api.js';

// Inject the official supabase-js client with detectSessionInUrl:false; bounded
// session persistence belongs to its storage adapter, not this data provider.
// Database/RPC contract: supabase/migrations; RLS remains the authority.
const MAX_FILE_BYTES = 50_000_000;
const PAGE_SIZE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const DEFAULT_SETTINGS = { spaceName: '朝夕', subtitle: '把我们的日子，一页页留下来。', startDate: '', anniversaries: [] };
const clone = value => structuredClone(value);

export class SupabaseProviderError extends Error {
  constructor(message, code = 'SUPABASE_ERROR', status = 0) {
    super(message); this.name = 'SupabaseProviderError'; this.code = code; this.status = status;
  }
}

function invalid(message = '服务器返回的数据不完整，已停止读取。') {
  return new SupabaseProviderError(message, 'INVALID_RESPONSE');
}
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) throw invalid(); return value; }
function date(value) { if (typeof value !== 'string') throw invalid(); try { return toUtcIso(value); } catch { throw invalid(); } }
function checkedSettings(value) {
  if (!value || typeof value !== 'object') throw new SupabaseProviderError('空间设置格式无效。', 'VALIDATION');
  const output = { spaceName: value.spaceName, subtitle: value.subtitle, startDate: value.startDate, anniversaries: value.anniversaries };
  if (typeof output.spaceName !== 'string' || !output.spaceName.trim() || output.spaceName.length > 60 || typeof output.subtitle !== 'string' || output.subtitle.length > 300 || typeof output.startDate !== 'string' || (output.startDate && dayKey(output.startDate) !== output.startDate) || !Array.isArray(output.anniversaries) || output.anniversaries.length > 100) throw new SupabaseProviderError('空间名称、开始日期或纪念日设置无效。', 'VALIDATION');
  output.anniversaries = output.anniversaries.map(item => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 || typeof item.date !== 'string' || dayKey(item.date) !== item.date || typeof item.yearly !== 'boolean') throw new SupabaseProviderError('纪念日需要名称、有效日期和重复方式。', 'VALIDATION');
    return { id: item.id || crypto.randomUUID(), title: item.title.trim(), date: item.date, yearly: item.yearly };
  });
  output.spaceName = output.spaceName.trim(); return output;
}

async function mapLimit(values, limit, callback) {
  const output = new Array(values.length); let cursor = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; output[index] = await callback(values[index], index); }
  }));
  const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
  return output;
}

export function createSupabaseProvider(config = {}) {
  const client = config.client;
  if (!client?.auth?.signInWithPassword || !client.auth.getSession || !client.auth.getUser || !client.auth.signOut || !client.from || !client.rpc || !client.storage?.from) throw new SupabaseProviderError('Supabase 客户端未配置，正式记录服务尚未接通。', 'CONFIG');
  const bucket = 'memory-media';
  const limits = { maxImages: 9, maxFileBytes: MAX_FILE_BYTES };
  const urlAPI = config.urlAPI || globalThis.URL;
  const state = { mode: 'live', backend: 'supabase', currentUser: null, users: [], entries: [], settings: clone(DEFAULT_SETTINGS) };
  const rawEntries = new Map(), rawMedia = new Map(), mediaCache = new Map(), authTasks = new Set();
  let generation = 0, sessionController = new AbortController(), queue = Promise.resolve();
  let loginAttempt = null, logoutPromise = null, initAttempt = null, disposed = false, mayRestore = true, authIdentity = null;
  const now = () => toUtcIso(config.now?.() ?? new Date());

  function loginEmail(username) {
    const identity = config.loginIdentities?.[['xbl', 'll'].includes(username) ? username : 'memory-admin'];
    const email = typeof identity === 'string' ? identity : identity?.email;
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }
  function requireSession(expected) {
    if (disposed || expected !== generation) throw new SupabaseProviderError('会话已改变，旧操作结果已忽略；重新登录后请刷新核对。', 'AUTH_CANCELLED', 401);
  }
  function clearLocal() {
    generation++; authIdentity = null; sessionController.abort(); sessionController = new AbortController(); rawEntries.clear(); rawMedia.clear();
    for (const cached of mediaCache.values()) urlAPI.revokeObjectURL(cached.url);
    mediaCache.clear(); state.currentUser = null; state.users.splice(0); state.entries.splice(0);
    for (const key of Object.keys(state.settings)) delete state.settings[key];
    Object.assign(state.settings, clone(DEFAULT_SETTINGS));
  }
  function changeIdentity(nextId, restore) {
    clearLocal(); authIdentity = nextId; mayRestore = restore;
    queueMicrotask(() => config.onSessionChanged?.({ restore }));
  }
  function bindIdentity(value, expected) {
    requireSession(expected); const userId = id(value);
    if (authIdentity && authIdentity !== userId) {
      // An earlier snapshot/HTTP result cannot override the newer SDK identity.
      changeIdentity(authIdentity, true); requireSession(expected);
    }
    authIdentity = userId; return userId;
  }
  function requireIdentity(expected, userId) {
    requireSession(expected);
    if (authIdentity !== userId) throw new SupabaseProviderError('会话身份已改变，请等待重新载入。', 'AUTH_CANCELLED', 401);
  }
  function requireUser(expected) {
    requireSession(expected);
    if (!state.currentUser) throw new SupabaseProviderError('请先登录。', 'UNAUTHENTICATED', 401);
    return state.currentUser;
  }
  function sdkError(error, fallback = '云端请求未完成，请检查网络后刷新核对。') {
    const status = Number(error?.status || error?.statusCode || 0), code = String(error?.code || '');
    if (error?.name === 'AuthRetryableFetchError' || status === 408 || status >= 500) return new SupabaseProviderError(fallback, 'NETWORK', status);
    if (status === 401 || ['PGRST301', 'PGRST302', 'bad_jwt', 'session_not_found', 'refresh_token_not_found'].includes(code)) {
      changeIdentity(null, false); return new SupabaseProviderError('登录已失效，请重新登录。', 'UNAUTHENTICATED', 401);
    }
    if (status === 403 || code === '42501') return new SupabaseProviderError('当前账号没有执行此操作的权限。', 'FORBIDDEN', 403);
    if (status === 429) return new SupabaseProviderError('请求过于频繁，请稍后再试。', 'RATE_LIMITED', 429);
    if (['23505', '40001'].includes(code)) return new SupabaseProviderError('内容已发生变化，请刷新后核对，避免重复保存。', 'CONFLICT', 409);
    return new SupabaseProviderError(fallback, status === 0 ? 'NETWORK' : 'SUPABASE_ERROR', status);
  }
  async function result(operation, expected, { fallback, allowNull = false } = {}) {
    requireSession(expected);
    let response;
    try { response = await operation; } catch { requireSession(expected); throw new SupabaseProviderError(fallback || '网络请求未完成，部分操作可能已保存，请刷新核对。', 'NETWORK'); }
    requireSession(expected);
    if (!response || typeof response !== 'object' || !('error' in response)) throw invalid();
    if (response.error) throw sdkError(response.error, fallback);
    if (response.data == null && !allowNull) throw invalid();
    return response.data;
  }
  async function authResult(operation, expected) {
    const pending = Promise.resolve(operation); authTasks.add(pending);
    try { return await result(pending, expected, { fallback: '账号认证服务连接未完成，请检查网络后重试。' }); } finally { authTasks.delete(pending); }
  }
  function query(builder) { return builder.abortSignal(sessionController.signal); }
  async function list(table, expected, order = ['id']) {
    const output = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      requireSession(expected);
      let builder = client.from(table).select('*');
      for (const field of order) builder = builder.order(field, { ascending: true });
      const rows = await result(query(builder.range(offset, offset + PAGE_SIZE - 1)), expected, { fallback: '回忆数据服务连接未完成，请检查网络后重试。' });
      if (!Array.isArray(rows)) throw invalid(); output.push(...rows);
      if (rows.length < PAGE_SIZE) return output;
    }
  }
  function profile(raw) {
    if (!raw || ![1, 2, 3].includes(raw.slot) || !['member', 'admin'].includes(raw.role) || (raw.slot === 3) !== (raw.role === 'admin') || typeof raw.username !== 'string' || !USERNAME.test(raw.username) || (raw.slot === 1 && raw.username !== 'xbl') || (raw.slot === 2 && raw.username !== 'll') || (raw.slot === 3 && ['xbl', 'll'].includes(raw.username)) || typeof raw.name !== 'string') throw invalid();
    return { id: id(raw.id), slot: raw.slot, username: raw.username, name: raw.name, role: raw.role,
      color: String(raw.color || (raw.slot === 2 ? 'rose' : raw.slot === 3 ? 'stone' : 'sage')),
      avatarJpeg: validAvatarJpeg(raw.avatarJpeg) ? raw.avatarJpeg : null };
  }
  function mediaRow(raw, entry, knownUsers) {
    if (!raw || id(raw.entryId) !== entry.id || id(raw.authorId) !== entry.authorId || !knownUsers.has(id(raw.uploadedBy)) || !['pending', 'ready', 'retired'].includes(raw.status) || typeof raw.attached !== 'boolean' || !Number.isInteger(raw.position) || raw.position < 0 || !ALLOWED_FILE_TYPES[raw.mimeType] || ALLOWED_FILE_TYPES[raw.mimeType] !== raw.type || !Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > MAX_FILE_BYTES || raw.storagePath !== `${entry.authorId}/${entry.id}/${id(raw.id)}` || typeof raw.name !== 'string') throw invalid('服务器返回了无效的私有媒体登记，已停止读取。');
    return raw;
  }
  async function hydrateMedia(raw, expected) {
    requireSession(expected);
    let cached = mediaCache.get(raw.id);
    try { if (!cached || cached.path !== raw.storagePath) {
      const blob = await result(client.storage.from(bucket).download(raw.storagePath, {}, { signal: sessionController.signal, cache: 'no-store' }), expected, { fallback: '私有附件下载失败，已停止加载，避免遗漏原图。' });
      if (!(blob instanceof Blob) || !blob.size || blob.size !== raw.size || blob.type !== raw.mimeType || !ALLOWED_FILE_TYPES[blob.type]) throw invalid('附件大小或类型与登记不符，已停止显示。');
      requireSession(expected);
      const url = urlAPI.createObjectURL(blob);
      if (cached) urlAPI.revokeObjectURL(cached.url);
      cached = { blob, url, path: raw.storagePath }; mediaCache.set(raw.id, cached);
    } } catch (error) {
      requireSession(expected);
      if (error.code === 'UNAUTHENTICATED') throw error;
      // Preserve the attachment identity for repair/removal. Export must reject
      // missing bytes instead of silently claiming a complete backup.
      return { id: raw.id, type: raw.type, name: raw.name, size: raw.size, url: '', unavailable: true, error: error.code === 'NETWORK' ? '附件服务连接失败或超时，请检查网络后重试。' : error.code === 'FORBIDDEN' ? '当前账号无法读取此附件，请刷新核对权限。' : '附件暂时无法读取，请重试或由作者检查原文件。' };
    }
    return { id: raw.id, type: raw.type, name: raw.name, size: raw.size, url: cached.url };
  }
  async function loadState(expected, userId) {
    requireIdentity(expected, id(userId));
    const tables = ['profiles', 'entries', 'comments', 'reactions', 'favorites', 'settings', 'media'];
    const results = await Promise.allSettled(tables.map(table => list(table, expected, ['reactions', 'favorites'].includes(table) ? ['entryId', 'userId'] : ['id'])));
    const failure = results.find(value => value.status === 'rejected'); if (failure) throw failure.reason;
    requireIdentity(expected, userId);
    const [profiles, rows, comments, reactions, favorites, settingsRows, media] = results.map(value => value.value);
    if (profiles.length !== 3 || new Set(profiles.map(value => value.slot)).size !== profiles.length || new Set(profiles.map(value => value.username)).size !== profiles.length) throw invalid('共同空间的三个身份尚未完整配置。');
    const users = [...profiles].sort((a, b) => a.slot - b.slot).map(profile), knownUsers = new Set(users.map(value => value.id));
    const currentUser = users.find(value => value.id === userId);
    if (!currentUser) throw new SupabaseProviderError('这个账号未获共同空间授权。', 'FORBIDDEN', 403);
    if (settingsRows.length !== 1 || settingsRows[0].id !== 1) throw invalid('共同空间尚未完成初始化。');
    const settings = checkedSettings(settingsRows[0]);
    const entryIds = new Set(rows.map(value => id(value.id)));
    for (const child of [...comments, ...reactions, ...favorites, ...media]) if (!entryIds.has(id(child.entryId))) throw invalid();
    if (rows.some(raw => !['draft', 'published'].includes(raw.status))) throw invalid('记录的发布状态无效。');
    // RLS is authoritative. Fail closed before downloading any attachment if a
    // misconfigured server unexpectedly returns a hidden whisper or draft.
    if (rows.some(raw => !canReadEntry(raw, currentUser))) throw invalid('服务器返回了当前身份不可见的记录，已停止读取。');
    const hydrated = await mapLimit(rows.filter(raw => raw.status === 'published'), 3, async raw => {
      if (!knownUsers.has(id(raw.authorId))) throw invalid();
      const attachments = media.filter(value => value.entryId === raw.id).map(value => mediaRow(value, raw, knownUsers)).filter(value => value.status === 'ready' && value.attached).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const entry = { id: id(raw.id), authorId: id(raw.authorId), type: raw.type, title: raw.title, content: raw.content, occurredAt: date(raw.occurredAt), mood: raw.mood, tags: raw.tags, createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt), deletedAt: raw.deletedAt === null ? null : date(raw.deletedAt), media: await mapLimit(attachments, 3, value => hydrateMedia(value, expected)), comments: [], reactionBy: [], favoriteBy: [] };
      // An interrupted file-only upload may leave an empty note placeholder.
      // It must remain readable/deletable; normal saves still use validateEntry.
      if (!['note', 'event', 'whisper'].includes(entry.type) || typeof entry.title !== 'string' || entry.title.length > 120 || (entry.type === 'event' && !entry.title.trim()) || typeof entry.content !== 'string' || entry.content.length > 20000 || ![null, 'happy', 'neutral', 'sad'].includes(entry.mood) || !Array.isArray(entry.tags) || entry.tags.length > 20 || entry.tags.some(value => typeof value !== 'string' || value.length > 40) || entry.media.filter(value => value.type === 'image').length > 9) throw invalid('记录格式不受当前版本支持，已停止加载，避免覆盖原数据。');
      entry.comments = comments.filter(value => value.entryId === entry.id).map(value => {
        if (!knownUsers.has(id(value.authorId)) || typeof value.content !== 'string' || !value.content.trim() || value.content.length > 5000) throw invalid();
        return { id: id(value.id), authorId: value.authorId, content: value.content, createdAt: date(value.createdAt) };
      }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const [values, field] of [[reactions, 'reactionBy'], [favorites, 'favoriteBy']]) entry[field] = [...new Set(values.filter(value => value.entryId === entry.id).map(value => { if (!knownUsers.has(id(value.userId))) throw invalid(); return value.userId; }))];
      return entry;
    });
    requireIdentity(expected, userId);
    state.currentUser = currentUser; state.users.splice(0, state.users.length, ...users);
    state.entries.splice(0, state.entries.length, ...hydrated.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)));
    Object.assign(state.settings, settings); rawEntries.clear(); rows.forEach(value => rawEntries.set(value.id, value)); rawMedia.clear(); media.forEach(value => rawMedia.set(value.id, value));
    const used = new Set(hydrated.flatMap(value => value.media.map(item => item.id)));
    for (const [key, cached] of mediaCache) if (!used.has(key)) { urlAPI.revokeObjectURL(cached.url); mediaCache.delete(key); }
    return state;
  }
  function findEntry(entryId, expected, { editable = false, allowDeleted = false } = {}) {
    const user = requireUser(expected), entry = state.entries.find(value => value.id === entryId);
    if (!entry || (entry.deletedAt && !allowDeleted)) throw new SupabaseProviderError('这条记录不存在，或已放入回收站。', 'NOT_FOUND', 404);
    if (editable && entry.authorId !== user.id && user.role !== 'admin') throw new SupabaseProviderError('只有作者或管理员可以修改、删除及恢复这条记录。', 'FORBIDDEN', 403);
    return entry;
  }
  function enqueue(action) {
    const expected = generation;
    const pending = queue.then(async () => { requireUser(expected); const value = await action(expected); requireUser(expected); return value; });
    queue = pending.catch(() => {}); return pending;
  }
  async function patchEntry(entry, patch, expected) {
    const response = await result(query(client.from('entries').update(patch).eq('id', entry.id).eq('updatedAt', rawEntries.get(entry.id)?.updatedAt).select('*').maybeSingle()), expected, { allowNull: true });
    if (!response) throw new SupabaseProviderError('这条记录刚被更新，请刷新后再修改，避免覆盖对方的内容。', 'CONFLICT', 409);
    if (id(response.id) !== entry.id || response.authorId !== entry.authorId) throw invalid();
    return response;
  }
  async function removeMedia(raw, expected) {
    await result(client.storage.from(bucket).remove([raw.storagePath]), expected);
    await result(query(client.rpc('discard_media', { p_media_id: raw.id })), expected, { allowNull: true });
  }
  async function saveEntry(input, files, expected) {
    const user = requireUser(expected);
    if (!input || typeof input !== 'object' || !Array.isArray(files)) throw new SupabaseProviderError('记录或附件格式无效。', 'VALIDATION');
    const existing = input.id ? findEntry(input.id, expected, { editable: true }) : null;
    if (existing && input.updatedAt !== undefined && input.updatedAt !== existing.updatedAt) throw new SupabaseProviderError('记录版本已变化，请刷新后再修改。', 'CONFLICT', 409);
    let kept = existing?.media ?? [];
    if (input.media !== undefined) {
      if (!Array.isArray(input.media) || new Set(input.media.map(value => value?.id)).size !== input.media.length || input.media.some(value => !value || !kept.some(old => old.id === value.id))) throw new SupabaseProviderError('附件只能来自本条记录；新附件请通过文件上传。', 'VALIDATION');
      kept = input.media.map(value => kept.find(old => old.id === value.id));
    }
    const candidate = { type: input.type ?? existing?.type ?? 'note', title: input.title ?? existing?.title ?? '', content: input.content ?? existing?.content ?? '', occurredAt: input.occurredAt ?? existing?.occurredAt ?? now(), mood: input.mood === undefined ? existing?.mood ?? null : input.mood, tags: input.tags ?? existing?.tags ?? [], media: kept };
    const validation = validateEntry(candidate, files, limits);
    if (!validation.valid) throw new SupabaseProviderError(validation.errors.join('\n'), 'VALIDATION');
    if (kept.length + files.length > 10) throw new SupabaseProviderError('每条记录最多保存 10 个附件，其中图片最多 9 张。', 'VALIDATION');
    if (files.some(file => !(file instanceof Blob) || typeof file.arrayBuffer !== 'function')) throw new SupabaseProviderError('无法读取附件，请重新选择文件。', 'VALIDATION');
    let order;
    try { order = planAttachmentOrder(kept, files.length, input.mediaOrder); }
    catch (error) { throw new SupabaseProviderError(error.message, 'VALIDATION'); }
    const removals = existing?.media.filter(value => !kept.some(item => item.id === value.id)) ?? [];
    if (existing?.type === 'whisper' && candidate.type !== 'whisper' && (removals.length || files.length)) throw new SupabaseProviderError('请先保留悄悄话类型保存附件改动，再改为共享类型。', 'PRIVATE_MEDIA_CHANGE');
    const patch = { type: candidate.type, title: candidate.title.trim(), content: candidate.content.trim(), occurredAt: toUtcIso(candidate.occurredAt), mood: candidate.mood, tags: [...new Set(candidate.tags.map(value => value.trim()).filter(Boolean))] };
    let publicationAttempted = false; const addedMedia = [];
    try {
    const row = existing ? await patchEntry(existing, patch, expected) : await result(query(client.from('entries').insert(patch).select('*').single()), expected);
    const entryId = id(row.id), authorId = existing?.authorId ?? user.id;
    if (row.authorId !== authorId) throw invalid();
    const remove = value => removeMedia({ id: value.id, storagePath: `${authorId}/${entryId}/${value.id}` }, expected);
    for (const file of files) {
        const reserved = await result(query(client.rpc('reserve_media', { p_entry_id: entryId, p_name: String(file.name || '未命名附件'), p_mime_type: file.type, p_size: file.size })), expected);
        mediaRow(reserved, { id: entryId, authorId }, new Set(state.users.map(value => value.id)));
        if (reserved.status !== 'pending' || reserved.attached) throw invalid();
        const reservation = reserved; addedMedia.push(reservation);
        await result(client.storage.from(bucket).upload(reservation.storagePath, file, { contentType: file.type, upsert: false, cacheControl: '0' }), expected);
        const ready = await result(query(client.rpc('finalize_media', { p_media_id: reservation.id })), expected);
        if (ready?.id !== reservation.id || ready.status !== 'ready' || ready.attached) throw invalid();
    }
    // Uploads are staged separately from the attached set. Publication switches
    // the complete selection atomically, so replacing the ninth image never
    // destroys an old original just to make room for a pending upload.
    publicationAttempted = true;
    const ordered = resolveAttachmentOrder(order, kept, addedMedia);
    const published = await result(query(client.rpc('publish_entry', { p_entry_id: entryId, p_media_ids: ordered.map(value => value.id), p_expected_updated_at: row.updatedAt })), expected);
    if (published?.id !== entryId || published.status !== 'published') throw invalid();
    let cleanupPending = false;
    for (const old of removals) {
      try { await remove(old); } catch (error) { requireSession(expected); if (error.code === 'UNAUTHENTICATED') throw error; cleanupPending = true; }
    }
    await loadState(expected, user.id);
    const saved = state.entries.find(value => value.id === entryId);
    if (cleanupPending && saved) { saved.cleanupPending = true; saved.cleanupWarning = '内容已保存，部分旧附件尚待清理；请由维护账号检查。'; }
    return saved;
    } catch (error) {
      if (error.code === 'AUTH_CANCELLED' || error.code === 'UNAUTHENTICATED' || error.code === 'CONFLICT') throw error;
      if (expected === generation && !publicationAttempted) for (const added of [...addedMedia].reverse()) {
        try { await removeMedia(added, expected); } catch { /* Preserve registrations when physical removal could not be confirmed. */ }
      }
      const partial = new SupabaseProviderError('保存未完整完成，部分文字或附件可能已改变。请刷新核对后再重试。', 'PARTIAL_SAVE', error.status || 0);
      partial.causeCode = error.code; throw partial;
    }
  }
  async function setDeleted(entryId, deletedAt, expected) {
    const user = requireUser(expected), entry = findEntry(entryId, expected, { editable: true, allowDeleted: true });
    await patchEntry(entry, { deletedAt }, expected); await loadState(expected, user.id);
  }
  async function toggle(entryId, table, expected) {
    const user = requireUser(expected); findEntry(entryId, expected);
    const rows = await result(query(client.from(table).select('*').eq('entryId', entryId).eq('userId', user.id)), expected);
    if (!Array.isArray(rows)) throw invalid();
    if (rows.length) await result(query(client.from(table).delete().eq('entryId', entryId).eq('userId', user.id)), expected, { allowNull: true });
    else await result(query(client.from(table).insert({ entryId })), expected, { allowNull: true });
    await loadState(expected, user.id); return state.entries.find(value => value.id === entryId);
  }
  async function exportData(scope, expected) {
    const user = requireUser(expected);
    if (!['all', 'mine'].includes(scope)) throw new SupabaseProviderError('导出范围无效。', 'VALIDATION');
    await loadState(expected, user.id);
    const entries = clone(state.entries.filter(value => scope === 'all' || value.authorId === user.id));
    for (const entry of entries) for (const media of entry.media) {
      const cached = mediaCache.get(media.id); if (!cached) throw new SupabaseProviderError('导出缺少媒体文件，请刷新重试。', 'MISSING_MEDIA');
      const bytes = new Uint8Array(await cached.blob.arrayBuffer()); requireUser(expected); let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      delete media.url; media.data = btoa(binary); media.mimeType = cached.blob.type;
    }
    requireUser(expected);
    return new Blob([JSON.stringify({ format: 'chaoxi-memory', version: 1, mode: 'live', backend: 'supabase', mediaEncoding: 'base64', exportedAt: now(), scope, users: clone(state.users), settings: clone(state.settings), entries }, null, 2)], { type: 'application/json;charset=utf-8' });
  }

  const subscription = client.auth.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_OUT') {
      changeIdentity(null, false);
    }
    else if (['SIGNED_IN', 'TOKEN_REFRESHED'].includes(event) && UUID.test(session?.user?.id ?? '')) {
      // A different tab can replace the persisted session. Revoke the old
      // identity even while login/init is still hydrating and currentUser=null.
      if (authIdentity && session.user.id !== authIdentity) changeIdentity(session.user.id, true);
      else authIdentity = session.user.id;
    }
    else if (event === 'INITIAL_SESSION' && authIdentity === null && UUID.test(session?.user?.id ?? '')) authIdentity = session.user.id;
  });
  return {
    async loadMusic({ signal, revision } = {}) {
      const expected = generation;
      requireUser(expected);
      const requestSignal = signal ? AbortSignal.any([sessionController.signal, signal]) : sessionController.signal;
      const lookup = client.from('background_music').select('revision,current_id,play_mode,tracks').eq('id', 1);
      const staleOnly = Number.isSafeInteger(revision);
      const value = await result((staleOnly ? lookup.gt('revision', revision).maybeSingle() : lookup.single()).abortSignal(requestSignal), expected, { allowNull: staleOnly });
      return value ? musicState(value) : null;
    },
    saveMusic: (value, version) => enqueue(async expected => {
      const { current_id, play_mode, tracks } = musicState(value);
      const saved = await result(query(client.from('background_music').update({ current_id, play_mode, tracks }).eq('id', 1)
        .eq('revision', version).select('revision,current_id,play_mode,tracks').maybeSingle()), expected, { allowNull: true });
      if (!saved) throw new SupabaseProviderError('另一位成员刚更新了歌单，请重试。', 'CONFLICT', 409);
      return musicState(saved);
    }),
    async loadMusicFile(id, { signal } = {}) {
      const expected = generation;
      requireUser(expected);
      if (!MUSIC_UUID.test(id)) throw new SupabaseProviderError('音源地址无效。', 'VALIDATION');
      const requestSignal = signal ? AbortSignal.any([sessionController.signal, signal]) : sessionController.signal;
      return result(client.storage.from(BGM_BUCKET).download(id, {}, { signal: requestSignal, cache: 'no-store' }), expected);
    },
    uploadMusicFile: (file, mime) => enqueue(async expected => {
      if (!(file instanceof Blob) || !mime || mime !== musicFileType(file)) throw new SupabaseProviderError('请选择音频或 LRC 歌词文件。', 'VALIDATION');
      const id = crypto.randomUUID();
      // The SDK otherwise sends the browser's multipart file type, often octet-stream for .lrc.
      const body = mime === 'text/plain' ? await file.arrayBuffer() : file;
      requireUser(expected);
      const request = client.storage.from(BGM_BUCKET).upload(id, body, { contentType: mime, cacheControl: '0', upsert: false });
      await result(request, expected, { fallback: mime === 'text/plain' ? '歌词上传失败，请重新选择文件后重试。' : '音频上传未完成。' });
      return id;
    }),
    removeMusicFile: id => enqueue(async expected => {
      if (MUSIC_UUID.test(id)) await result(client.storage.from(BGM_BUCKET).remove([id]), expected);
    }),
    async recordActiveMinute() {
      const expected = generation;
      if (requireUser(expected).role === 'member') await result(query(client.rpc('record_active_minute')), expected, { allowNull: true });
    },
    async askAssistant(payload, { signal } = {}) {
      const expected = generation;
      const user = requireUser(expected);
      const requestSignal = AbortSignal.any([sessionController.signal, AbortSignal.timeout(80000), ...(signal ? [signal] : [])]);
      const { session } = await authResult(client.auth.getSession(), expected);
      requireIdentity(expected, user.id);
      if (session?.user?.id !== user.id || !session.access_token) throw new SupabaseProviderError('登录已失效，请重新登录。', 'UNAUTHENTICATED', 401);
      try {
        const reply = await requestAssistant(session.access_token, payload, requestSignal);
        requireIdentity(expected, user.id);
        return reply;
      } catch (error) {
        requireIdentity(expected, user.id);
        if (error.status === 401) changeIdentity(null, false);
        throw error;
      }
    },
    async init() {
      if ((loginAttempt && loginAttempt.generation === generation) || logoutPromise) throw new SupabaseProviderError('账号操作正在进行，请稍候。', 'AUTH_BUSY');
      if (state.currentUser) return enqueue(expected => loadState(expected, state.currentUser.id));
      if (!mayRestore) return state;
      if (initAttempt?.generation === generation) return initAttempt.promise;
      const expected = generation;
      const pending = (async () => {
        const session = await authResult(client.auth.getSession(), expected);
        if (!session.session) return state;
        bindIdentity(session.session.user?.id, expected);
        const data = await authResult(client.auth.getUser(), expected);
        if (!data.user) throw invalid();
        return loadState(expected, bindIdentity(data.user.id, expected));
      })();
      const attempt = { generation: expected, promise: pending }; initAttempt = attempt;
      try { return await pending; } catch (error) {
        if (expected === generation) {
          // A phone returning from the background may still be reconnecting.
          // Keep its valid lease available for retry, while discarding every
          // partially hydrated row/Blob until the server verifies it again.
          const retryable = ['NETWORK', 'RATE_LIMITED'].includes(error.code);
          clearLocal(); mayRestore = retryable;
        }
        throw error;
      }
      finally { if (initAttempt === attempt) initAttempt = null; }
    },
    async login(username, password, captchaToken) {
      if (loginAttempt || logoutPromise) throw new SupabaseProviderError('登录或退出正在进行，请稍候。', 'AUTH_BUSY');
      if (disposed) throw new SupabaseProviderError('记录服务已关闭，请重新打开页面。', 'AUTH_CANCELLED', 401);
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) throw new SupabaseProviderError('请填写账号和密码。', 'VALIDATION');
      if (typeof captchaToken !== 'string' || !captchaToken) throw new SupabaseProviderError('请先完成安全验证。', 'CAPTCHA_REQUIRED');
      const loginUsername = username.trim();
      if (!USERNAME.test(loginUsername)) throw new SupabaseProviderError('账号、密码或安全验证未通过。', 'LOGIN_FAILED', 401);
      // The administrator's private login name lives in its protected profile,
      // not in the public build. GoTrue still uses the stable internal email.
      const email = loginEmail(loginUsername);
      if (!email) throw new SupabaseProviderError('账号、密码或安全验证未通过。', 'LOGIN_FAILED', 401);
      client.memorySession?.beginSignIn();
      mayRestore = false; clearLocal(); const attempt = { generation }; loginAttempt = attempt;
      try {
        const data = await authResult(client.auth.signInWithPassword({ email, password, options: { captchaToken } }), attempt.generation);
        if (!data.session || !data.user) throw invalid();
        const userId = bindIdentity(data.user.id, attempt.generation);
        const ownProfile = await result(query(client.from('profiles').select('*').eq('id', userId).maybeSingle()), attempt.generation, { allowNull: true });
        if (!ownProfile || ownProfile.id !== userId || profile(ownProfile).username !== loginUsername) throw new SupabaseProviderError('账号、密码或安全验证未通过。', 'LOGIN_FAILED', 401);
        const loaded = await loadState(attempt.generation, userId);
        if (client.memorySession?.resume) await client.memorySession.resume(); else client.auth.startAutoRefresh?.();
        return loaded;
      } catch (error) {
        if (attempt.generation === generation) {
          clearLocal();
          try { await client.auth.signOut({ scope: 'local' }); } catch { /* State stays closed even when remote logout cannot be confirmed. */ }
        }
        if (error.code !== 'AUTH_CANCELLED' && (error.code === 'UNAUTHENTICATED' || [400, 401].includes(error.status))) throw new SupabaseProviderError('账号、密码或安全验证未通过，请重新验证后重试。', 'LOGIN_FAILED', 401);
        throw error;
      } finally { if (loginAttempt === attempt) loginAttempt = null; }
    },
    logout() {
      if (logoutPromise) return logoutPromise;
      mayRestore = false; const pendingAuth = [...authTasks]; clearLocal();
      if (client.memorySession?.pause) client.memorySession.pause(); else client.auth.stopAutoRefresh?.();
      const pending = (async () => {
        // GoTrue owns an in-memory session too. Wait for unabortable sign-in or
        // refresh calls, then sign out, so their late responses cannot retain it.
        await Promise.allSettled(pendingAuth);
        let response; try { response = await client.auth.signOut({ scope: 'local' }); } catch { throw new SupabaseProviderError('本机已退出；服务器会话撤销未能确认，请检查网络。', 'NETWORK'); }
        if (response?.error) throw new SupabaseProviderError('本机已退出；服务器会话撤销未能确认，请检查网络。', 'LOGOUT_UNCONFIRMED');
      })();
      logoutPromise = pending;
      return pending.finally(() => { if (logoutPromise === pending) logoutPromise = null; });
    },
    saveEntry: (input, files = []) => enqueue(expected => saveEntry(input, files, expected)),
    saveProfile: ({ name, avatarJpeg }) => enqueue(async expected => {
      const user = requireUser(expected);
      if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_PROFILE_NAME) {
        throw new SupabaseProviderError('请输入 1 至 60 个字符的展示昵称。', 'VALIDATION');
      }
      if (avatarJpeg !== undefined && avatarJpeg !== null && !validAvatarJpeg(avatarJpeg)) {
        throw new SupabaseProviderError('头像格式不正确，请重新选择。', 'VALIDATION');
      }
      const patch = {};
      if (name.trim() !== user.name) patch.name = name.trim();
      if (avatarJpeg !== undefined && avatarJpeg !== user.avatarJpeg) patch.avatarJpeg = avatarJpeg;
      if (!Object.keys(patch).length) return user;
      const saved = await result(query(client.from('profiles').update(patch).eq('id', user.id).select('*').maybeSingle()), expected,
        { allowNull: true, fallback: '个人资料未能保存，请检查连接后重试。' });
      if (!saved || saved.id !== user.id) throw new SupabaseProviderError('当前账号无法修改这份个人资料。', 'FORBIDDEN', 403);
      const updated = profile(saved);
      const index = state.users.findIndex(value => value.id === user.id);
      state.users[index] = updated;
      state.currentUser = updated;
      return updated;
    }),
    changePassword: ({ currentPassword, newPassword, captchaToken }) => enqueue(async expected => {
      const user = requireUser(expected), email = loginEmail(user.username);
      if (typeof client.memoryChangePassword !== 'function' || !email) {
        throw new SupabaseProviderError('密码修改服务暂时不可用。', 'CONFIG');
      }
      if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string'
        || newPassword.length < 6 || newPassword.length > 256 || currentPassword === newPassword
        || typeof captchaToken !== 'string' || !captchaToken) {
        throw new SupabaseProviderError('请填写当前密码、不同的新密码并完成安全验证。', 'VALIDATION');
      }
      await client.memoryChangePassword({ email, userId: user.id, currentPassword, newPassword, captchaToken },
        () => requireIdentity(expected, user.id));
    }),
    deleteEntry: entryId => enqueue(expected => setDeleted(entryId, now(), expected)),
    restoreEntry: entryId => enqueue(expected => setDeleted(entryId, null, expected)),
    toggleReaction: entryId => enqueue(expected => toggle(entryId, 'reactions', expected)),
    toggleFavorite: entryId => enqueue(expected => toggle(entryId, 'favorites', expected)),
    addComment: (entryId, text) => enqueue(async expected => {
      const user = requireUser(expected); findEntry(entryId, expected);
      if (typeof text !== 'string' || !text.trim() || text.trim().length > 5000) throw new SupabaseProviderError('回应不能为空，且最多 5000 个字符。', 'VALIDATION');
      const saved = await result(query(client.from('comments').insert({ entryId, content: text.trim() }).select('*').single()), expected);
      await loadState(expected, user.id); return state.entries.find(value => value.id === entryId)?.comments.find(value => value.id === saved.id);
    }),
    saveSettings: value => enqueue(async expected => {
      requireUser(expected);
      const settings = checkedSettings(value);
      const saved = await result(query(client.from('settings').update(settings).eq('id', 1).select('*').single()), expected);
      requireUser(expected); Object.assign(state.settings, checkedSettings(saved)); return state.settings;
    }),
    loadAdminActivity: days => enqueue(async expected => {
      if (requireUser(expected).role !== 'admin') throw new SupabaseProviderError('仅管理员可查看账号活动。', 'FORBIDDEN', 403);
      const report = await result(query(client.rpc('admin_activity_report', { p_days: days })), expected,
        { fallback: '统计暂时无法读取，请刷新重试。' });
      if (!Array.isArray(report.accounts) || !Array.isArray(report.recent) || !report.resources) {
        throw invalid('统计数据格式无效。');
      }
      return report;
    }),
    exportData: (scope = 'all') => enqueue(expected => exportData(scope, expected)),
    refresh: () => enqueue(expected => loadState(expected, state.currentUser.id)),
    dispose() { disposed = true; mayRestore = false; clearLocal(); if (client.memorySession?.dispose) client.memorySession.dispose(); else client.auth.stopAutoRefresh?.(); subscription?.data?.subscription?.unsubscribe(); },
  };
}
