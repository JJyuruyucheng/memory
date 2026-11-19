import { BGM_ACCEPT } from './background-music-data.js';
import { escapeHtml as esc } from './domain.js';
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

export function mountMusicSettings(slot, actions) {
  const events = new AbortController(), { signal } = events;
  slot.innerHTML = `
    <div class="bgm-library-head"><h2>背景音乐</h2><span class="bgm-total"></span><button type="button" class="secondary" data-library="new" aria-expanded="false">${icon('plus')}添加音乐</button></div>
    <form class="bgm-upload" hidden>
      <label>曲名<input name="title" maxlength="80" placeholder="使用文件名" /></label>
      <label>演唱者<input name="artist" maxlength="80" /></label>
      <label>音频<input name="audio" type="file" accept="${BGM_ACCEPT}" required /></label>
      <label>LRC 歌词<input name="lyrics" type="file" accept=".lrc" /></label>
      <button class="primary" type="submit">保存曲目</button>
    </form>
    <ol class="bgm-sort-list" aria-label="共同歌单"></ol>
    <p class="bgm-feedback" role="status"></p>
    <dialog class="dialog bgm-edit-dialog" aria-labelledby="bgm-edit-title">
      <h2 id="bgm-edit-title">曲目设置</h2><button type="button" class="icon-button dialog-close" data-library="close" aria-label="关闭曲目设置">${icon('close')}</button>
      <div class="bgm-edit-files">
        <label class="bgm-file-label"><span>上传音源</span><input type="file" name="audio" accept="${BGM_ACCEPT}" /></label>
        <label class="bgm-file-label"><span>上传 LRC 歌词</span><input type="file" name="lyrics" accept=".lrc" /></label>
      </div>
      <div class="bgm-edit-actions"><button type="button" class="text-button" data-library="unlyric">移除歌词</button><button type="button" class="text-button danger" data-library="remove">删除曲目</button></div>
      <p class="bgm-feedback" role="status"></p>
    </dialog>`;
  const list = slot.querySelector('ol'), add = slot.querySelector('.bgm-upload'), dialog = slot.querySelector('dialog');
  const newButton = slot.querySelector('[data-library="new"]');
  let editing, state, sortable;

  function showTrack() {
    const track = state?.tracks.find(item => item.id === editing);
    if (!track) { dialog.close(); return; }
    dialog.querySelector('h2').textContent = track.title;
    dialog.querySelector('[name="audio"]').previousElementSibling.textContent = track.audio ? '更换音源' : '上传音源';
    dialog.querySelector('[name="lyrics"]').previousElementSibling.textContent = track.lyrics ? '更换 LRC 歌词' : '上传 LRC 歌词';
    dialog.querySelector('[data-library="unlyric"]').hidden = !track.lyrics;
  }

  function render(next) {
    const focusedTrack = list.contains(document.activeElement) && document.activeElement.classList.contains('bgm-grip')
      ? document.activeElement.closest('li').dataset.id : null;
    state = next;
    const tracks = state?.tracks ?? [];
    slot.querySelector('.bgm-total').textContent = state ? `${tracks.length} 首` : '正在读取歌单…';
    list.innerHTML = tracks.map(track => `<li data-id="${track.id}" class="bgm-track" data-current="${track.id === state.current_id}">
      <button type="button" class="bgm-grip" aria-label="调整${esc(track.title)}顺序" title="拖动排序">${icon('grip')}</button>
      <button type="button" class="bgm-track-main" data-library="select" aria-pressed="${track.id === state.current_id}" title="${esc(track.title)}">
        <strong>${esc(track.title)}</strong><small>${esc(track.artist || (track.audio ? '' : '待上传音源'))}</small></button>
      <button type="button" class="bgm-more" data-library="edit" aria-label="编辑${esc(track.title)}">${icon('more')}</button>
    </li>`).join('');
    if (focusedTrack) [...list.children].find(item => item.dataset.id === focusedTrack)?.querySelector('.bgm-grip').focus();
    if (dialog.open) showTrack();
  }
  slot.addEventListener('click', event => {
    const button = event.target.closest('[data-library]');
    if (!button) return;
    const id = button.closest('li')?.dataset.id;
    switch (button.dataset.library) {
      case 'new':
        add.hidden = !add.hidden; newButton.setAttribute('aria-expanded', String(!add.hidden));
        if (!add.hidden) add.elements.title.focus();
        break;
      case 'select': actions.select(id); break;
      case 'edit': editing = id; showTrack(); dialog.showModal(); break;
      case 'close': dialog.close(); break;
      case 'unlyric': actions.removeLyrics(editing); break;
      case 'remove': actions.remove(editing); break;
    }
  }, { signal });
  add.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = new FormData(add);
    if (await actions.add(fields.get('audio'), fields.get('lyrics'), fields.get('title').trim(), fields.get('artist').trim())) {
      add.reset(); add.hidden = true; newButton.setAttribute('aria-expanded', 'false');
    }
  }, { signal });
  dialog.addEventListener('change', ({ target }) => {
    const file = target.files?.[0];
    if (file) { void actions.replace(editing, target.name, file); target.value = ''; }
  }, { signal });
  const order = () => [...list.children].map(item => item.dataset.id);
  list.addEventListener('keydown', event => {
    if (!event.target.closest('.bgm-grip') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const items = [...list.children], ids = order(), from = items.indexOf(event.target.closest('li'));
    const to = event.key === 'ArrowLeft' ? from - 1 : event.key === 'ArrowRight' ? from + 1
      : adjacentRow(items, from, event.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < ids.length) { [ids[from], ids[to]] = [ids[to], ids[from]]; actions.reorder(ids); }
  }, { signal });
  void loadLocalScript({ url: new URL('../assets/sortable-1.15.7.js', import.meta.url), read: () => globalThis.Sortable, label: '歌单排序组件' })
    .then(Sortable => {
      if (signal.aborted) return;
      sortable = new Sortable(list, {
        handle: '.bgm-grip', draggable: 'li', forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
        delay: 180, delayOnTouchOnly: true, ghostClass: 'bgm-sort-ghost',
        onStart: () => actions.setSorting(true),
        onEnd(event) {
          actions.setSorting(false);
          if (event.oldIndex !== event.newIndex) actions.reorder(order());
        },
      });
    }).catch(() => {});
  return { render, message(text) {
    slot.querySelectorAll('.bgm-feedback').forEach(output => { output.textContent = dialog.contains(output) === dialog.open ? text : ''; });
  },
    destroy() { events.abort(); sortable?.destroy(); actions.setSorting(false); } };
}
