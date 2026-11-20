import { lyricText, musicFileType, parseLyrics } from './background-music-data.js';
import { mountMusicSettings } from './music-settings.js';

export function musicLibrary(provider, scope, { signal, onChange, onMessage }) {
  let state, slot, settings, working = false, sorting = false;
  const current = () => state?.tracks.find(track => track.id === state.current_id);

  function message(text) {
    settings?.message(text);
    onMessage(text);
  }

  function apply(next) {
    if (signal.aborted || (state && next.revision <= state.revision)) return;
    const previous = state;
    state = next;
    message('');
    settings?.render(state);
    onChange(state, previous);
  }

  async function refresh() {
    if (working || sorting || signal.aborted) return;
    try {
      const next = await provider.loadMusic({ signal, revision: state?.revision, scope });
      if (next && !working && !sorting) apply(next);
    } catch { if (!state && !signal.aborted) message('歌单暂时无法读取。'); }
  }

  async function change(edit) {
    if (!state || working || signal.aborted) return false;
    working = true; message('');
    try { await edit(); return true; }
    catch (error) {
      if (!signal.aborted) { settings?.render(state); message(error.message || '歌单暂时无法保存。'); }
      return false;
    } finally { working = false; void refresh(); }
  }

  const save = async changes => apply(await provider.saveMusic({ ...state, ...changes }, state.revision, { scope }));
  const drop = async ids => Promise.all(ids.filter(Boolean).map(id => provider.removeMusicFile(id).catch(() => {})));
  const select = id => state?.current_id !== id && state?.tracks.some(track => track.id === id)
    ? change(() => save({ current_id: id })) : false;

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
      if (!track || !window.confirm(`从歌单删除《${track.title}》？`)) return;
      void change(async () => {
        const tracks = state.tracks.filter(item => item.id !== id);
        const current_id = state.current_id === id ? (tracks.find(item => item.audio) || tracks[0])?.id ?? null : state.current_id;
        await save({ tracks, current_id });
        await drop([track.audio, track.lyrics]);
      });
    },
  };

  return {
    get state() { return state; },
    current, refresh, select,
    changeMode() {
      void change(() => save({ play_mode: state.play_mode === 'shuffle' ? 'sequence' : 'shuffle' }));
    },
    mountSettings(next) {
      if (slot === next) return;
      settings?.destroy();
      slot = next;
      settings = next ? mountMusicSettings(next, actions, { scope }) : null;
      if (settings) { settings.render(state); void refresh(); }
    },
    destroy() { settings?.destroy(); },
  };
}
