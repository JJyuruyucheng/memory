import { audioFileType, BGM_ACCEPT } from './background-music-data.js';
import { escapeHtml as esc } from './domain.js';
import { mountFileDrop } from './file-drop.js';
import { icon } from './icons.js';
import { loadLocalScript } from './local-script.js';

function adjacentRow(items, from, direction) {
  const boxes = items.map(item => item.getBoundingClientRect()), origin = boxes[from];
  const candidates = boxes.map((box, index) => ({ box, index }))
    .filter(({ box }) => (box.top - origin.top) * direction > 1);
  const row = candidates.reduce((nearest, { box }) =>
    Math.abs(box.top - origin.top) < Math.abs(nearest - origin.top) ? box.top : nearest, Infinity);
  const center = box => box.left + box.width / 2;
  return candidates.filter(({ box }) => Math.abs(box.top - row) < 1)
    .sort((a, b) => Math.abs(center(a.box) - center(origin)) - Math.abs(center(b.box) - center(origin)))[0]?.index ?? -1;
}

const folderButton = (action, label, css = 'secondary') =>
  `<button type="button" class="${css}" data-library="${action}">${label}</button>`;

function folderPanel() {
  return `<section class="bgm-folders" aria-label="音乐文件夹">
    <div class="bgm-folder-header"><h3>文件夹</h3>${folderButton('new-folder', '新建文件夹')}</div>
    <div class="bgm-folder-browse">
      <button type="button" class="bgm-folder-open" data-library="browse-all" aria-pressed="true">全部</button>
      <ol class="bgm-folder-list" aria-label="文件夹顺序"></ol>
    </div>
    <div class="bgm-folder-tools" hidden></div>
    <dialog class="dialog bgm-folder-dialog" aria-labelledby="bgm-folder-dialog-title"></dialog>
  </section>`;
}

