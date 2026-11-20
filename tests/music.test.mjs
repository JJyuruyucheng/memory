import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentTrack, lyricParts, lyricText, musicFileType, musicFoldersState, musicState, parseLyrics, siteMusicQueue } from '../src/background-music-data.js';

test('LRC 解析有序时间、毫秒偏移和一行多个时间戳', () => {
  const lines = parseLyrics('[ti:示例]\r\n[offset:+200]\r\n[00:12.50][00:24.5] 后一句\r\n[00:01.3] 先一句');
  assert.deepEqual(lines, [
    { time: 1.5, text: '先一句' }, { time: 12.7, text: '后一句' }, { time: 24.7, text: '后一句' },
  ]);
  assert.deepEqual(parseLyrics('没有时间标记的文字'), []);
});

test('增强 LRC 保留词的起止时间、全局偏移和复唱时间', () => {
  const [intro, repeat, outro] = parseLyrics(
    '[offset:+500]\n[00:02][00:06]<00:02>晨光<00:02.75>照过来<00:03.25>\n[00:10] 听 [00:10.50] 风落下',
  );
  assert.deepEqual(intro, { time: 2.5, text: '晨光照过来', words: [
    { text: '晨光', time: 2.5, end: 3.25 }, { text: '照过来', time: 3.25, end: 3.75 },
  ] });
  assert.deepEqual(lyricParts(repeat, 10.5, 15), [
    { text: '晨光', time: 6.5, end: 7.25 }, { text: '照过来', time: 7.25, end: 7.75 },
  ]);
  assert.deepEqual(outro.words.map(word => [word.text.trim(), word.time, word.end]), [
    ['听', 10.5, 11], ['风落下', 11, undefined],
  ]);
});

test('逐行 LRC 在每句时长内依次给文字分配进度', () => {
  const [line] = parseLyrics('[00:01]Hello world');
  assert.deepEqual(lyricParts(line, 12, 15), [
    { text: 'Hello', time: 1, end: 6 }, { text: ' ', time: 6, end: 7 }, { text: 'world', time: 7, end: 12 },
  ]);
});

test('通用二进制文件类型的中文 LRC 可识别和解码', async () => {
  const lyric = new File(['[00:01.50] ', Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4)], 'fixture.lrc', { type: 'application/octet-stream' });
  assert.equal(musicFileType(lyric), 'text/plain');
  assert.deepEqual(parseLyrics(await lyricText(lyric)), [{ time: 1.5, text: '中文' }]);
  const bomLyric = new Blob([Uint8Array.of(0xff, 0xfe), Buffer.from('[00:02] 第二行', 'utf16le')]);
  assert.equal(await lyricText(bomLyric), '[00:02] 第二行');
});

test('原有歌单以顺序模式打开，随机模式上一首回到已播放曲目', () => {
  const tracks = [1, 2, 3].map(n => ({
    id: `50000000-0000-4000-8000-00000000000${n}`, title: `曲目 ${n}`, artist: '', audio: null,
  }));
  const state = musicState({ revision: 0, current_id: tracks[0].id, tracks });
  assert.equal(state.play_mode, 'sequence');
  assert.deepEqual(state.tracks, tracks);
  assert.equal(adjacentTrack(tracks, tracks[0].id, -1), tracks[2]);
  assert.equal(adjacentTrack(tracks, tracks[2].id, 1), tracks[0]);
  assert.equal(adjacentTrack(tracks, tracks[1].id, -1, true, tracks[2].id), tracks[2]);
  assert.notEqual(adjacentTrack(tracks, tracks[1].id, 1, true).id, tracks[1].id);
});

test('全部音乐持续合并积分曲目，文件夹按自身顺序播放并忽略失效引用', () => {
  const [original, piano, uploaded, missing, folderId] = [1, 2, 3, 4, 5].map(n => `00000000-0000-4000-8000-00000000000${n}`);
  const track = id => ({ id, title: id, artist: '', audio: id });
  const site = musicState({ revision: 0, current_id: original, tracks: [track(original)] });
  const points = musicState({ revision: 1, current_id: piano, tracks: [track(piano), track(uploaded)] });
  const folders = [{ id: folderId, name: '  旅行  ', track_ids: [uploaded, missing, original] }];
  const settings = musicFoldersState({ revision: 1, active_folder_id: null, current_id: null, folders });
  assert.equal(settings.folders[0].name, '旅行');
  assert.deepEqual(siteMusicQueue(site, points, settings), {
    tracks: [track(original), track(piano), track(uploaded)], current_id: original, play_mode: 'sequence',
  });
  assert.deepEqual(siteMusicQueue(site, points, { ...settings, active_folder_id: folderId, current_id: uploaded }), {
    tracks: [track(uploaded), track(original)], current_id: uploaded, play_mode: 'sequence',
  });
  assert.equal(siteMusicQueue(site, points, { ...settings, current_id: piano }).current_id, piano);
  assert.throws(() => musicFoldersState({ ...settings, folders: [{ ...folders[0], track_ids: [piano, piano] }] }));
});
