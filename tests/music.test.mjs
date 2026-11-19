import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentTrack, lyricText, musicFileType, musicState, parseLyrics } from '../src/background-music-data.js';

test('LRC 解析有序时间、毫秒偏移和一行多个时间戳', () => {
  const lines = parseLyrics('[ti:示例]\r\n[offset:+200]\r\n[00:12.50][00:24.5] 后一句\r\n[00:01.3] 先一句');
  assert.deepEqual(lines, [
    { time: 1.5, text: '先一句' }, { time: 12.7, text: '后一句' }, { time: 24.7, text: '后一句' },
  ]);
  assert.deepEqual(parseLyrics('没有时间标记的文字'), []);
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
