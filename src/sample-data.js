/** Every person, record and date in this seed is fictional demonstration data. */
export function createSampleData() {
  const users = [
    { id: 'demo-linjian', username: 'linjian-demo', name: '林间', role: 'member', color: '#728b71' },
    { id: 'demo-wanwan', username: 'wanwan-demo', name: '晚晚', role: 'member', color: '#c58172' },
    { id: 'demo-admin', username: 'admin-demo', name: '管理员', role: 'admin', color: '#8c829b' },
  ];
  const media = (id, file, name) => ({ id, type: 'image', url: `./assets/${file}`, name, size: 0 });
  const record = (id, authorId, type, title, content, date, mood, tags, attachments = [], comments = []) => ({
    id, authorId, type, title, content, occurredAt: `${date}T04:00:00.000Z`,
    createdAt: `${date}T12:15:00.000Z`, updatedAt: `${date}T12:15:00.000Z`,
    mood, tags: ['示例', ...tags], media: attachments, comments,
    reactionBy: [], favoriteBy: [], deletedAt: null,
  });
  const entries = [
    record('demo-entry-1', users[0].id, 'note', '把周末过慢一点', '今天没有安排。一起磨咖啡、翻了几页书，窗边的阳光刚好落在杯子上。这样的普通日子，也想好好收起来。', '2026-11-02', 'happy', ['日常', '咖啡'], [media('demo-media-coffee', 'photo-coffee.jpg', '窗边的咖啡（示例图片）')]),
    record('demo-entry-2', users[1].id, 'event', '终于去看海了', '风比想象中大。鞋里装了沙子，回来时却舍不得倒掉。下次带一张大一点的野餐垫。', '2026-11-04', 'happy', ['旅行', '第一次'], [media('demo-media-sea', 'photo-sea.jpg', '海边散步（示例图片）')], [
      { id: 'demo-comment-1', authorId: users[0].id, content: '还要带上那只保温杯。', createdAt: '2026-11-04T13:00:00.000Z' },
    ]),
    record('demo-entry-3', users[0].id, 'note', '下雨的星期五', '下班路上有点累，也没什么特别的事。到家后一起听完一张专辑，心情慢慢安静下来。', '2026-11-06', 'neutral', ['日常']),
    record('demo-entry-4', users[1].id, 'note', '今天需要一个拥抱', '有件小事没做好，回家时有些难过。谢谢你愿意先听我说完，也没有催我马上开心起来。', '2026-11-08', 'sad', ['心事']),
    record('demo-entry-5', users[0].id, 'event', '两个人的小餐桌', '第一次照着菜谱做了完整的晚饭。汤有一点咸，不过我们都添了第二碗。把这份菜谱留下来，下次再试。', '2026-11-10', 'happy', ['做饭', '第一次'], [media('demo-media-dinner', 'photo-dinner.jpg', '一起做的晚餐（示例图片）')]),
    record('demo-entry-6', users[1].id, 'note', '路过熟悉的街角', '散步绕了一点远路，看见街角的灯已经亮了。没有特别的目的地，走到哪里都可以。', '2026-11-13', null, ['散步', '日常'], [media('demo-media-city', 'photo-city.jpg', '傍晚的街道（示例图片）')]),
    record('demo-entry-7', users[0].id, 'event', '留给我们的一个下午', '关掉工作消息，一起逛了花店，选了一小束白色的花。回家的路上说了很多没有结论的话。', '2026-11-15', 'happy', ['约会']),
  ];
  entries[1].reactionBy = [users[0].id];
  entries[0].favoriteBy = [users[1].id];
  return {
    mode: 'demo', currentUser: users[0], users, entries,
    settings: {
      spaceName: '林间与晚晚', subtitle: '虚构示例空间 · 记录平常日子里的小小心动', startDate: '2025-05-20',
      anniversaries: [
        { id: 'demo-anniversary-1', title: '在一起的日子（示例）', date: '2025-05-20', yearly: true },
        { id: 'demo-anniversary-2', title: '第一次一起看海（示例）', date: '2026-11-04', yearly: true },
      ],
    },
  };
}
