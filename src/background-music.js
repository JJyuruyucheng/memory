import { mountFloatingPosition, placeAdjacent } from './assistant-position.js';
import { adjacentTrack, parseLyrics, siteMusicQueue } from './background-music-data.js';
import { musicLibrary } from './background-music-library.js';
import { musicFolders } from './background-music-folders.js';
import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { mountMusicCaptions } from './music-captions.js';
import { mountMusicPlayerResize } from './music-player-resize.js';
import { mountMusicSettings } from './music-settings.js';

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
        <div class="bgm-switches">${control('lyrics', '歌词', '词', 'aria-pressed="false"')}${control('list', '歌单', '列', 'aria-expanded="false" aria-controls="bgm-list-area"')}${control('volume', '调节音量', '音', 'aria-expanded="false" aria-controls="bgm-volume"')}${control('mode', '顺序播放', `顺${icon('repeat')}`)}</div>
        ${control('close', '关闭播放器', icon('close'))}
      </div>
      <label class="bgm-volume" id="bgm-volume" hidden>
        <span>音量</span><input type="range" min="0" max="100" step="1" aria-label="音量">
        <span class="bgm-volume-value" aria-hidden="true"></span>
      </label>
      <p class="bgm-feedback" role="status"></p>
      <div id="bgm-list-area" hidden>
        <label class="bgm-queue"><span>播放</span><select aria-label="播放文件夹"></select></label>
        <ol id="bgm-playlist" aria-label="播放列表"></ol>
      </div>
    </section>
    <audio preload="none" hidden></audio></div>`;

  const widget = host.firstElementChild, trigger = widget.querySelector('.bgm-trigger'), panel = widget.querySelector('.bgm-panel');
  const sparks = widget.querySelector('.bgm-sparks'), app = document.querySelector('#app');
  const audio = widget.querySelector('audio');
  const now = panel.querySelector('.bgm-now'), panelList = panel.querySelector('ol'), feedback = panel.querySelector('.bgm-feedback');
  const listArea = panel.querySelector('#bgm-list-area'), queueLabel = panel.querySelector('.bgm-queue'), folderChoice = queueLabel.querySelector('select');
  const byAction = action => panel.querySelector(`[data-bgm="${action}"]`);
  const playButton = byAction('play');
  const volumeRow = panel.querySelector('.bgm-volume'), volume = volumeRow.querySelector('input'), volumeValue = panel.querySelector('.bgm-volume-value');
  function openVolume(open) {
    volumeRow.hidden = !open;
    byAction('volume').setAttribute('aria-expanded', String(open));
  }
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
  let queue, siteSlot, pointsSlot, siteSettings, pointsSettings;
  const positions = new Map();
  const libraries = Object.fromEntries(['site', 'points'].map(key => [key, musicLibrary(provider, key, {
    signal, onChange: updateLibraries,
    onFolderSaved: state => folders.apply(state),
    onMessage(text) {
      siteSettings?.message(text);
      if (key === 'points') pointsSettings?.message(text);
      if (scope === key) message(text);
    },
  })]));
  const folders = musicFolders(provider, {
    signal, onChange: updateLibraries,
    onMessage(text) { siteSettings?.message(text); if (scope === 'site') message(text); },
  });
  const siteQueue = (folderState = folders.state) => siteMusicQueue(libraries.site.state, libraries.points.state, folderState);
  const current = () => queue?.tracks.find(track => track.id === queue.current_id);
  const enabled = () => preference(playPreference(scope)) !== 'off';
  const setEnabled = value => preference(playPreference(scope), value);
  const refresh = () => scope === 'points' ? libraries.points.refresh()
    : Promise.all([libraries.site.refresh(), libraries.points.refresh(), folders.refresh()]);

  function message(value) {
    feedback.textContent = value;
  }

  function updateLibraries() {
    siteSettings?.render(libraries.site.state, { folderState: folders.state, pointsState: libraries.points.state });
    pointsSettings?.render(libraries.points.state);
    updatePlayback();
  }

  function updatePlayback() {
    const previous = queue;
    if (scope === 'site') queue = libraries.site.state ? { ...siteQueue(), folderId: folders.state?.active_folder_id ?? null } : undefined;
    else queue = libraries.points.state;
    if (previous?.folderId !== queue?.folderId) played = [];
    else if (previous?.current_id && queue?.current_id && previous.current_id !== queue.current_id) {
      if (played.at(-1) === queue.current_id) played.pop();
      else played.push(previous.current_id);
    }
    render(); void loadTrack(); void readLyrics();
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
  mountMusicPlayerResize(widget, trigger, placePlayer, signal);
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
    if (!open) openVolume(false);
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
    caption.transport(playing, !playButton.disabled, (queue?.tracks.length ?? 0) > 1);
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
    const currentTrack = current(), tracks = queue?.tracks ?? [];
    trigger.setAttribute('aria-label', scope === 'points' ? '积分专属音乐' : '背景音乐');
    panelList.setAttribute('aria-label', scope === 'points' ? '积分歌单' : '播放列表');
    now.querySelector('strong').textContent = currentTrack?.title || (queue ? '暂无曲目' : '正在读歌单…');
    now.querySelector('small').textContent = currentTrack ? currentTrack.audio ? currentTrack.artist : '待上传音源' : '';
    queueLabel.hidden = scope !== 'site' || !folders.state;
    folderChoice.innerHTML = '<option value="">全部歌曲</option>' + (folders.state?.folders ?? [])
      .map(folder => `<option value="${esc(folder.id)}">${esc(folder.name)}</option>`).join('');
    folderChoice.value = queue?.folderId || '';
    panelList.innerHTML = tracks.map(track => `<li><button type="button" data-bgm="select" data-id="${track.id}" aria-pressed="${track.id === queue.current_id}">
      <strong>${esc(track.title)}</strong><small>${esc(track.audio ? track.artist : '待上传音源')}</small></button></li>`).join('');
    for (const action of ['previous', 'next']) byAction(action).disabled = tracks.length < 2;
    const shuffle = queue?.play_mode === 'shuffle', mode = byAction('mode');
    mode.innerHTML = shuffle ? `随${icon('shuffle')}` : `顺${icon('repeat')}`;
    const label = shuffle ? '随机播放，点击切回顺序' : '顺序播放，点击切换随机';
    mode.setAttribute('aria-label', label); mode.title = label;
    byAction('lyrics').setAttribute('aria-pressed', String(lyricsOn));
    showPlayback();
  }

  function playSelected() {
    if (current()?.audio && audio.paused && !loading) void (blobUrl ? play() : loadTrack());
  }

  async function selectSite(folderId, trackId, start = false) {
    const candidate = siteQueue({ folders: folders.state?.folders ?? [], active_folder_id: folderId, current_id: trackId });
    if (trackId && !candidate.tracks.some(track => track.id === trackId)) return false;
    if (start && scope === 'site') setEnabled(true);
    const chosen = candidate.current_id;
    const saved = folders.state ? await folders.select(folderId, chosen)
      : chosen === libraries.site.state?.current_id || await libraries.site.select(chosen);
    if (saved && start && scope === 'site') playSelected();
    return saved;
  }

  function select(id) {
    const track = queue?.tracks.find(item => item.id === id);
    if (!track) return;
    if (scope === 'site') { void selectSite(queue.folderId, id, Boolean(track.audio)); return; }
    if (track.audio) setEnabled(true);
    if (queue.current_id === id) { if (track.audio) playSelected(); }
    else void libraries.points.select(id);
  }

  function step(direction, automatic = false) {
    if (!queue) return;
    const tracks = automatic ? queue.tracks.filter(track => track.audio) : queue.tracks;
    const previous = played.findLast(id => tracks.some(track => track.id === id && track.id !== queue.current_id));
    const track = adjacentTrack(tracks, queue.current_id, direction, queue.play_mode === 'shuffle', previous);
    if (automatic && track?.id === queue.current_id) { audio.currentTime = 0; void play(); }
    else if (track) {
      if (scope === 'site') void selectSite(queue.folderId, track.id);
      else void libraries.points.select(track.id);
    }
  }

  const siteActions = {
    folders: {
      select: id => selectSite(id, null, true), create: folders.create, rename: folders.rename,
      remove: folders.remove, reorder: folders.reorder, addTracks: folders.addTracks, removeTrack: folders.removeTrack,
    },
    select: (id, { folderId = null } = {}) => selectSite(folderId, id, true),
    add(audio, lyrics, title, artist, { folderId } = {}) {
      if (folderId && !folders.state) return false;
      return libraries.site.actions.add(audio, lyrics, title, artist,
        folderId ? { id: folderId, revision: folders.state.revision } : undefined);
    },
    replace: (id, field, file, { scope = 'site' } = {}) => libraries[scope].actions.replace(id, field, file),
    removeLyrics: (id, { scope = 'site' } = {}) => libraries[scope].actions.removeLyrics(id),
    remove: (id, { scope = 'site' } = {}) => libraries[scope].actions.remove(id),
    reorder(ids, { folderId } = {}) {
      return folderId ? folders.reorderTracks(folderId, ids) : libraries.site.actions.reorder(ids);
    },
    setSorting(value) {
      folders.setSorting(value);
      libraries.site.actions.setSorting(value);
      libraries.points.actions.setSorting(value);
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
      case 'select': select(button.dataset.id); break;
      case 'play':
        if (audio.paused) { setEnabled(true); void (blobUrl ? play() : loadTrack()); }
        else { setEnabled(false); audio.pause(); }
        break;
      case 'mode': libraries[scope].changeMode(); break;
      case 'list':
        listArea.hidden = !listArea.hidden; button.setAttribute('aria-expanded', String(!listArea.hidden)); placePlayer();
        break;
      case 'volume':
        openVolume(volumeRow.hidden);
        if (!volumeRow.hidden) volume.focus({ preventScroll: true });
        placePlayer();
        break;
      case 'lyrics':
        setLyrics(!lyricsOn);
        break;
    }
  }, { signal });
  folderChoice.addEventListener('change', async () => {
    const folderId = folderChoice.value || null;
    folderChoice.disabled = true;
    try {
      if (!await selectSite(folderId, null, true)) folderChoice.value = queue?.folderId || '';
    } finally { folderChoice.disabled = false; }
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
      clearTrack(); showLyrics(); message('');
      queue = undefined; updatePlayback(); void refresh();
    },
    mountSettings(site, points) {
      if (siteSlot !== site) {
        siteSettings?.destroy(); siteSlot = site;
        siteSettings = site ? mountMusicSettings(site, siteActions, { scope: 'site' }) : null;
        if (siteSettings) {
          siteSettings.render(libraries.site.state, { folderState: folders.state, pointsState: libraries.points.state });
          void refresh();
        }
      }
      if (pointsSlot !== points) {
        pointsSettings?.destroy(); pointsSlot = points;
        pointsSettings = points ? mountMusicSettings(points, libraries.points.actions, { scope: 'points' }) : null;
        if (pointsSettings) pointsSettings.render(libraries.points.state);
      }
    },
    destroy() {
      events.abort(); panelSize.disconnect(); clearInterval(poll);
      siteSettings?.destroy(); pointsSettings?.destroy();
      clearTrack();
      host.replaceChildren();
      document.body.classList.remove('has-bgm-layout');
      document.body.style.removeProperty('--bgm-caption-space');
    },
  };
}
