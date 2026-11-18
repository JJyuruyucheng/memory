import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { loadLocalScript } from './local-script.js';
import { audioFileType, BGM_ACCEPT } from './background-music-data.js';

const PLAY_PREF = 'chaoxi-bgm-playing';
const titleMarkup = track => `<strong>${esc(track.title)}</strong>${track.artist ? `<small>${esc(track.artist)}</small>` : ''}`;

export function mountBackgroundMusic(host, provider) {
  const events = new AbortController(), { signal } = events;
  host.innerHTML = `<div class="bgm-widget"><button type="button" class="bgm-trigger" aria-label="背景音乐" aria-expanded="false" aria-controls="bgm-panel">${icon('music')}</button>
    <section class="bgm-panel" id="bgm-panel" aria-label="背景音乐" hidden><header><strong>背景音乐</strong><button type="button" data-bgm="close" aria-label="关闭歌单">${icon('close')}</button></header>
    <div class="bgm-now"><span>正在读歌单…</span><button type="button" data-bgm="play" disabled>播放</button></div><ol></ol><p class="bgm-feedback" role="status"></p></section></div><audio preload="none" hidden></audio>`;
  const widget = host.querySelector('.bgm-widget'), trigger = widget.querySelector('.bgm-trigger'), panel = widget.querySelector('.bgm-panel');
  const audio = host.querySelector('audio'), panelList = panel.querySelector('ol'), now = panel.querySelector('.bgm-now span');
  const playButton = panel.querySelector('[data-bgm="play"]'), feedback = panel.querySelector('.bgm-feedback');
  let state, settings, sortable, working = false, sorting = false;
  let loading = false, loadedAudio = '', mediaVersion = 0, blobUrl, enabled = true;
  function message(text) {
    feedback.textContent = text;
    const settingsFeedback = settings?.querySelector('.bgm-feedback');
    if (settingsFeedback) settingsFeedback.textContent = text;
  }
  try { enabled = localStorage.getItem(PLAY_PREF) !== 'off'; } catch { /* Optional device preference. */ }

  function setEnabled(value) {
    enabled = value;
    try { localStorage.setItem(PLAY_PREF, value ? 'on' : 'off'); } catch { /* Keep preference in memory. */ }
  }

  function showPlayback() {
    playButton.textContent = audio.paused ? '播放' : '关闭音乐';
    playButton.disabled = loading || !state?.tracks.find(track => track.id === state.current_id)?.audio;
    trigger.classList.toggle('playing', !audio.paused);
  }

  async function play() {
    try { await audio.play(); message(''); }
    catch (error) { if (!signal.aborted && error.name !== 'AbortError') message(error.name === 'NotAllowedError' ? '点「播放」开启音乐。' : '这首音乐暂时无法播放。'); }
    showPlayback();
  }

  async function loadTrack() {
    const key = state?.tracks.find(track => track.id === state.current_id)?.audio || '';
    if (key === loadedAudio) return;
    const version = ++mediaVersion;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
    loadedAudio = key; loading = Boolean(key); showPlayback();
    if (!key) return;
    try {
      const blob = await provider.loadMusicFile(key, { signal });
      if (signal.aborted || version !== mediaVersion) return;
      blobUrl = URL.createObjectURL(blob);
      audio.src = blobUrl;
      if (enabled) await play();
    } catch { if (!signal.aborted && version === mediaVersion) { loadedAudio = ''; message('音乐加载失败，重新点播可重试。'); } }
    finally { if (version === mediaVersion) { loading = false; showPlayback(); } }
  }

  function render() {
    const tracks = state?.tracks || [], current = tracks.find(track => track.id === state?.current_id);
    now.textContent = current ? `${current.title}${current.audio ? '' : ' · 待添加音源'}` : '暂无曲目';
    panelList.innerHTML = tracks.map(track => `<li><button type="button" data-bgm="select" data-id="${track.id}" aria-pressed="${track.id === current?.id}">${titleMarkup(track)}${track.audio ? '' : '<small>待添加音源</small>'}</button></li>`).join('');
    if (settings) {
      const list = settings.querySelector('.bgm-sort-list');
      list.innerHTML = tracks.map(track => `<li data-id="${track.id}"><button class="bgm-grip" type="button" aria-label="调整${esc(track.title)}顺序">${icon('grip')}</button>
        <span>${titleMarkup(track)}</span><button type="button" class="text-button" data-bgm="select" data-id="${track.id}" aria-pressed="${track.id === current?.id}">${track.id === current?.id ? '当前' : '切换'}</button>
        <label class="bgm-file-label">${track.audio ? '换音源' : '补音源'}<input type="file" accept="${BGM_ACCEPT}" data-track="${track.id}" /></label>
        <button type="button" class="text-button" data-bgm="remove" data-id="${track.id}" aria-label="删除${esc(track.title)}">${icon('trash')}</button></li>`).join('');
    }
    showPlayback();
  }

  function apply(next) {
    if (signal.aborted || (state && next.revision <= state.revision)) return;
    state = next;
    render();
    void loadTrack();
  }

  async function refresh() {
    if (working || sorting || signal.aborted) return;
    try { const next = await provider.loadMusic({ signal, revision: state?.revision }); if (next && !sorting) apply(next); }
    catch { if (!state && !signal.aborted) message('歌单暂时无法读取。'); }
  }

  async function change(edit) {
    if (!state || working || signal.aborted) return;
    const version = state.revision;
    working = true;
    try { message(''); await edit(version); }
    catch (error) { if (!signal.aborted) message(error.message || '歌单暂时无法保存。'); }
    finally { working = false; if (!signal.aborted) { await refresh(); render(); } }
  }

  function reorder(ids) {
    void change(async version => {
      const tracks = ids.map(id => state.tracks.find(track => track.id === id));
      if (tracks.length !== state.tracks.length || tracks.some(track => !track)) return;
      apply(await provider.saveMusic({ ...state, tracks }, version));
    });
  }

  function select(id, start = false) {
    const track = state?.tracks.find(track => track.id === id);
    if (!track) return;
    if (start && track.audio) setEnabled(true);
    if (state.current_id === id) { if (start && track.audio) void (blobUrl ? play() : loadTrack()); return; }
    void change(async version => { apply(await provider.saveMusic({ ...state, current_id: id }, version)); });
  }

  function upload(file, targetId, title, artist) {
    const mime = audioFileType(file);
    if (!mime) { message('请选择 25 MB 以内的 MP3、M4A、AAC、OGG、WAV 或 FLAC。'); return; }
    void change(async version => {
      const existing = state.tracks.find(track => track.id === targetId);
      const id = existing?.id ?? crypto.randomUUID();
      const audioId = await provider.uploadMusicFile(file, mime);
      const track = { id, title: existing?.title ?? (title || file.name.replace(/\.[^.]+$/u, '') || '未命名曲目').trim().slice(0, 80),
        artist: existing?.artist ?? artist.trim().slice(0, 80), audio: audioId };
      const tracks = existing ? state.tracks.map(item => item.id === id ? track : item) : [...state.tracks, track];
      try {
        apply(await provider.saveMusic({ ...state, tracks, current_id: state.current_id ?? id }, version));
      } catch (error) {
        await provider.removeMusicFile(audioId).catch(() => {});
        throw error;
      }
      if (existing?.audio) await provider.removeMusicFile(existing.audio).catch(() => {});
    });
  }

  function action(event) {
    const button = event.target.closest('[data-bgm]');
    if (!button) return;
    const { bgm, id } = button.dataset;
    if (bgm === 'close') { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
    if (bgm === 'play') {
      if (audio.paused) { setEnabled(true); void (blobUrl ? play() : loadTrack()); }
      else { setEnabled(false); audio.pause(); }
    }
    if (bgm === 'select') select(id, panel.contains(button));
    if (bgm === 'remove') {
      const track = state?.tracks.find(item => item.id === id);
      if (!track || !window.confirm(`从共同歌单删除《${track.title}》？`)) return;
      void change(async version => {
        const tracks = state.tracks.filter(item => item.id !== id);
        const current_id = state.current_id === id ? (tracks.find(item => item.audio) || tracks[0])?.id ?? null : state.current_id;
        apply(await provider.saveMusic({ ...state, tracks, current_id }, version));
        if (track.audio) await provider.removeMusicFile(track.audio).catch(() => {});
      });
    }
  }

  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) void refresh();
  }, { signal });
  panel.addEventListener('click', action, { signal });
  audio.addEventListener('playing', showPlayback, { signal });
  audio.addEventListener('pause', showPlayback, { signal });
  audio.addEventListener('ended', () => {
    const tracks = state?.tracks.filter(track => track.audio) || [];
    const index = tracks.findIndex(track => track.id === state.current_id);
    if (enabled && index >= 0) {
      if (tracks.length === 1) { audio.currentTime = 0; void play(); }
      else select(tracks[(index + 1) % tracks.length].id, true);
    }
  }, { signal });
  const poll = setInterval(refresh, 5000);
  window.addEventListener('focus', refresh, { signal });
  void refresh();

  return {
    mountSettings(slot) {
      if (settings === slot) return;
      sortable?.destroy(); sortable = null;
      sorting = false;
      settings = slot;
      if (!slot) return;
      slot.innerHTML = `<ol class="bgm-sort-list" aria-label="背景音乐排序"></ol><form class="bgm-upload"><label>曲名<input name="title" maxlength="80" placeholder="使用文件名" /></label><label>演唱者<input name="artist" maxlength="80" /></label><label>音频文件<input name="file" type="file" accept="${BGM_ACCEPT}" required /></label><button class="secondary" type="submit">添加音乐</button></form><p class="bgm-feedback" role="status"></p>`;
      slot.addEventListener('click', action, { signal });
      slot.addEventListener('change', e => { if (e.target.dataset.track && e.target.files?.[0]) { upload(e.target.files[0], e.target.dataset.track, '', ''); e.target.value = ''; } }, { signal });
      slot.querySelector('form').addEventListener('submit', e => {
        e.preventDefault(); e.stopPropagation();
        const fields = new FormData(e.target);
        upload(fields.get('file'), '', fields.get('title').trim(), fields.get('artist'));
        e.target.reset();
      }, { signal });
      const list = slot.querySelector('ol');
      list.addEventListener('keydown', event => {
        if (!event.target.closest('.bgm-grip') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const ids = [...list.children].map(item => item.dataset.id), from = ids.indexOf(event.target.closest('li').dataset.id);
        const to = from + (event.key === 'ArrowUp' ? -1 : 1);
        if (to >= 0 && to < ids.length) { [ids[from], ids[to]] = [ids[to], ids[from]]; reorder(ids); }
      }, { signal });
      void loadLocalScript({ url: new URL('../assets/sortable-1.15.7.js', import.meta.url), read: () => globalThis.Sortable, label: '歌单排序组件' })
        .then(Sortable => {
          if (signal.aborted || settings !== slot) return;
          sortable = new Sortable(list, {
            handle: '.bgm-grip', draggable: 'li', forceFallback: true, fallbackTolerance: 4,
            animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
            delay: 180, delayOnTouchOnly: true, touchStartThreshold: 5, ghostClass: 'bgm-sort-ghost',
            onStart() { sorting = true; },
            onEnd(event) {
              sorting = false;
              if (event.oldIndex !== event.newIndex) reorder([...list.children].map(item => item.dataset.id));
            },
          });
        }).catch(() => {});
      render();
    },
    destroy() {
      events.abort(); clearInterval(poll); sortable?.destroy(); audio.pause(); audio.removeAttribute('src'); audio.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      host.replaceChildren();
    },
  };
}
