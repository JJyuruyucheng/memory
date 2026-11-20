import { mountFloatingPosition, placeAdjacent } from './assistant-position.js';
import { adjacentTrack, parseLyrics } from './background-music-data.js';
import { musicLibrary } from './background-music-library.js';
import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { mountMusicCaptions } from './music-captions.js';

function preference(name, value) {
  try {
    if (value !== undefined) localStorage.setItem(name, value ? 'on' : 'off');
    return localStorage.getItem(name);
  } catch { return null; }
}

const volumeKey = 'chaoxi-bgm-volume';
const defaultVolume = 60;
function savedVolume() {
  try {
    const value = localStorage.getItem(volumeKey);
    if (value !== null && /^\d{1,3}$/.test(value)) return Math.min(100, Number(value));
  } catch { /* The player still works when preferences cannot be stored. */ }
  return defaultVolume;
}

const control = (action, label, content, attrs = '') =>
  `<button type="button" data-bgm="${action}" aria-label="${label}" title="${label}" ${attrs}>${content}</button>`;

export function mountBackgroundMusic(host, provider, initialScope = 'site') {
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
      <label class="bgm-volume">
        <span>音量</span><input type="range" min="0" max="100" step="1" aria-label="音量">
        <span class="bgm-volume-value" aria-hidden="true"></span>
      </label>
      <p class="bgm-feedback" role="status"></p>
      <ol id="bgm-playlist" aria-label="播放列表" hidden></ol>
    </section>
    <audio preload="none" hidden></audio></div>`;

  const widget = host.firstElementChild, trigger = widget.querySelector('.bgm-trigger'), panel = widget.querySelector('.bgm-panel');
  const sparks = widget.querySelector('.bgm-sparks'), app = document.querySelector('#app');
  const audio = widget.querySelector('audio');
  const now = panel.querySelector('.bgm-now'), panelList = panel.querySelector('ol'), feedback = panel.querySelector('.bgm-feedback');
  const byAction = action => panel.querySelector(`[data-bgm="${action}"]`);
  const playButton = byAction('play');
  const volume = panel.querySelector('.bgm-volume input'), volumeValue = panel.querySelector('.bgm-volume-value');
  function setVolume(level) {
    const percent = `${level}%`;
    volume.value = level;
    volumeValue.textContent = percent;
    volume.setAttribute('aria-valuetext', percent);
    audio.volume = level / 100;
  }
  setVolume(savedVolume());
  volume.addEventListener('input', () => {
    const level = volume.valueAsNumber;
    setVolume(level);
    try { localStorage.setItem(volumeKey, String(level)); } catch { /* Keep the volume for this page. */ }
  }, { signal });
  const lyricPreference = 'chaoxi-bgm-lyrics';
  const playPreference = scope => scope === 'points' ? 'chaoxi-points-bgm-playing' : 'chaoxi-bgm-playing';
  let scope = initialScope, lyricsOn = preference(lyricPreference) === 'on';
  let blobUrl, loadedAudio, loading = false, mediaVersion = 0;
  let lyricsKey, lines = [], played = [];
  let captionSpace = 0;
  const positions = new Map();
  const libraries = new Map(['site', 'points'].map(key => [key, musicLibrary(provider, key, {
    signal,
    onMessage(text) { if (scope === key) message(text); },
    onChange(next, previous) {
      if (scope !== key) return;
      if (previous?.current_id && next.current_id !== previous.current_id) {
        if (played.at(-1) === next.current_id) played.pop();
        else played.push(previous.current_id);
      }
      render(); void loadTrack(); void readLyrics();
    },
  })]));
  const active = () => libraries.get(scope);
  const current = () => active().current();
  const enabled = () => preference(playPreference(scope)) !== 'off';
  const setEnabled = value => preference(playPreference(scope), value);
  const refresh = () => active().refresh();

  function message(value) {
    feedback.textContent = value;
  }

  const placePlayer = mountFloatingPosition(widget, trigger, {
    storageKey: 'chaoxi-bgm-position', initial: { x: 1, y: 0 }, half: true, avoidPlayer: false, signal,
    onLayout(frame) {
      const { left, right, x, y, width, height } = frame;
      const centerX = x + width / 2;
      sparks.style.left = `${centerX}px`;
      sparks.style.top = `${y + height / 2}px`;
      sparks.style.setProperty('--spark-side', centerX < (left + right) / 2 ? '1' : '-1');
      sparks.style.setProperty('--spark-rise', y < 0 ? '24px' : `-${Math.min(33, y + 10)}px`);
      if (!panel.hidden) placeAdjacent(panel, frame);
    },
  });
  function reserveLyrics(height) {
    if (captionSpace === height) return;
    captionSpace = height;
    const { body } = document;
    const hadRoom = body.classList.contains('has-bgm-layout');
    const needsRoom = height > 0;
    const top = hadRoom ? app.scrollTop : window.scrollY;
    body.classList.toggle('has-bgm-layout', needsRoom);
    body.style.setProperty('--bgm-caption-space', `${height}px`);
    if (hadRoom !== needsRoom) (needsRoom ? app : window).scrollTo({ top });
    window.dispatchEvent(new Event('chaoxi-layout-change'));
  }
  const panelSize = new ResizeObserver(placePlayer);
  panelSize.observe(panel);
  const caption = mountMusicCaptions(widget, audio, {
    onReserve: reserveLyrics,
    onControl(action) {
      if (action === 'close') setLyrics(false);
      else byAction(action).click();
    },
  }, signal);

  function openPanel(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    placePlayer();
    if (open) void refresh();
  }

  function showLyrics() {
    caption.render(lyricsOn ? lines : []);
  }

  function setLyrics(value) {
    lyricsOn = value;
    preference(lyricPreference, lyricsOn);
    byAction('lyrics').setAttribute('aria-pressed', String(lyricsOn));
    message(lyricsOn && !current()?.lyrics ? '这首还没有歌词。' : '');
    void readLyrics();
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
    caption.transport(playing, !playButton.disabled, (active().state?.tracks.length ?? 0) > 1);
  }

  async function play() {
    const version = mediaVersion;
    try { await audio.play(); if (version === mediaVersion) message(''); }
    catch (error) {
      if (!signal.aborted && version === mediaVersion && error.name !== 'AbortError') {
        message(error.name === 'NotAllowedError' ? '点播放开启声音。' : '这首音乐暂时无法播放。');
      }
    }
    showPlayback();
  }

  function clearTrack() {
    mediaVersion++;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
    loadedAudio = undefined;
    loading = false;
  }

  async function loadTrack() {
    const key = current()?.audio || '';
    if (key === loadedAudio) return;
    clearTrack();
    const version = mediaVersion;
    loadedAudio = key; loading = Boolean(key); showPlayback();
    if (!key) return;
    try {
      const blob = await provider.loadMusicFile(key, { signal });
      if (signal.aborted || version !== mediaVersion) return;
      blobUrl = URL.createObjectURL(blob);
      audio.src = blobUrl;
      const position = positions.get(scope);
      positions.delete(scope);
      if (position?.key === key && position.seconds > 0) audio.currentTime = position.seconds;
      if (enabled()) await play();
    } catch {
      if (!signal.aborted && version === mediaVersion) { loadedAudio = undefined; message('音源加载失败，点播放重试。'); }
    } finally {
      if (version === mediaVersion) { loading = false; showPlayback(); }
    }
  }

  function render() {
    const state = active().state;
    const currentTrack = current(), tracks = state?.tracks ?? [];
    trigger.setAttribute('aria-label', scope === 'points' ? '积分专属音乐' : '背景音乐');
    panelList.setAttribute('aria-label', scope === 'points' ? '积分歌单' : '播放列表');
    now.querySelector('strong').textContent = currentTrack?.title || (state ? '暂无曲目' : '正在读歌单…');
    now.querySelector('small').textContent = currentTrack ? currentTrack.audio ? currentTrack.artist : '待上传音源' : '';
    panelList.innerHTML = tracks.map(track => `<li><button type="button" data-bgm="select" data-id="${track.id}" aria-pressed="${track.id === state.current_id}">
      <strong>${esc(track.title)}</strong><small>${esc(track.audio ? track.artist : '待上传音源')}</small></button></li>`).join('');
    for (const action of ['previous', 'next']) byAction(action).disabled = tracks.length < 2;
    const shuffle = state?.play_mode === 'shuffle', mode = byAction('mode');
    mode.innerHTML = shuffle ? `随${icon('shuffle')}` : `顺${icon('repeat')}`;
    const label = shuffle ? '随机播放，点击切回顺序' : '顺序播放，点击切换随机';
    mode.setAttribute('aria-label', label); mode.title = label;
    byAction('lyrics').setAttribute('aria-pressed', String(lyricsOn));
    showPlayback();
  }

  function select(id) {
    const state = active().state, track = state?.tracks.find(item => item.id === id);
    if (!track) return;
    if (track.audio) setEnabled(true);
    if (state.current_id === id) { if (track.audio) void (blobUrl ? play() : loadTrack()); }
    else void active().select(id);
  }

  function step(direction, automatic = false) {
    const state = active().state;
    if (!state) return;
    const tracks = automatic ? state.tracks.filter(track => track.audio) : state.tracks;
    const previous = played.findLast(id => tracks.some(track => track.id === id && track.id !== state.current_id));
    const track = adjacentTrack(tracks, state.current_id, direction, state.play_mode === 'shuffle', previous);
    if (automatic && track?.id === state.current_id) { audio.currentTime = 0; void play(); }
    else if (track) void active().select(track.id);
  }

  trigger.addEventListener('click', () => openPanel(panel.hidden), { signal });
  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-bgm]');
    if (!button) return;
    switch (button.dataset.bgm) {
      case 'close': openPanel(false); trigger.focus(); break;
      case 'previous': step(-1); break;
      case 'next': step(1); break;
      case 'select': select(button.dataset.id); break;
      case 'play':
        if (audio.paused) { setEnabled(true); void (blobUrl ? play() : loadTrack()); }
        else { setEnabled(false); audio.pause(); }
        break;
      case 'mode': active().changeMode(); break;
      case 'list':
        panelList.hidden = !panelList.hidden; button.setAttribute('aria-expanded', String(!panelList.hidden)); placePlayer();
        break;
      case 'lyrics':
        setLyrics(!lyricsOn);
        break;
    }
  }, { signal });
  document.addEventListener('click', event => {
    if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) openPanel(false);
  }, { signal });
  for (const event of ['playing', 'pause', 'ended']) audio.addEventListener(event, showPlayback, { signal });
  audio.addEventListener('ended', () => { if (enabled()) step(1, true); }, { signal });
  document.addEventListener('click', event => {
    if (event.isTrusted && scope === 'points' && enabled() && feedback.textContent === '点播放开启声音。' && blobUrl && audio.paused) void play();
  }, { signal });
  const poll = setInterval(refresh, 5000);
  window.addEventListener('focus', refresh, { signal });
  render();
  void refresh();

  return {
    setScope(next) {
      if (scope === next) return;
      if (loadedAudio && blobUrl) positions.set(scope, { key: loadedAudio, seconds: audio.currentTime });
      scope = next;
      played = [];
      lyricsKey = undefined; lines = [];
      clearTrack(); showLyrics(); message(''); render();
      void loadTrack(); void readLyrics(); void refresh();
    },
    mountSettings(site, points) {
      libraries.get('site').mountSettings(site);
      libraries.get('points').mountSettings(points);
    },
    destroy() {
      events.abort(); panelSize.disconnect(); clearInterval(poll);
      for (const library of libraries.values()) library.destroy();
      clearTrack();
      host.replaceChildren();
      document.body.classList.remove('has-bgm-layout');
      document.body.style.removeProperty('--bgm-caption-space');
    },
  };
}
