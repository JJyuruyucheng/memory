// Deliberately public login artwork is separate from private journal media.
// The official client's publishable key can read only the selected manifest and
// selected objects. All writes are independently authorized by database policies.
export const LOGIN_PHOTO_LIMITS = Object.freeze({ maxPhotos: 8, maxFileBytes: 5_000_000, mimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'login-photos';

export class LoginPhotosError extends Error {
  constructor(message, code = 'LOGIN_PHOTOS_ERROR') { super(message); this.name = 'LoginPhotosError'; this.code = code; }
}
const invalid = () => new LoginPhotosError('登录相册返回的数据不完整，请稍后重试。', 'INVALID_RESPONSE');
function checkedPhoto(raw) {
  if (!raw || !UUID.test(raw.id) || raw.path !== `slides/${raw.id}` || !LOGIN_PHOTO_LIMITS.mimeTypes.includes(raw.mimeType) || !Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > LOGIN_PHOTO_LIMITS.maxFileBytes) throw invalid();
  return { id: raw.id, path: raw.path, mimeType: raw.mimeType, size: raw.size };
}
function checkedManifest(raw) {
  if (!raw || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.photos) || raw.photos.length > LOGIN_PHOTO_LIMITS.maxPhotos) throw invalid();
  const photos = raw.photos.map(checkedPhoto);
  if (new Set(photos.map(photo => photo.id)).size !== photos.length) throw invalid();
  return { revision: raw.revision, photos };
}
function validateSave(input, files) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Array.isArray(input.photos) || input.photos.length > LOGIN_PHOTO_LIMITS.maxPhotos || !Array.isArray(files)) throw new LoginPhotosError('最多选择 8 张登录照片。', 'VALIDATION');
  const ids = new Set(), indexes = new Set();
  for (const item of input.photos) {
    if (item && UUID.test(item.id) && item.fileIndex === undefined) {
      if (ids.has(item.id)) throw new LoginPhotosError('同一张照片不能重复选择。', 'VALIDATION');
      ids.add(item.id);
    } else if (item && item.id === undefined && Number.isInteger(item.fileIndex) && item.fileIndex >= 0 && item.fileIndex < files.length && !indexes.has(item.fileIndex)) indexes.add(item.fileIndex);
    else throw new LoginPhotosError('照片顺序无效，请重新选择。', 'VALIDATION');
  }
  if (indexes.size !== files.length || files.some(file => !(file instanceof Blob) || !LOGIN_PHOTO_LIMITS.mimeTypes.includes(file.type) || file.size < 1 || file.size > LOGIN_PHOTO_LIMITS.maxFileBytes)) throw new LoginPhotosError('请使用不超过 5 MB 的 JPEG、PNG 或 WebP 照片。', 'VALIDATION');
}
function sdkError(error) {
  const status = Number(error?.status || error?.statusCode || 0), code = String(error?.code || '');
  if (['PT409', '40001'].includes(code) || status === 409) return new LoginPhotosError('登录照片已被另一个页面更新，请重新打开后再保存。', 'CONFLICT');
  if (status === 401) return new LoginPhotosError('登录已失效，请重新登录后编辑。', 'UNAUTHENTICATED');
  if (status === 403 || code === '42501') return new LoginPhotosError('当前账号无法编辑这些登录照片。', 'FORBIDDEN');
  if (code === 'P0001' && error?.message === 'LOGIN_PHOTO_QUOTA') return new LoginPhotosError('未完成上传过多，请先清理当前账号未发布的登录照片。', 'UPLOAD_QUOTA');
  if (code === '23514' || code === '22023') return new LoginPhotosError('照片尚未上传完成、格式不符或待清理文件过多，请重试。', 'VALIDATION');
  return new LoginPhotosError('登录照片服务连接失败，请稍后重试。', 'NETWORK');
}
async function result(operation) {
  let response;
  try { response = await operation; } catch (error) { if (error instanceof LoginPhotosError) throw error; throw sdkError(error); }
  if (!response || !('error' in response)) throw invalid();
  if (response.error) throw sdkError(response.error);
  return response.data;
}

