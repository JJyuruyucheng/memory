export function musicFolders(provider, { signal, onChange, onMessage }) {
  let state, saving = false, sorting = false;

  function apply(next) {
    if (!next || signal.aborted || (state && next.revision <= state.revision)) return;
    state = next;
    onChange();
  }

  async function refresh() {
    if (signal.aborted || saving || sorting) return;
    try {
      const next = await provider.loadMusicFolders({ signal, revision: state?.revision });
      if (!saving && !sorting) apply(next);
    } catch {
      if (!state && !signal.aborted) onMessage('音乐文件夹暂时无法读取。');
    }
  }

  async function save(edit) {
    if (signal.aborted || saving || !state) return false;
    saving = true;
    onMessage('');
    try {
      const patch = edit(state);
      apply(await provider.saveMusicFolders({ ...state, ...patch }, state.revision));
      return !signal.aborted;
    } catch (error) {
      if (!signal.aborted) { onChange(); onMessage(error.message || '音乐文件夹暂时无法保存。'); }
      return false;
    } finally {
      saving = false;
      void refresh();
    }
  }

  function updateFolder(id, edit) {
    return save(current => {
      if (!current.folders.some(folder => folder.id === id)) throw new Error('文件夹已移除。');
      return { folders: current.folders.map(folder => folder.id === id ? edit(folder) : folder) };
    });
  }

  return {
    get state() { return state; },
    refresh, apply,
    setSorting(value) { sorting = value; },
    select(id, trackId) {
      if (state?.active_folder_id === id && state.current_id === trackId) return true;
      return save(() => ({ active_folder_id: id, current_id: trackId }));
    },
    async create(name) {
      const id = crypto.randomUUID();
      const saved = await save(({ folders }) => ({ folders: [...folders, { id, name, track_ids: [] }] }));
      return saved && id;
    },
    rename: (id, name) => updateFolder(id, folder => ({ ...folder, name })),
    remove: id => save(current => ({
      active_folder_id: current.active_folder_id === id ? null : current.active_folder_id,
      folders: current.folders.filter(folder => folder.id !== id),
    })),
    reorder(ids) {
      return save(({ folders }) => {
        const byId = new Map(folders.map(folder => [folder.id, folder]));
        if (folders.length !== ids.length || ids.some(id => !byId.has(id))) throw new Error('文件夹已更新，请重新排序。');
        return { folders: ids.map(id => byId.get(id)) };
      });
    },
    addTracks: (id, trackIds) => updateFolder(id, folder => ({
      ...folder, track_ids: [...new Set([...folder.track_ids, ...trackIds])],
    })),
    removeTrack: (id, trackId) => updateFolder(id, folder => ({
      ...folder, track_ids: folder.track_ids.filter(item => item !== trackId),
    })),
    reorderTracks: (id, trackIds) => updateFolder(id, folder => ({ ...folder, track_ids: trackIds })),
  };
}
