export const BGM_BUCKET = 'memory-bgm';
export const BGM_MAX_BYTES = 25 * 1024 * 1024;
export const MUSIC_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const extensions = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' };
export const BGM_ACCEPT = Object.keys(extensions).map(ext => `.${ext}`).join(',');

export function audioFileType(file) {
  if (!file || !Number.isInteger(file.size) || file.size < 1 || file.size > BGM_MAX_BYTES) return '';
  const extension = extensions[file.name?.split('.').at(-1)?.toLowerCase()];
  if (extension && (!file.type || file.type === 'application/octet-stream' || file.type.startsWith('audio/'))) return extension;
  return Object.values(extensions).includes(file.type) ? file.type : '';
}

export function musicState(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.tracks)) throw new Error('歌单格式无法读取。');
  const seen = new Set();
  const tracks = value.tracks.map(track => {
    if (!track || !MUSIC_UUID.test(track.id) || seen.has(track.id) || typeof track.title !== 'string' || !track.title.trim()
      || typeof track.artist !== 'string' || (track.audio !== null && !MUSIC_UUID.test(track.audio))) throw new Error('歌单中有无法读取的曲目。');
    seen.add(track.id);
    return { id: track.id, title: track.title, artist: track.artist, audio: track.audio };
  });
  if (value.current_id !== null && !seen.has(value.current_id)) throw new Error('当前曲目无法读取。');
  return { revision: value.revision, current_id: value.current_id, tracks };
}
