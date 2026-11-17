import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { mountAttachmentSorter, destroyAttachmentSorter } from './attachment-sorter.js';
import { mountLoginCarousel } from './login-carousel.js';

export function loginPhotoEditorMarkup() {
  return `<form id="login-photos-form"><header class="login-photos-heading"><h2>登录页照片</h2><p>把喜欢的合照，放在回家的第一眼。</p></header><p class="login-photo-public-note">${icon('info')}这些照片会在登录前公开展示，请选择你们都愿意分享的照片。</p><div class="login-photo-editor-bar"><label class="upload-control login-photo-add">${icon('plus')}<span>新增照片</span><input type="file" data-login-photo-add accept="image/jpeg,image/png,image/webp" multiple disabled /></label><span class="login-photo-limit">最多 8 张 · 自动优化为静态照片</span><span class="login-photo-total num">0 / 8</span></div><div class="login-photo-editor-status" role="status">正在加载照片…</div><div class="editor-previews login-photo-editor-grid"></div><p class="login-photo-order-help">拖动照片左下角排序，也可聚焦排序按钮后按方向键。</p><div class="login-photo-cleanup"><button type="button" class="text-button" data-login-photo-cleanup>清理未完成上传</button><div class="login-photo-cleanup-confirm" hidden><p>会清理本账号尚未发布的上传，请先完成其他页面的编辑。</p><button type="button" class="text-button" data-login-photo-cleanup-confirm>继续清理</button><button type="button" class="text-button" data-login-photo-cleanup-cancel>取消</button></div></div><p class="form-error" role="alert"></p><footer class="dialog-footer"><button type="button" class="text-button" data-login-photo-cancel>取消</button><div class="login-photo-save-actions"><button type="button" class="secondary" data-login-photo-preview disabled>预览登录效果</button><button type="submit" class="primary" disabled>${icon('check')}保存并公开展示</button></div></footer></form>`;
}