export function createLoginPhotosProvider({ client, getCurrentUser, urlAPI = globalThis.URL } = {}) {
  if (!client?.rpc || !client.storage?.from || !client.auth?.getUser) throw new LoginPhotosError('登录相册服务尚未配置。', 'CONFIG');
  let manifest = { revision: 0, photos: [] }, disposed = false, identity, generation = 0, saving = false, listGeneration = 0;
  const urls = new Map(), downloads = new Map(), unavailable = new Set(), waiters = [];
  let downloading = 0;
  const subscription = client.auth.onAuthStateChange?.((_event, session) => {
    const next = session?.user?.id || null;
    if (identity !== undefined && identity !== next) generation++;
    identity = next;
  })?.data?.subscription;
  function assertOpen() { if (disposed) throw new LoginPhotosError('登录相册已关闭。', 'CANCELLED'); }
  function assertActor(actor) {
    assertOpen();
    if (generation !== actor.generation || identity !== actor.id || (getCurrentUser && getCurrentUser()?.id !== actor.id)) throw new LoginPhotosError('账号已经切换，请重新打开登录相册。', 'AUTH_CANCELLED');
  }
  async function actor() {
    assertOpen();
    const data = await result(client.auth.getUser());
    if (!UUID.test(data?.user?.id) || (getCurrentUser && getCurrentUser()?.id !== data.user.id)) throw new LoginPhotosError('请先登录后编辑照片。', 'UNAUTHENTICATED');
    if (identity === undefined) identity = data.user.id;
    const value = { id: data.user.id, generation }; assertActor(value); return value;
  }
  function expose(value = manifest) { return { revision: value.revision, photos: value.photos.map(photo => ({ ...photo, ...(urls.has(photo.id) ? { url: urls.get(photo.id) } : {}), ...(unavailable.has(photo.id) ? { unavailable: true } : {}) })) }; }
  function adopt(value) {
    const next = checkedManifest(value);
    for (const [id, url] of urls) if (!next.photos.some(photo => photo.id === id)) { urlAPI.revokeObjectURL(url); urls.delete(id); }
    for (const id of unavailable) if (!next.photos.some(photo => photo.id === id)) unavailable.delete(id);
    manifest = next; return expose();
  }
  async function withDownloadSlot(task) {
    if (downloading >= 2) await new Promise(resolve => waiters.push(resolve));
    downloading++;
    try { assertOpen(); return await task(); }
    finally { downloading--; waiters.shift()?.(); }
  }
  async function getLoginPhotoUrl(photoId) {
    assertOpen();
    const photo = manifest.photos.find(item => item.id === photoId);
    if (!photo) throw new LoginPhotosError('这张登录照片已移除，请刷新相册。', 'NOT_FOUND');
    if (urls.has(photoId)) return urls.get(photoId);
    if (!downloads.has(photoId)) downloads.set(photoId, withDownloadSlot(async () => {
      unavailable.delete(photoId);
      const blob = await result(client.storage.from(BUCKET).download(photo.path));
      assertOpen();
      if (!manifest.photos.some(item => item.id === photoId)) throw new LoginPhotosError('这张登录照片已移除。', 'NOT_FOUND');
      if (!(blob instanceof Blob) || blob.type !== photo.mimeType || blob.size !== photo.size) throw invalid();
      const url = urlAPI.createObjectURL(blob); urls.set(photoId, url); return url;
    }).catch(error => { unavailable.add(photoId); throw error; }).finally(() => downloads.delete(photoId)));
    return downloads.get(photoId);
  }
  async function getLoginPhotos({ hydrate = false } = {}) {
    assertOpen(); const expected = ++listGeneration;
    const next = await result(client.rpc('get_login_photos'));
    assertOpen();
    // A slower earlier request cannot overwrite a newer manifest/save.
    if (expected === listGeneration) adopt(next);
    // A broken image must not prevent members from opening the editor to remove
    // or replace it. Authentication/disposal remains checked after hydration.
    if (hydrate) await Promise.allSettled(manifest.photos.map(photo => getLoginPhotoUrl(photo.id)));
    assertOpen();
    return expose();
  }
  async function cleanupAsset(asset, expected) {
    assertActor(expected);
    await result(client.storage.from(BUCKET).remove([asset.path]));
    assertActor(expected);
    await result(client.rpc('discard_login_photo', { p_photo_id: asset.id }));
    assertActor(expected);
  }
  async function cleanup(expected, { includeRecent = false } = {}) {
    const rows = await result(client.rpc('get_login_photo_cleanup')); assertActor(expected);
    if (!Array.isArray(rows) || rows.length > 56) throw invalid();
    let cleanupPending = false, cleaned = 0;
    for (const row of rows) {
      if (!row || !UUID.test(row.id) || row.path !== `slides/${row.id}` || !['pending', 'ready', 'retired'].includes(row.status) || !Number.isFinite(Date.parse(row.createdAt))) throw invalid();
      // Another device using the same account may still be editing a staged
      // upload. Only explicitly requested cleanup may discard those files.
      if (!includeRecent && row.status !== 'retired') continue;
      try { await cleanupAsset(row, expected); cleaned++; }
      catch (error) { assertActor(expected); cleanupPending = true; }
    }
    return { cleaned, cleanupPending };
  }
  async function cleanupLoginPhotos(options) { const expected = await actor(); return cleanup(expected, options); }
  async function saveLoginPhotos(input, files = []) {
    validateSave(input, files); assertOpen();
    if (saving) throw new LoginPhotosError('照片正在保存，请稍候。', 'BUSY');
    saving = true;
    const reserved = []; let expected, published = false;
    try {
      expected = await actor();
      // Cleanup is best effort and never blocks a healthy manifest update.
      try { await cleanup(expected); } catch { assertActor(expected); }
      const selected = [];
      for (const item of input.photos) {
        assertActor(expected);
        if (item.id) { selected.push(item.id); continue; }
        const file = files[item.fileIndex];
        const asset = checkedPhoto(await result(client.rpc('reserve_login_photo', { p_mime_type: file.type, p_size: file.size })));
        reserved.push(asset); assertActor(expected);
        await result(client.storage.from(BUCKET).upload(asset.path, file, { contentType: file.type, upsert: false, cacheControl: '60' })); assertActor(expected);
        const finalized = checkedPhoto(await result(client.rpc('finalize_login_photo', { p_photo_id: asset.id }))); assertActor(expected);
        if (finalized.id !== asset.id || finalized.path !== asset.path || finalized.mimeType !== asset.mimeType || finalized.size !== asset.size) throw invalid();
        selected.push(asset.id);
      }
      const saved = await result(client.rpc('publish_login_photos', { p_photo_ids: selected, p_expected_revision: input.revision }));
      assertActor(expected); published = true; listGeneration++; adopt(saved);
      let cleanupPending = false;
      try { ({ cleanupPending } = await cleanup(expected)); } catch { cleanupPending = true; }
      assertActor(expected);
      return { ...expose(), cleanupPending };
    } catch (error) {
      // Never remove arbitrary rows or old photos. Server policies additionally
      // protect a successfully published set if the publish response was lost.
      if (!published && expected) for (const asset of reserved) {
        try { await cleanupAsset(asset, expected); } catch { /* A later cleanup retries only this account's unused uploads. */ }
      }
      throw error;
    } finally { saving = false; }
  }
  function dispose() {
    if (disposed) return; disposed = true; generation++; subscription?.unsubscribe();
    for (const url of urls.values()) urlAPI.revokeObjectURL(url);
    urls.clear();
    for (const resolve of waiters.splice(0)) resolve();
  }
  return { getLoginPhotos, getLoginPhotoUrl, getPhotoUrl: getLoginPhotoUrl, saveLoginPhotos, cleanupLoginPhotos, dispose, limits: LOGIN_PHOTO_LIMITS };
}

