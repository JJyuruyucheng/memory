import { mountFloatingPosition } from './assistant-position.js';
import { adjacentTrack, lyricText, musicFileType, parseLyrics } from './background-music-data.js';
import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { mountMusicSettings } from './music-settings.js';

function preference(name, value) {
  try {
    if (value !== undefined) localStorage.setItem(name, value ? 'on' : 'off');
    return localStorage.getItem(name);
  } catch { return null; }
}

const control = (action, label, content, attrs = '') =>
  `<button type="button" data-bgm="${action}" aria-label="${label}" title="${label}" ${attrs}>${content}</button>`;

export function mountBackgroundMusic(host, provider) {
  const events = new AbortController(), { signal } = events;
  host.innerHTML = `<div class="bgm-widget" data-ui>
    <button type="button" class="bgm-trigger" aria-label="背景音乐" aria-expanded="false" aria-controls="bgm-panel">${icon('music')}</button>
    <span class="bgm-sparks" aria-hidden="true"><i>♪</i><i>♫</i><i>♪</i><i>♫</i><i>♪</i></span>
    <section class="bgm-panel" id="bgm-panel" aria-label="音乐播放器" hidden>
      <div class="bgm-controls">
        <div class="bgm-now"><strong>正在读歌单…</strong><small></small></div>
        <div class="bgm-transport">${control('previous', '上一首', icon('previous'), 'disabled')}${control('play', '播放', icon('play'), 'disabled')}${control('next', '下一首', icon('next'), 'disabled')}</div>
        <div class="bgm-switches">${control('lyrics', '歌词', '词', 'aria-pressed="false"')}${control('list', '歌单', '列', 'aria-expanded="false" aria-controls="bgm-playlist"')}${control('mode', '顺序播放', `顺${icon('repeat')}`)}</div>
        ${control('close', '关闭播放器', icon('close'))}
      </div>
      <p class="bgm-feedback" role="status"></p>
      <ol id="bgm-playlist" aria-label="播放列表" hidden></ol>
    </section>
    <div class="bgm-lyrics" aria-label="当前歌词" hidden><span></span></div>
    <audio preload="none" hidden></audio></div>`;

  const widget = host.firstElementChild, trigger = widget.querySelector('.bgm-trigger'), panel = widget.querySelector('.bgm-panel');
  const sparks = widget.querySelector('.bgm-sparks'), app = document.querySelector('#app');
  const audio = widget.querySelector('audio'), captions = widget.querySelector('.bgm-lyrics');
  const now = panel.querySelector('.bgm-now'), panelList = panel.querySelector('ol'), feedback = panel.querySelector('.bgm-feedback');
  const byAction = action => panel.querySelector(`[data-bgm="${action}"]`);
  const playButton = byAction('play');
  const playPreference = 'chaoxi-bgm-playing', lyricPreference = 'chaoxi-bgm-lyrics';
  let enabled = preference(playPreference) !== 'off', lyricsOn = preference(lyricPreference) === 'on';
  let state, slot, library, working = false, sorting = false, blobUrl, loadedAudio, loading = false, mediaVersion = 0;
  let lyricsKey, lines = [], played = [];
  const current = () => state?.tracks.find(track => track.id === state.current_id);

  function message(value) {
    feedback.textContent = value;
    library?.message(value);
  }

  mountFloatingPosition(widget, trigger, {
    storageKey: 'chaoxi-bgm-position', initial: { x: 1, y: 0 }, half: true, signal,
    onLayout({ left, right, x, y, width, height }) {
      const centerX = x + width / 2;
      sparks.style.left = `${centerX}px`;
      sparks.style.top = `${y + height / 2}px`;
      sparks.style.setProperty('--spark-side', centerX < (left + right) / 2 ? '1' : '-1');
      sparks.style.setProperty('--spark-rise', y < 0 ? '24px' : `-${Math.min(33, y + 10)}px`);
    },
  });
  function updateLayout() {
    const { body } = document;
    const height = panel.hidden ? 0 : Math.ceil(panel.getBoundingClientRect().bottom);
    const hadRoom = body.classList.contains('has-bgm-layout');
    const needsRoom = height > 0 || !captions.hidden;
    const top = hadRoom ? app.scrollTop : window.scrollY;
    body.classList.toggle('has-bgm-layout', needsRoom);
    body.classList.toggle('has-bgm-lyrics', !captions.hidden);
    body.style.setProperty('--bgm-panel-space', `${height}px`);
    if (hadRoom !== needsRoom) (needsRoom ? app : window).scrollTo({ top });
    window.dispatchEvent(new Event('chaoxi-layout-change'));
  }
  const panelSize = new ResizeObserver(updateLayout);
  panelSize.observe(panel);

  function openPanel(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    updateLayout();
    if (open) void refresh();
  }

  function showLyrics() {
    const visible = lyricsOn && lines.length > 0;
    if (visible === captions.hidden) {
      captions.hidden = !visible;
      updateLayout();
    }
    if (visible) captions.firstElementChild.textContent = lines.findLast(line => line.time <= audio.currentTime)?.text || '';
  }

  async function readLyrics() {
    if (!lyricsOn) { showLyrics(); return; }
    const key = current()?.lyrics;
    if (key === lyricsKey) { showLyrics(); return; }
    lyricsKey = key; lines = []; showLyrics();
    if (!key) return;
    try {
      const blob = await provider.loadMusicFile(key, { signal });
      const lyrics = parseLyrics(await blob.text());
      if (!signal.aborted && lyricsKey === key) { lines = lyrics; showLyrics(); }
    } catch {
      if (!signal.aborted && lyricsKey === key) { lyricsKey = undefined; message('歌词暂时无法读取。'); }
    }
  }

  function showPlayback() {
    const playing = !audio.paused && !audio.ended;
    const label = playing ? '关闭音乐' : '播放';
    playButton.innerHTML = icon(playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', label);
    playButton.title = label;
    playButton.disabled = loading || !current()?.audio;
    widget.classList.toggle('is-playing', playing);
  }

  async function play() {
    try { await audio.play(); message(''); }
    catch (error) {
      if (!signal.aborted && error.name !== 'AbortError') message(error.name === 'NotAllowedError' ? '点播放开启声音。' : '这首音乐暂时无法播放。');
    }
    showPlayback();
  }

  async function loadTrack() {
    const key = current()?.audio || '';
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
    } catch {
      if (!signal.aborted && version === mediaVersion) { loadedAudio = undefined; message('音源加载失败，点播放重试。'); }
    } finally {
      if (version === mediaVersion) { loading = false; showPlayback(); }
    }
  }

  function render() {
    const currentTrack = current(), tracks = state?.tracks ?? [];
    now.querySelector('strong').textContent = currentTrack?.title || '暂无曲目';
    now.querySelector('small').textContent = currentTrack ? currentTrack.audio ? currentTrack.artist : '待上传音源' : '';
    panelList.innerHTML = tracks.map(track => `<li><button type="button" data-bgm="select" data-id="${track.id}" aria-pressed="${track.id === state.current_id}">
      <strong>${esc(track.title)}</strong><small>${esc(track.audio ? track.artist : '待上传音源')}</small></button></li>`).join('');
    for (const action of ['previous', 'next']) byAction(action).disabled = tracks.length < 2;
    const shuffle = state?.play_mode === 'shuffle', mode = byAction('mode');
    mode.innerHTML = shuffle ? `随${icon('shuffle')}` : `顺${icon('repeat')}`;
    const label = shuffle ? '随机播放，点击切回顺序' : '顺序播放，点击切换随机';
    mode.setAttribute('aria-label', label); mode.title = label;
    byAction('lyrics').setAttribute('aria-pressed', String(lyricsOn));
    library?.render(state);
    showPlayback();
  }

  function apply(next) {
    if (signal.aborted || (state && next.revision <= state.revision)) return;
    if (state?.current_id && next.current_id !== state.current_id) {
      if (played.at(-1) === next.current_id) played.pop();
      else played.push(state.current_id);
    }
    state = next;
    if (feedback.textContent) message('');
    render();
    void loadTrack();
    void readLyrics();
  }

  async function refresh() {
    if (working || sorting || signal.aborted) return;
    try {
      const next = await provider.loadMusic({ signal, revision: state?.revision });
      if (next && !sorting) apply(next);
    } catch { if (!state && !signal.aborted) message('歌单暂时无法读取。'); }
  }

  async function change(edit) {
    if (!state || working || signal.aborted) return false;
    working = true; message('');
    try { await edit(); return true; }
    catch (error) {
      if (!signal.aborted) { library?.render(state); message(error.message || '歌单暂时无法保存。'); }
      return false;
    } finally { working = false; void refresh(); }
  }

  const save = async changes => apply(await provider.saveMusic({ ...state, ...changes }, state.revision));
  const drop = async ids => Promise.all(ids.filter(Boolean).map(id => provider.removeMusicFile(id).catch(() => {})));
  const setEnabled = value => { enabled = value; preference(playPreference, value); };

  function select(id, start = false) {
    const track = state?.tracks.find(item => item.id === id);
    if (!track) return;
    if (start && track.audio) setEnabled(true);
    if (state.current_id === id) { if (start && track.audio) void (blobUrl ? play() : loadTrack()); }
    else void change(() => save({ current_id: id }));
  }

  function step(direction, automatic = false) {
    if (!state) return;
    const tracks = automatic ? state.tracks.filter(track => track.audio) : state.tracks;
    const previous = played.findLast(id => tracks.some(track => track.id === id && track.id !== state.current_id));
    const track = adjacentTrack(tracks, state.current_id, direction, state.play_mode === 'shuffle', previous);
    if (automatic && track?.id === state.current_id) { audio.currentTime = 0; void play(); }
    else if (track) select(track.id);
  }

  function editTrack(id, { title, artist, audio: audioFile, lyrics: lyricFile }) {
    return change(async () => {
      const existing = state.tracks.find(track => track.id === id);
      const track = existing ? { ...existing } : {
        id: crypto.randomUUID(), title: (title || audioFile.name.replace(/\.[^.]+$/u, '') || '未命名曲目').slice(0, 80), artist, audio: null,
      };
      const uploaded = [], replaced = [];
      try {
        for (const [field, file] of [['audio', audioFile], ['lyrics', lyricFile]]) {
          if (!file?.size) continue;
          const mime = musicFileType(file);
          if (field === 'audio' && !mime.startsWith('audio/')) throw new Error('请选择 25 MB 以内的音频。');
          let body = file;
          if (field === 'lyrics') {
            if (mime !== 'text/plain') throw new Error('请选择 64 KB 以内的 LRC 歌词。');
            const text = await lyricText(file);
            if (!parseLyrics(text).length) throw new Error('歌词需要包含时间标记。');
            body = new File([text], file.name, { type: mime });
          }
          replaced.push(track[field]);
          track[field] = await provider.uploadMusicFile(body, mime);
          uploaded.push(track[field]);
        }
        const tracks = existing ? state.tracks.map(item => item.id === id ? track : item) : [...state.tracks, track];
        await save({ tracks, current_id: state.current_id ?? track.id });
      } catch (error) { await drop(uploaded); throw error; }
      await drop(replaced);
    });
  }

  const actions = {
    select,
    add: (audio, lyrics, title, artist) => editTrack(null, { audio, lyrics, title, artist }),
    async replace(id, field, file) {
      if (await editTrack(id, { [field]: file })) message(field === 'lyrics' ? '歌词已保存。' : '音源已保存。');
    },
    setSorting(value) { sorting = value; },
    reorder(ids) {
      void change(() => save({ tracks: ids.map(id => state.tracks.find(track => track.id === id)) }));
    },
    removeLyrics(id) {
      void change(async () => {
        const { lyrics, ...rest } = state.tracks.find(track => track.id === id);
        await save({ tracks: state.tracks.map(track => track.id === id ? rest : track) });
        await drop([lyrics]);
      });
    },
    remove(id) {
      const track = state?.tracks.find(item => item.id === id);
      if (!track || !window.confirm(`从共同歌单删除《${track.title}》？`)) return;
      void change(async () => {
        const tracks = state.tracks.filter(item => item.id !== id);
        const current_id = state.current_id === id ? (tracks.find(item => item.audio) || tracks[0])?.id ?? null : state.current_id;
        await save({ tracks, current_id });
        await drop([track.audio, track.lyrics]);
      });
    },
  };

  trigger.addEventListener('click', () => openPanel(panel.hidden), { signal });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-bgm]');
    if (!button) return;
    switch (button.dataset.bgm) {
      case 'close': openPanel(false); trigger.focus(); break;
      case 'previous': step(-1); break;
      case 'next': step(1); break;
      case 'select': select(button.dataset.id, true); break;
      case 'play':
        if (audio.paused) { setEnabled(true); void (blobUrl ? play() : loadTrack()); }
        else { setEnabled(false); audio.pause(); }
        break;
      case 'mode':
        void change(() => save({ play_mode: state.play_mode === 'shuffle' ? 'sequence' : 'shuffle' }));
        break;
      case 'list':
        panelList.hidden = !panelList.hidden; button.setAttribute('aria-expanded', String(!panelList.hidden)); updateLayout();
        break;
      case 'lyrics':
        lyricsOn = !lyricsOn; preference(lyricPreference, lyricsOn);
        button.setAttribute('aria-pressed', String(lyricsOn));
        message(lyricsOn && !current()?.lyrics ? '这首还没有歌词。' : '');
        void readLyrics();
        break;
    }
  }, { signal });
  document.addEventListener('click', event => {
    if (!panel.hidden && !widget.contains(event.target)) openPanel(false);
  }, { signal });
  for (const event of ['playing', 'pause', 'ended']) audio.addEventListener(event, showPlayback, { signal });
  for (const event of ['timeupdate', 'seeked']) audio.addEventListener(event, showLyrics, { signal });
  audio.addEventListener('ended', () => { if (enabled) step(1, true); }, { signal });
  const poll = setInterval(refresh, 5000);
  window.addEventListener('focus', refresh, { signal });
  void refresh();

  return {
    mountSettings(next) {
      if (slot === next) return;
      library?.destroy(); slot = next;
      library = slot ? mountMusicSettings(slot, actions) : null;
      library?.render(state);
    },
    destroy() {
      events.abort(); panelSize.disconnect(); clearInterval(poll); library?.destroy(); audio.pause(); audio.removeAttribute('src'); audio.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      host.replaceChildren();
      document.body.classList.remove('has-bgm-layout', 'has-bgm-lyrics');
      document.body.style.removeProperty('--bgm-panel-space');
    },
  };
}
