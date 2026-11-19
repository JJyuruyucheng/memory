import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentTrack, musicState, parseLyrics } from '../src/background-music-data.js';

test('LRC 解析有序时间、毫秒偏移和一行多个时间戳', () => {
  const lines = parseLyrics('[ti:示例]\r\n[offset:+200]\r\n[00:12.50][00:24.5] 后一句\r\n[00:01.3] 先一句');
  assert.deepEqual(lines, [
    { time: 1.5, text: '先一句' }, { time: 12.7, text: '后一句' }, { time: 24.7, text: '后一句' },
  ]);
  assert.deepEqual(parseLyrics('没有时间标记的文字'), []);
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