export function mountMusicSettings(slot, actions, { scope = 'site' } = {}) {
  const events = new AbortController(), { signal } = events;
  const points = scope === 'points';
  const folders = !points && actions.folders;
  const heading = points ? '积分专属音乐' : '背景音乐';
  const editTitle = points ? 'points-bgm-edit-title' : 'bgm-edit-title';
  const audioHelp = points ? 'points-bgm-audio-help' : 'bgm-audio-help';
  slot.innerHTML = `
    <div class="bgm-library-head"><h2>${heading}</h2><span class="bgm-total"></span><button type="button" class="secondary" data-library="new" aria-expanded="false">${icon('plus')}添加音乐</button></div>
    ${folders ? folderPanel() : ''}
    <form class="bgm-upload" hidden>
      <label>曲名<input name="title" maxlength="80" placeholder="使用文件名" /></label>
      <label>演唱者<input name="artist" maxlength="80" /></label>
      <div class="bgm-audio-upload">
        <label class="upload-control bgm-audio-drop">${icon('music')}<span>选取音频</span><small>也可拖入文件</small><input name="audio" type="file" accept="${BGM_ACCEPT}" aria-describedby="${audioHelp}" required /></label>
        <small class="bgm-audio-selection" id="${audioHelp}" role="status">单首音频不超过 25 MB。</small>
      </div>
      <label>LRC 歌词<input name="lyrics" type="file" accept=".lrc" /></label>
      <button class="primary" type="submit">保存曲目</button>
    </form>
    <ol class="bgm-sort-list" aria-label="${points ? '积分歌单' : '共同歌单'}"></ol>
    <p class="bgm-feedback bgm-settings-feedback" role="status"></p>
    <dialog class="dialog bgm-edit-dialog" aria-labelledby="${editTitle}">
      <h2 id="${editTitle}">曲目设置</h2><button type="button" class="icon-button dialog-close" data-library="close" aria-label="关闭曲目设置">${icon('close')}</button>
      <div class="bgm-edit-files">
        <label class="bgm-file-label"><span>上传音源</span><input type="file" name="audio" accept="${BGM_ACCEPT}" /></label>
        <label class="bgm-file-label"><span>上传 LRC 歌词</span><input type="file" name="lyrics" accept=".lrc" /></label>
      </div>
      <div class="bgm-edit-actions">
        ${folders ? folderButton('detach-track', '移出此文件夹', 'text-button') : ''}
        <button type="button" class="text-button" data-library="unlyric">移除歌词</button>
        <button type="button" class="text-button danger" data-library="remove">删除曲目</button>
      </div>
      <p class="bgm-feedback" role="status"></p>
    </dialog>`;
  const list = slot.querySelector('.bgm-sort-list'), add = slot.querySelector('.bgm-upload'), dialog = slot.querySelector('.bgm-edit-dialog');
  const newButton = slot.querySelector('[data-library="new"]'), audio = add.elements.audio;
  const audioDrop = add.querySelector('.bgm-audio-drop'), audioSelection = add.querySelector('.bgm-audio-selection');
  const folderList = slot.querySelector('.bgm-folder-list'), folderTools = slot.querySelector('.bgm-folder-tools');
  const folderDialog = slot.querySelector('.bgm-folder-dialog'), feedback = slot.querySelector('.bgm-settings-feedback');
  let editing, state, pointsState, folderState, browseId = null, sortable, folderSortable, folderOrigin;
  let audioFile, dropEvents, uploading = false, dragging = false, redrawPending = false, sortSaving = false;

  const folderFor = id => folderState?.folders.find(folder => folder.id === id);
  const browseFolder = () => folderFor(browseId);
  const allTracks = () => {
    const own = (state?.tracks ?? []).map(track => ({ ...track, owner: scope }));
    if (!folders) return own;
    const tracks = new Map(own.map(track => [track.id, track]));
    for (const track of pointsState?.tracks ?? []) {
      if (!tracks.has(track.id)) tracks.set(track.id, { ...track, owner: 'points' });
    }
    return [...tracks.values()];
  };
  const currentId = () => {
    if (!folders || !folderState) return state?.current_id;
    if (folderState.active_folder_id !== browseId) return null;
    return folderState.current_id ?? (browseId ? null : state?.current_id);
  };
  const isTrackSortable = track => !!browseFolder() || track.owner === scope;

  function message(text) {
    const output = folderDialog?.open ? folderDialog.querySelector('.bgm-feedback')
      : dialog.open ? dialog.querySelector('.bgm-feedback') : feedback;
    for (const status of slot.querySelectorAll('.bgm-feedback')) status.textContent = status === output ? text : '';
  }

  function showTrack() {
    const track = allTracks().find(item => item.id === editing?.id);
    if (!track) { dialog.close(); return; }
    dialog.querySelector('h2').textContent = track.title;
    dialog.querySelector('[name="audio"]').previousElementSibling.textContent = track.audio ? '更换音源' : '上传音源';
    dialog.querySelector('[name="lyrics"]').previousElementSibling.textContent = track.lyrics ? '更换 LRC 歌词' : '上传 LRC 歌词';
    dialog.querySelector('[data-library="unlyric"]').hidden = !track.lyrics;
    const detach = dialog.querySelector('[data-library="detach-track"]');
    if (detach) detach.hidden = !folderFor(editing.folderId)?.track_ids.includes(track.id);
  }

  function drawFolders() {
    const current = browseFolder();
    slot.querySelector('[data-library="new-folder"]').disabled = !folderState;
    slot.querySelector('[data-library="browse-all"]').setAttribute('aria-pressed', String(!current));
    folderList.innerHTML = (folderState?.folders ?? []).map(folder => `<li data-id="${esc(folder.id)}" class="bgm-folder-item">
      <button type="button" class="bgm-folder-grip" aria-label="调整${esc(folder.name)}的顺序" title="拖动或按方向键排序">${icon('grip')}</button>
      <button type="button" class="bgm-folder-open" data-library="browse-folder" aria-pressed="${folder.id === browseId}" title="${esc(folder.name)}">${esc(folder.name)}</button>
    </li>`).join('');
    folderTools.hidden = !folderState;
    folderTools.innerHTML = folderState ? `<span class="bgm-folder-view">${current ? esc(current.name) : '全部曲目'}</span>
      ${folderButton('play-folder', current ? '播放文件夹' : '播放全部')}
      ${current ? folderButton('choose-tracks', '从曲库添加') + folderButton('rename-folder', '重命名', 'text-button')
        + folderButton('delete-folder', '删除文件夹', 'text-button danger') : ''}` : '';
  }

  function draw() {
    const active = document.activeElement;
    const activeRow = active?.closest?.('li[data-id]');
    const activeList = activeRow?.parentElement;
    const activeId = activeRow?.dataset.id;
    const activeAction = active?.dataset?.library;
    const activeTool = folderTools?.contains(active);
    const gripClass = active?.classList?.contains('bgm-grip') ? '.bgm-grip' : active?.classList?.contains('bgm-folder-grip') ? '.bgm-folder-grip' : null;
    if (browseId && !browseFolder()) browseId = null;
    if (folders) drawFolders();
    const tracks = allTracks();
    const byId = new Map(tracks.map(track => [track.id, track]));
    const visible = browseFolder() ? browseFolder().track_ids.map(id => byId.get(id)).filter(Boolean) : tracks;
    const current = currentId();
    slot.querySelector('.bgm-total').textContent = state || pointsState ? `${visible.length} 首` : '正在读取歌单…';
    list.innerHTML = visible.map(track => `<li data-id="${esc(track.id)}" data-owner="${track.owner}"
      ${isTrackSortable(track) ? 'data-sortable' : ''} class="bgm-track" data-current="${track.id === current}">
      ${isTrackSortable(track) ? `<button type="button" class="bgm-grip" aria-label="调整${esc(track.title)}顺序" title="拖动排序">${icon('grip')}</button>` : '<span class="bgm-grip-spacer" aria-hidden="true"></span>'}
      <button type="button" class="bgm-track-main" data-library="select" aria-pressed="${track.id === current}" title="${esc(track.title)}">
        <strong>${esc(track.title)}</strong><small>${esc(track.artist || (track.audio ? '' : '待上传音源'))}</small></button>
      <button type="button" class="bgm-more" data-library="edit" aria-label="编辑${esc(track.title)}">${icon('more')}</button>
    </li>`).join('');
    if (activeList === list || activeList === folderList) {
      const row = [...activeList.children].find(item => item.dataset.id === activeId);
      const target = gripClass ? row?.querySelector(gripClass) : activeAction && row?.querySelector(`[data-library="${activeAction}"]`);
      target?.focus({ preventScroll: true });
    } else if (activeTool && activeAction) {
      folderTools.querySelector(`[data-library="${activeAction}"]`)?.focus({ preventScroll: true });
    }
    if (dialog.open) showTrack();
  }

  function render(next, context = {}) {
    state = next;
    pointsState = context.pointsState;
    folderState = context.folderState;
    if (dragging) { redrawPending = true; return; }
    draw();
  }

  function pickAudio(files) {
    if (uploading) return;
    const [file] = files;
    const error = files.length !== 1 ? '一次只能选择一首音频。' : !audioFileType(file) ? '请选择 25 MB 以内的音频文件。' : '';
    audioSelection.dataset.error = String(Boolean(error));
    if (error) {
      audioSelection.textContent = audioFile ? `${error}已保留 ${audioFile.name}。` : error;
      return;
    }
    audioFile = file;
    audio.required = false;
    audioSelection.textContent = `已选择 ${file.name}`;
  }

  function showUpload(open) {
    add.hidden = !open;
    newButton.setAttribute('aria-expanded', String(open));
    dropEvents?.abort();
    if (open) {
      dropEvents = new AbortController();
      mountFileDrop(audioDrop, pickAudio, { signal: dropEvents.signal, enabled: () => !uploading });
      add.elements.title.focus();
    } else {
      audioFile = null;
      audio.required = true;
      add.reset();
      audioSelection.textContent = '单首音频不超过 25 MB。';
      audioSelection.dataset.error = 'false';
    }
  }

  function browse(id, origin) {
    if (id === browseId || uploading || sortSaving) return;
    showUpload(false);
    browseId = id;
    draw();
    const target = id ? [...folderList.children].find(row => row.dataset.id === id)?.querySelector('.bgm-folder-open') : origin;
    target?.focus({ preventScroll: true });
  }

  function closeFolderDialog() {
    if (!folderDialog.open) return;
    folderDialog.close();
    const target = folderOrigin?.isConnected ? folderOrigin
      : folderTools.querySelector(`[data-library="${folderOrigin?.dataset.library}"]`)
        ?? slot.querySelector('[data-library="browse-all"]');
    target?.focus({ preventScroll: true });
  }

  function openFolderDialog(action, origin) {
    const folder = browseFolder();
    const picker = action === 'choose-tracks';
    const deleting = action === 'delete-folder';
    const rename = action === 'rename-folder';
    const title = picker ? '从曲库添加' : deleting ? '删除文件夹' : rename ? '重命名文件夹' : '新建文件夹';
    const existing = picker ? allTracks().filter(track => !folder.track_ids.includes(track.id)) : [];
    const fields = picker ? (existing.length ? `<div class="bgm-folder-picker">${existing.map(track => `<label>
      <input type="checkbox" name="track" value="${esc(track.id)}" /><span>${esc(track.title)}${track.artist ? `<small>${esc(track.artist)}</small>` : ''}</span>
    </label>`).join('')}</div>` : '<p class="dialog-description">曲库中的曲目已经全部加入。</p>')
      : deleting ? `<p class="dialog-description">删除「${esc(folder.name)}」后，曲目仍保留在曲库。</p>`
        : `<label>文件夹名称<input name="name" value="${rename ? esc(folder.name) : ''}" maxlength="80" required /></label>`;
    folderOrigin = origin;
    folderDialog.innerHTML = `<h2 id="bgm-folder-dialog-title" tabindex="-1">${title}</h2>
      <button type="button" class="icon-button dialog-close" data-library="close-folder" aria-label="关闭文件夹窗口">${icon('close')}</button>
      <form data-folder-form="${action}" data-folder-id="${esc(folder?.id ?? '')}">${fields}
        <p class="bgm-feedback" role="status"></p><div class="dialog-footer">${folderButton('close-folder', '取消')}
        <button type="submit" class="${deleting ? 'secondary danger' : 'primary'}"${picker && !existing.length ? ' disabled' : ''}>
          ${picker ? '添加' : deleting ? '删除文件夹' : '保存'}</button></div></form>`;
    folderDialog.showModal();
    (folderDialog.querySelector(deleting ? '.dialog-footer [data-library="close-folder"]' : 'input') ?? folderDialog.querySelector('h2')).focus();
  }

  folderDialog?.addEventListener('submit', async event => {
    const form = event.target.closest('[data-folder-form]');
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    const { folderForm: action, folderId: id } = form.dataset;
    const fields = new FormData(form), name = fields.get('name')?.trim(), ids = fields.getAll('track');
    if ((action === 'new-folder' || action === 'rename-folder') && !name) { message('请填写文件夹名称。'); return; }
    if (action === 'choose-tracks' && !ids.length) { message('请选择曲目。'); return; }
    submit.disabled = true;
    message('');
    try {
      const result = await ({
        'new-folder': () => folders.create(name),
        'rename-folder': () => folders.rename(id, name),
        'delete-folder': () => folders.remove(id),
        'choose-tracks': () => folders.addTracks(id, ids),
      })[action]();
      if (result !== false && !signal.aborted && form.isConnected) closeFolderDialog();
    } catch (error) {
      if (!signal.aborted && form.isConnected) message(error.message || '文件夹暂时无法保存。');
    } finally { submit.disabled = false; }
  }, { signal });
  folderDialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeFolderDialog();
  }, { signal });

  async function detachTrack() {
    const track = editing;
    try {
      if (await folders.removeTrack(track.folderId, track.id) !== false && !signal.aborted && editing === track && dialog.open) dialog.close();
    } catch (error) {
      if (!signal.aborted && editing === track && dialog.open) message(error.message || '曲目暂时无法移出。');
    }
  }

  slot.addEventListener('click', event => {
    const button = event.target.closest('[data-library]');
    if (!button) return;
    const row = button.closest('li');
    const id = row?.dataset.id, trackScope = row?.dataset.owner;
    switch (button.dataset.library) {
      case 'new': if (!uploading) showUpload(add.hidden); break;
      case 'browse-all': browse(null, button); break;
      case 'browse-folder': browse(id, button); break;
      case 'play-folder': actions.folders.select(browseId); break;
      case 'new-folder': case 'choose-tracks': case 'rename-folder': case 'delete-folder':
        openFolderDialog(button.dataset.library, button); break;
      case 'close-folder': closeFolderDialog(); break;
      case 'select': actions.select(id, { scope: trackScope, folderId: browseId }); break;
      case 'edit': editing = { id, scope: trackScope, folderId: browseId }; showTrack(); dialog.showModal(); break;
      case 'close': dialog.close(); break;
      case 'unlyric': actions.removeLyrics(editing.id, { scope: editing.scope }); break;
      case 'remove': actions.remove(editing.id, { scope: editing.scope }); break;
      case 'detach-track': void detachTrack(); break;
    }
  }, { signal });
  audio.addEventListener('change', () => {
    if (audio.files.length) pickAudio([...audio.files]);
    audio.value = '';
  }, { signal });
  add.addEventListener('submit', async event => {
    event.preventDefault();
    if (uploading || !audioFile) return;
    const fields = new FormData(add);
    const submit = add.querySelector('[type="submit"]');
    uploading = true;
    submit.disabled = true;
    try {
      if (await actions.add(audioFile, fields.get('lyrics'), fields.get('title').trim(), fields.get('artist').trim(), { folderId: browseId })) showUpload(false);
    } catch (error) {
      if (!signal.aborted) message(error.message || '曲目暂时无法保存。');
    } finally { uploading = false; submit.disabled = false; }
  }, { signal });
  dialog.addEventListener('change', ({ target }) => {
    const file = target.files?.[0];
    if (file) { void actions.replace(editing.id, target.name, file, { scope: editing.scope }); target.value = ''; }
  }, { signal });

  async function reorder(kind, ids, folderId) {
    if (sortSaving) return;
    sortSaving = true;
    try {
      const result = await (kind === 'folder' ? folders.reorder(ids) : actions.reorder(ids, { scope, folderId }));
      if (result === false && !signal.aborted) draw();
    } catch (error) {
      if (!signal.aborted) { draw(); message(error.message || '顺序暂时无法保存。'); }
    } finally { sortSaving = false; }
  }

  function sortItems(container, kind) {
    return [...container.children].filter(row => kind === 'folder' || row.hasAttribute('data-sortable'));
  }

  function bindSortKeys(container, kind, handle) {
    container?.addEventListener('keydown', event => {
      if (sortSaving || dragging || !event.target.closest(handle) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const items = sortItems(container, kind), from = items.indexOf(event.target.closest('li'));
      const to = event.key === 'ArrowLeft' ? from - 1 : event.key === 'ArrowRight' ? from + 1 : adjacentRow(items, from, event.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to === from || to >= items.length) return;
      const ids = items.map(item => item.dataset.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      void reorder(kind, ids, browseId);
    }, { signal });
  }

  bindSortKeys(list, 'track', '.bgm-grip');
  bindSortKeys(folderList, 'folder', '.bgm-folder-grip');
  void loadLocalScript({ url: new URL('../assets/sortable-1.15.7.js', import.meta.url), read: () => globalThis.Sortable, label: '歌单排序组件' })
    .then(Sortable => {
      if (signal.aborted) return;
      function makeSortable(container, kind, handle, selector) {
        let folderId;
        return new Sortable(container, {
          handle, draggable: selector, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
          animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
          delay: 180, delayOnTouchOnly: true, ghostClass: 'bgm-sort-ghost',
          direction(_event, target, item) { return target && item && target.offsetTop === item.offsetTop ? 'horizontal' : 'vertical'; },
          onMove() { return !sortSaving; },
          onStart() { folderId = browseId; dragging = true; actions.setSorting(true); },
          onEnd(event) {
            const ids = sortItems(container, kind).map(item => item.dataset.id);
            dragging = false;
            actions.setSorting(false);
            if (event.oldDraggableIndex !== event.newDraggableIndex) void reorder(kind, ids, folderId);
            else if (redrawPending) draw();
            redrawPending = false;
          },
        });
      }
      sortable = makeSortable(list, 'track', '.bgm-grip', 'li[data-sortable]');
      if (folderList) folderSortable = makeSortable(folderList, 'folder', '.bgm-folder-grip', 'li');
    }).catch(() => {});

  return {
    render, message,
    destroy() { dropEvents?.abort(); events.abort(); sortable?.destroy(); folderSortable?.destroy(); actions.setSorting(false); },
  };
}
