import test from 'node:test';

test('无法下载的单个附件显示提示且不生成空原图请求，保留其他照片索引', () => {
  const html = renderEntryMedia({ id: 'memory', media: [
    { type: 'image', name: '缺失的照片', unavailable: true, url: '' },
    { type: 'image', name: '仍可打开', url: 'blob:ok' },
  ] }, escapeHtml);
  assert.match(html, /附件暂时无法加载/);
  assert.ok(!html.includes('src=""'));
  assert.match(html, /data-index="1"/);
});
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/domain.js';
import { renderEntryMedia } from '../src/entry-media.js';

const image = index => ({ type: 'image', name: `照片 ${index + 1}`, url: `/assets/photo-${index + 1}.jpg` });
const entry = media => ({ id: 'memory-1', title: '一起出门', media });

test('1、2、4、9 张照片全部显示，维持自适应列数及每张原图入口', () => {
  for (const count of [1, 2, 4, 9]) {
    const media = Array.from({ length: count }, (_, index) => image(index));
    const html = renderEntryMedia(entry(media), escapeHtml);
    assert.match(html, new RegExp(`class="memory-media count-${count < 3 ? count : 3}"`));
    assert.equal([...html.matchAll(/<img\b/g)].length, count);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    assert.equal(buttons.length, count);
    for (let index = 0; index < count; index++) {
      assert.match(buttons[index][1], /data-action="media"/);
      assert.match(buttons[index][1], /data-id="memory-1"/);
      assert.match(buttons[index][1], new RegExp(`data-index="${index}"`));
      assert.ok(buttons[index][2].includes(`src="${media[index].url}"`));
    }
    assert.ok(!html.includes('more-photos'));
    assert.ok(!/>\+\d+</.test(html));
  }
});

test('九张图片混合视频仍全部保留，并维持原附件索引供查看器导航', () => {
  const media = Array.from({ length: 9 }, (_, index) => image(index));
  media.splice(4, 0, { type: 'video', name: '海边短片', url: '/assets/sea.mp4' });
  const html = renderEntryMedia(entry(media), escapeHtml);
  assert.equal([...html.matchAll(/<img\b/g)].length, 9);
  assert.equal([...html.matchAll(/<video\b/g)].length, 1);
  assert.equal([...html.matchAll(/data-action="media"/g)].length, 10);
  assert.match(html, /data-index="4"[^>]*><video src="\/assets\/sea\.mp4" preload="metadata" playsinline>/);
  assert.match(html, /data-index="9"[^>]*><img src="\/assets\/photo-9\.jpg"/);
  assert.ok(html.includes('class="video-label"'));
});

test('空附件不渲染网格，作者内容转义并继续使用原有 URL 安全策略', () => {
  assert.equal(renderEntryMedia(entry([]), escapeHtml), '');
  assert.equal(renderEntryMedia({ id: 'empty' }, escapeHtml), '');
  const urls = [];
  const html = renderEntryMedia({ id: '" onclick="alert(1)', title: '<script>', media: [{ type: 'image', name: '"><script>', url: 'unsafe:example' }] }, value => { urls.push(value); return ''; });
  assert.deepEqual(urls, ['unsafe:example']);
  assert.match(html, /src=""/);
  assert.ok(html.includes('&quot; onclick=&quot;alert(1)'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});
