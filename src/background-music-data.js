export const BGM_BUCKET = 'memory-bgm';
export const BGM_MAX_BYTES = 25 * 1024 * 1024;
export const MUSIC_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const extensions = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' };
export const BGM_ACCEPT = Object.keys(extensions).map(ext => `.${ext}`).join(',');
export const LYRICS_MAX_BYTES = 64 * 1024;

export function audioFileType(file) {
  if (!file || !Number.isInteger(file.size) || file.size < 1 || file.size > BGM_MAX_BYTES) return '';
  const extension = extensions[file.name?.split('.').at(-1)?.toLowerCase()];
  if (extension && (!file.type || file.type === 'application/octet-stream' || file.type.startsWith('audio/'))) return extension;
  return Object.values(extensions).includes(file.type) ? file.type : '';
}

export function musicFileType(file) {
  if (/\.lrc$/i.test(file?.name || '') && file.size > 0 && file.size <= LYRICS_MAX_BYTES) return 'text/plain';
  return audioFileType(file);
}

export async function lyricText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

const clock = String.raw`\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?`;
const tag = `\\[(${clock})\\]`;
const lineStart = new RegExp(`^(?:${tag}\\s*)+`);
const lineStamp = new RegExp(tag, 'g');
const wordStamp = new RegExp(`<(${clock})>|${tag}`, 'g');
const splitWords = new Intl.Segmenter('zh', { granularity: 'word' });

function seconds(stamp) {
  const [minutes, seconds, fraction = 0] = stamp.split(/[.:]/);
  return Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`);
}

function timedWords(text, start) {
  const markers = [...text.matchAll(wordStamp)];
  if (!markers.length) return [];
  let from = 0, time = start;
  const words = [];
  for (const marker of markers) {
    const end = seconds(marker[1] ?? marker[2]);
    if (marker.index > from) words.push({ text: text.slice(from, marker.index), time, end });
    time = end;
    from = marker.index + marker[0].length;
  }
  if (text.length > from) words.push({ text: text.slice(from), time });
  return words;
}

export function parseLyrics(content) {
  const offset = Number(content.match(/^\s*\[offset:\s*([+-]?\d+)\]/mi)?.[1] ?? 0) / 1000;
  return content.split(/\r?\n/).flatMap(line => {
    line = line.trimStart();
    const prefix = line.match(lineStart)?.[0];
    if (!prefix) return [];
    const source = line.slice(prefix.length).trim(), text = source.replace(wordStamp, '').trim();
    if (!text) return [];
    const starts = Array.from(prefix.matchAll(lineStamp), ([, stamp]) => seconds(stamp));
    const words = timedWords(source, starts[0]);
    return starts.map(start => {
      const result = { time: Math.max(0, start + offset), text };
      if (words.length) {
        const shift = start - starts[0] + offset;
        result.words = words.map(({ text, time, end }) => ({
          text, time: Math.max(0, time + shift), ...(end === undefined ? {} : { end: Math.max(0, end + shift) }),
        }));
      }
      return result;
    });
  }).sort((a, b) => a.time - b.time);
}

export function lyricParts(line, nextTime, duration) {
  const count = [...line.text].length;
  const estimatedEnd = line.time + Math.min(8, Math.max(2, count * .28));
  const end = nextTime > line.time ? nextTime : duration > line.time ? Math.min(duration, estimatedEnd) : estimatedEnd;
  if (line.words) return line.words.map(word => ({ ...word, end: word.end ?? Math.max(word.time + .3, end) }));
  let cursor = 0;
  return [...splitWords.segment(line.text)].map(({ segment: text }) => {
    const time = line.time + cursor / count * (end - line.time);
    cursor += [...text].length;
    return { text, time, end: line.time + cursor / count * (end - line.time) };
  });
}

export function adjacentTrack(tracks, current, direction, shuffle = false, previous) {
  const index = tracks.findIndex(track => track.id === current);
  if (tracks.length < 2 || index < 0) return tracks[0];
  if (!shuffle) return tracks[(index + direction + tracks.length) % tracks.length];
  if (direction < 0 && previous) return tracks.find(track => track.id === previous) ?? tracks[index];
  const choices = tracks.filter(track => track.id !== current);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function musicState(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.tracks)) throw new Error('歌单格式无法读取。');
  const seen = new Set();
  const tracks = value.tracks.map(track => {
    if (!track || !MUSIC_UUID.test(track.id) || seen.has(track.id) || typeof track.title !== 'string' || !track.title.trim()
      || typeof track.artist !== 'string' || (track.audio !== null && !MUSIC_UUID.test(track.audio))) throw new Error('歌单中有无法读取的曲目。');
    seen.add(track.id);
    const normalized = { id: track.id, title: track.title, artist: track.artist, audio: track.audio };
    if (MUSIC_UUID.test(track.lyrics || '')) normalized.lyrics = track.lyrics;
    return normalized;
  });
  if (value.current_id !== null && !seen.has(value.current_id)) throw new Error('当前曲目无法读取。');
  return { revision: value.revision, current_id: value.current_id, play_mode: value.play_mode === 'shuffle' ? 'shuffle' : 'sequence', tracks };
}

export function musicFoldersState(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.folders) || value.folders.length > 100) {
    throw new Error('音乐文件夹格式无法读取。');
  }
  const ids = new Set();
  const isId = id => typeof id === 'string' && MUSIC_UUID.test(id);
  const folders = value.folders.map(folder => {
    if (!folder || !isId(folder.id) || ids.has(folder.id) || typeof folder.name !== 'string'
      || !folder.name.trim() || folder.name.length > 80 || !Array.isArray(folder.track_ids) || folder.track_ids.length > 200
      || folder.track_ids.some(id => !isId(id)) || new Set(folder.track_ids).size !== folder.track_ids.length) {
      throw new Error('音乐文件夹需要名称和有效曲目。');
    }
    ids.add(folder.id);
    return { id: folder.id, name: folder.name.trim(), track_ids: [...folder.track_ids] };
  });
  if ((value.active_folder_id !== null && !ids.has(value.active_folder_id))
    || (value.current_id !== null && !isId(value.current_id))) {
    throw new Error('当前音乐选择无法读取。');
  }
  return { revision: value.revision, active_folder_id: value.active_folder_id, current_id: value.current_id, folders };
}

export function siteMusicQueue(site, points, foldersState) {
  const byId = new Map();
  for (const track of [...(site?.tracks ?? []), ...(points?.tracks ?? [])]) {
    if (!byId.has(track.id)) byId.set(track.id, track);
  }
  const folder = foldersState?.folders.find(item => item.id === foldersState.active_folder_id);
  const tracks = folder ? folder.track_ids.map(id => byId.get(id)).filter(Boolean) : [...byId.values()];
  const contains = id => tracks.some(track => track.id === id);
  const selected = [foldersState?.current_id, site?.current_id].find(contains);
  const current_id = selected ?? tracks.find(track => track.audio)?.id ?? tracks[0]?.id ?? null;
  return { tracks, current_id, play_mode: site?.play_mode ?? 'sequence' };
}