export function mountLoginPhotoEditor(root, { provider, prepareFile, onSaved, onCancel, onError = () => {} } = {}) {
  const form = root.querySelector('#login-photos-form');
  const grid = form.querySelector('.login-photo-editor-grid'), status = form.querySelector('[role=status]');
  const events = new AbortController(), urls = new Set();
  let items = [], revision, destroyed = false, busy = false, saving = false, ready = false, previewController, previewPanel;
  const releaseLocalPreview = item => { if (item?.url && urls.delete(item.url)) URL.revokeObjectURL(item.url); };
  const showError = error => { if (!destroyed) form.querySelector('.form-error').textContent = error?.message || '暂时未能完成，请重试。'; };
  const isCurrent = () => !destroyed && form.isConnected;
  const setBusy = value => {
    busy = value; form.setAttribute('aria-busy', String(value));
    form.querySelectorAll('button,input').forEach(control => { control.disabled = value || !ready; });
    const add = form.querySelector('[data-login-photo-add]'); if (add) add.disabled = value || !ready || items.length >= 8;
    const submit = form.querySelector('[type=submit]'); submit.disabled = value || !ready;
    if (grid.memorySorter) grid.memorySorter.option('disabled', value);
  };
  const draw = (focusKey = '') => {
    destroyAttachmentSorter(root);
    grid.innerHTML = items.map((item, index) => `<div class="attachment-preview login-photo-preview" data-key="${esc(item.key)}"><div class="login-photo-thumbnail">${item.url ? `<img src="${esc(item.url)}" alt="登录页照片 ${index + 1}" draggable="false" />` : '<span>照片暂时无法加载</span>'}</div><button type="button" class="preview-handle login-photo-handle" data-key="${esc(item.key)}" aria-label="第 ${index + 1} 张照片，拖动排序或按方向键移动">${icon('grip')}<span class="num">${index + 1}</span></button><label class="login-photo-replace">替换<input type="file" data-login-photo-replace="${esc(item.key)}" accept="image/jpeg,image/png,image/webp" aria-label="替换第 ${index + 1} 张照片" /></label><button type="button" class="login-photo-remove" data-login-photo-remove="${esc(item.key)}" aria-label="移除第 ${index + 1} 张照片">${icon('close')}</button></div>`).join('');
    grid.classList.toggle('is-empty', !items.length);
    if (!items.length) grid.innerHTML = '<p class="login-photo-empty">还没有展示照片，新增后即可预览。</p>';
    form.querySelector('.login-photo-total').textContent = `${items.length} / 8`;
    form.querySelector('.login-photo-order-help').hidden = items.length < 2;
    setBusy(busy);
    if (items.length > 1) mountAttachmentSorter(grid, keys => {
      if (!isCurrent() || busy) return;
      const lookup = new Map(items.map(item => [item.key, item]));
      items = keys.map(key => lookup.get(key)).filter(Boolean); queueMicrotask(() => draw());
    }, showError).then(() => { if (isCurrent() && grid.memorySorter) grid.memorySorter.option('disabled', busy); });
    if (focusKey) [...grid.querySelectorAll('.login-photo-handle')].find(handle => handle.dataset.key === focusKey)?.focus({ preventScroll: true });
  };
  form.addEventListener('click', async event => {
    const remove = event.target.closest('[data-login-photo-remove]');
    if (remove && !busy) {
      releaseLocalPreview(items.find(item => item.key === remove.dataset.loginPhotoRemove));
      items = items.filter(item => item.key !== remove.dataset.loginPhotoRemove); draw();
    }
    if (event.target.closest('[data-login-photo-cancel]') && !saving) onCancel?.();
    if (event.target.closest('[data-login-photo-cleanup]') && !busy) form.querySelector('.login-photo-cleanup-confirm').hidden = false;
    if (event.target.closest('[data-login-photo-cleanup-cancel]')) form.querySelector('.login-photo-cleanup-confirm').hidden = true;
    if (event.target.closest('[data-login-photo-cleanup-confirm]') && !busy) {
      setBusy(true); status.textContent = '正在清理未完成上传…';
      try {
        const cleaned = await provider.cleanupLoginPhotos({ includeRecent: true });
        if (!isCurrent()) return;
        status.textContent = cleaned.cleanupPending ? '部分文件暂时无法清理，请稍后重试。' : `已清理 ${cleaned.cleaned} 个未使用文件`;
        form.querySelector('.login-photo-cleanup-confirm').hidden = true;
      } catch (error) { showError(error); }
      finally { if (isCurrent()) setBusy(false); }
    }
    if (event.target.closest('[data-login-photo-preview]') && !busy) {
      previewPanel = document.createElement('section'); previewPanel.className = 'login-photos-preview';
      previewPanel.innerHTML = `<div class="login-photos-preview-heading"><h2>登录效果预览</h2><button type="button" class="text-button" data-preview-back>返回编辑</button></div><div class="login-layout"><section class="login-story" aria-label="朝夕"><a class="login-brand"><img src="./assets/mark.svg" alt="" width="44" height="44" /><span>朝夕<small>我们的记忆</small></span></a><div class="login-story-copy"><h1>把日子过成故事，<br>把我们写进朝夕。</h1></div></section><section class="login-panel"><div class="login-lock">${icon('lock')}我们的共同空间</div><h2>好久不见，欢迎回家</h2><p>登录后，翻开属于我们的那一页。</p><label>账号<input type="text" placeholder="输入你的账号" disabled /></label><label>密码<input type="password" placeholder="输入你的密码" disabled /></label><button type="button" class="primary" disabled>翻开我们的记忆${icon('arrow')}</button></section></div><p class="login-photo-preview-note">当前为预览，点击保存后才会更新登录页。</p>`;
      form.hidden = true; root.querySelector('dialog').append(previewPanel);
      previewController = mountLoginCarousel(previewPanel.querySelector('.login-story'), { photos: items.map(item => ({ id: item.id || item.key, url: item.url })) });
      previewPanel.querySelector('[data-preview-back]').addEventListener('click', () => {
        previewController?.destroy(); previewController = null; previewPanel.remove(); previewPanel = null; form.hidden = false;
        form.querySelector('[data-login-photo-preview]').focus({ preventScroll: true });
      }, { signal: events.signal });
    }
  }, { signal: events.signal });
  form.addEventListener('keydown', event => {
    const handle = event.target.closest('.login-photo-handle');
    if (!handle || busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const from = items.findIndex(item => item.key === handle.dataset.key);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : from + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1); items.splice(to, 0, item); draw(item.key);
    status.textContent = `已将照片移到第 ${to + 1} 位`;
  }, { signal: events.signal });
  form.addEventListener('change', async event => {
    const input = event.target;
    if (!input.matches('[data-login-photo-add],[data-login-photo-replace]') || busy) return;
    const files = [...input.files]; input.value = '';
    if (!files.length) return;
    const replaceKey = input.dataset.loginPhotoReplace;
    if (!replaceKey && files.length + items.length > 8) { showError(new Error('最多展示 8 张照片，请先移除几张再添加。')); return; }
    setBusy(true); status.textContent = '正在优化照片…'; form.querySelector('.form-error').textContent = '';
    const prepared = [], newUrls = [];
    try {
      // Prepare the full selection before changing the visible list, so a failure cannot partly replace it.
      for (const file of files) {
        const optimized = await prepareFile(file);
        if (!isCurrent()) return;
        const url = URL.createObjectURL(optimized); newUrls.push(url);
        prepared.push({ key: crypto.randomUUID(), kind: 'file', file: optimized, url });
      }
      if (replaceKey) { const index = items.findIndex(item => item.key === replaceKey); if (index >= 0) { releaseLocalPreview(items[index]); items.splice(index, 1, { ...prepared[0], key: replaceKey }); } }
      else items.push(...prepared);
      newUrls.forEach(url => urls.add(url)); newUrls.length = 0;
      status.textContent = '照片已准备好，保存后生效'; draw();
    } catch (error) { showError(error); status.textContent = '原有照片已保留'; }
    finally { newUrls.forEach(url => URL.revokeObjectURL(url)); if (isCurrent()) setBusy(false); }
  }, { signal: events.signal });
  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopPropagation();
    if (busy || !ready || !form.reportValidity()) return;
    saving = true; setBusy(true); status.textContent = '正在保存照片…'; form.querySelector('.form-error').textContent = '';
    try {
      const files = [], photos = items.map(item => item.kind === 'file' ? { fileIndex: files.push(item.file) - 1 } : { id: item.id });
      const manifest = await provider.saveLoginPhotos({ revision, photos }, files);
      if (isCurrent()) { saving = false; onSaved?.(manifest); }
    } catch (error) { showError(error); status.textContent = error?.code === 'CONFLICT' ? '另一位成员已更新照片。请重新打开后再编辑。' : '未保存的编辑仍保留在这里'; onError(error); }
    finally { saving = false; if (isCurrent()) setBusy(false); }
  }, { signal: events.signal });
  Promise.resolve().then(() => provider.getLoginPhotos({ hydrate: true })).then(manifest => {
    if (!isCurrent()) return;
    revision = manifest.revision;
    items = (manifest.photos || []).map(photo => ({ ...photo, kind: 'photo', key: crypto.randomUUID() }));
    ready = true; status.textContent = items.length ? '两个人都可以编辑' : ''; draw();
  }).catch(error => { if (isCurrent()) { showError(error); status.textContent = '照片列表暂时无法加载，请关闭后重试。'; form.querySelector('[data-login-photo-cancel]').disabled = false; } });
  return {
    get isSaving() { return saving; },
    destroy() { destroyed = true; events.abort(); previewController?.destroy(); previewPanel?.remove(); destroyAttachmentSorter(root); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); },
  };
}