// The demo remains a local preview. It never copies private journal attachments
// into the public selection and never sends demo files to production storage.
export function createDemoLoginPhotosProvider({ getCurrentUser, urlAPI = globalThis.URL, initial = { revision: 0, photos: [] } } = {}) {
  let manifest = checkedManifest(initial), disposed = false;
  const urls = new Map(initial.photos.filter(photo => photo.url).map(photo => [photo.id, photo.url])), ownedUrls = new Set();
  function open() { if (disposed) throw new LoginPhotosError('登录相册已关闭。', 'CANCELLED'); }
  const expose = () => ({ revision: manifest.revision, photos: manifest.photos.map(photo => ({ ...photo, ...(urls.has(photo.id) ? { url: urls.get(photo.id) } : {}) })) });
  async function getLoginPhotos() { open(); return expose(); }
  async function getLoginPhotoUrl(id) { open(); if (!manifest.photos.some(photo => photo.id === id) || !urls.has(id)) throw new LoginPhotosError('照片不存在。', 'NOT_FOUND'); return urls.get(id); }
  async function saveLoginPhotos(input, files = []) {
    open(); validateSave(input, files);
    if (!getCurrentUser?.()) throw new LoginPhotosError('请先登录。', 'UNAUTHENTICATED');
    if (input.revision !== manifest.revision) throw new LoginPhotosError('登录相册已更新，请重新打开。', 'CONFLICT');
    const photos = input.photos.map(item => {
      if (item.id) { const photo = manifest.photos.find(value => value.id === item.id); if (!photo) throw new LoginPhotosError('照片不存在。', 'NOT_FOUND'); return photo; }
      const file = files[item.fileIndex], id = crypto.randomUUID(), url = urlAPI.createObjectURL(file);
      urls.set(id, url); ownedUrls.add(url); return { id, path: `slides/${id}`, mimeType: file.type, size: file.size };
    });
    for (const [id, url] of urls) if (!photos.some(photo => photo.id === id)) { if (ownedUrls.delete(url)) urlAPI.revokeObjectURL(url); urls.delete(id); }
    manifest = { revision: manifest.revision + 1, photos }; return { ...expose(), cleanupPending: false };
  }
  function dispose() { disposed = true; for (const url of ownedUrls) urlAPI.revokeObjectURL(url); urls.clear(); ownedUrls.clear(); }
  return { getLoginPhotos, getLoginPhotoUrl, getPhotoUrl: getLoginPhotoUrl, saveLoginPhotos, cleanupLoginPhotos: async () => ({ cleaned: 0, cleanupPending: false }), dispose, limits: LOGIN_PHOTO_LIMITS };
}
