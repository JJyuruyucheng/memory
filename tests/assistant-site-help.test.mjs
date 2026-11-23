import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_PAGES, assistantContext, isAssistantPage, requestHistory } from '../src/assistant-contract.js';
import { siteHelpReply } from '../server/assistant-site-help.mjs';

test('页面上下文只发送已知路由与所选记录标识，不接受URL、表单或账户数据', () => {
  assert.ok(Object.isFrozen(ASSISTANT_PAGES));
  assert.deepEqual(assistantContext({ page: 'album', articleSlug: 'record-1', referenceSlug: 'record-2',
    username: 'synthetic-private-user', password: 'never-send', entries: [{ content: 'never-send' }] }),
  { page: 'album', articleSlug: 'record-1', referenceSlug: 'record-2' });
  for (const page of ['#album', 'album?username=private', 'https://elsewhere.invalid', 'constructor', '', null]) {
    assert.equal(isAssistantPage(page), false); assert.deepEqual(assistantContext({ page }), {});
  }
  assert.deepEqual(assistantContext({ articleSlug: 'https://elsewhere.invalid', referenceSlug: '<private>' }), {});
  assert.deepEqual(assistantContext(), {}, '旧调用可以省略页面与引用');
});

test('当前页面帮助覆盖白名单路由，页面提示不成为权限声明', () => {
  for (const page of ASSISTANT_PAGES) {
    const value = siteHelpReply('这个页面怎么用？', { page });
    assert.match(value.reply, /你现在在/); assert.equal(value.sources[0].href, `#${page}`);
  }
  assert.equal(siteHelpReply('这个页面怎么用？', { page: 'https://evil.invalid' }), null);
  assert.match(siteHelpReply('管理小屋在哪里？').reply, /普通成员没有/);
});

test('功能导航直接使用已存在的页面入口，不编造动态统计或自动操作', () => {
  for (const [question, page] of [
    ['怎么查看相册？', 'album'], ['怎么上传照片？', 'timeline'], ['怎么发布一条随记？', 'timeline'], ['纪念日在哪？', 'anniversaries'],
    ['怎么修改密码？', 'us'], ['怎么导出共同档案？', 'us'], ['背景音乐怎么设置？', 'us'],
    ['怎么看积分？', 'points'], ['积分商城在哪里？', 'shop'], ['兑换的东西在哪？', 'backpack'],
    ['回收站在哪里？', 'trash'], ['怎么管理商品？', 'shop-admin'], ['如何查看时光统计？', 'stats'],
  ]) {
    const value = siteHelpReply(question);
    assert.ok(value, question); assert.equal(value.sources[0].href, `#${page}`, question);
  }
  assert.match(siteHelpReply('瓜子有什么功能？').reply, /共享/);
  assert.match(siteHelpReply('怎么设置悄悄话的可见范围？').reply, /只有作者和管理员/);
});

test('历史请求替换此前引用共享记录的回复，保留UI记录与正常聊天但不外发来源标记', () => {
  const transcript = [
    { role: 'user', content: '分析这篇随记' },
    { role: 'assistant', content: '从旧共享正文得出的私人内容', citesSharedRecord: true },
    { role: 'user', content: '天气呢？' },
    { role: 'assistant', content: '请告诉我城市。', citesSharedRecord: false },
  ];
  const history = requestHistory(transcript, '继续说这篇随记');
  assert.equal(transcript[1].content, '从旧共享正文得出的私人内容', 'UI原回答不改写');
  assert.equal(history[1].content, '上一轮引用了共享记录，需按当前可见范围重新查阅。');
  assert.equal(history[3].content, '请告诉我城市。');
  assert.ok(!JSON.stringify(history).includes('私人内容'));
  assert.ok(history.every(message => Object.keys(message).length === 2));
});

test('普通分析、动态数量与天气问题留给实际数据工具，不被导航帮助截获', () => {
  for (const question of ['你看我们的系统上，有多少帖子了', '我们有多少照片？', '我的积分有多少？',
    '今天福州天气如何', '分析这篇随记', '为什么我今天有点难受', '我们在一起多少天了', '这个月有多少事件？']) {
    assert.equal(siteHelpReply(question, { page: 'stats' }), null, question);
  }
});
