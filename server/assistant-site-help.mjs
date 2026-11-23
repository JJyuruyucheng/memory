import { isAssistantPage } from '../src/assistant-contract.js';

const pages = Object.freeze({
  timeline: ['时光线', '查看和搜索回忆；点「记录这一刻」发布随记、事件或悄悄话。'],
  events: ['重要时刻', '这里按事件类型展示特别的时刻，可以按日期、作者或心情筛选。'],
  album: ['我们的相册', '查看记录中的照片与视频，可以切换附件类型并按月份筛选。'],
  stats: ['时光统计', '查看记录数量、月份趋势、心情和标签分布，也可以切换统计月份。'],
  favorites: ['我的收藏', '查看自己收藏过的记录；在记录上再次点收藏可以取消。'],
  anniversaries: ['纪念日', '查看值得纪念的日期及下一次到来的日子；编辑入口在「我们与设置」。'],
  us: ['我们与设置', '管理空间名字、开始日期、纪念日、背景音乐和登录页照片，也可以导出档案或退出当前账号。'],
  points: ['我的积分', '查看自己的积分、签到、规则说明、共同回忆与挑战；商城和背包在同一组导航中。'],
  shop: ['积分商城', '查看商品、所需积分和库存；兑换前需自行确认。已兑换的物品在「我的背包」。'],
  backpack: ['我的背包', '查看自己已兑换的物品和使用状态；使用前需自行确认。'],
  admin: ['管理小屋', '管理员在这里查看账号活动、使用时长和服务资源统计。普通成员没有此页面的数据权限。'],
  'shop-admin': ['商城管理', '管理员在这里维护商品、规则说明和共同挑战，并查看兑换记录。'],
  trash: ['回收站', '查看已删除的记录并恢复仍可恢复的内容；永久清理前请核对确认。'],
});

function answer(page, reply = pages[page][1]) {
  return { reply, sources: [{ title: pages[page][0], href: `#${page}` }] };
}

// Navigation help only: no database calls, secrets, personal facts or changes.
// Return null for ordinary questions so data tools and analysis keep their scope.
export function siteHelpReply(question, { page } = {}) {
  if (typeof question !== 'string') return null;
  const text = question.normalize('NFKC').trim();
  if (/你(?:能|会|可以)(?:做|干|帮).{0,8}(?:什么|哪些)|(?:瓜子|助手).{0,8}(?:功能|怎么用)|(?:系统|网站|朝夕).{0,8}(?:有哪些功能|有什么功能|怎么用)/u.test(text)) {
    return answer('timeline', '我可以根据当前页面帮你找到站内功能、查询共享帖数量，也可以按主题回顾你们发布的共享记录。新发布的共享随记和事件会整理成记忆，回答时可以打开原文核对。你可以问「相册在哪里」，或在某条共享记录旁点「问瓜子」。我也能查城市天气。');
  }
  const help = /怎么|如何|怎样|哪里|在哪|入口|打开|进入|前往|跳到|带我去|使用方法|如何使用/u.test(text);
  if (!help) return null;
  if (/当前页|这(?:个|一)?页|这里|这儿/u.test(text) && isAssistantPage(page)
    && /怎么用|如何使用|什么页面|在哪|有什么|能做什么/u.test(text)) {
    return answer(page, `你现在在「${pages[page][0]}」。${pages[page][1]}`);
  }
  if (/个人资料|头像|昵称|密码/u.test(text)) {
    return answer('us', '点自己的头像打开「个人资料」，可以修改展示昵称和头像；展开「更改登录密码」后填写当前密码、新密码并完成安全验证。账号口令不需要发给瓜子。');
  }
  if (/登录页照片|登录照片|登录.*轮播|轮播.*照片/u.test(text)) return answer('us', '到「我们与设置 → 登录页照片」，点「编辑照片」管理登录页的展示照片。');
  if (/背景音乐|歌单|播放器|歌词/u.test(text)) return answer('us', '到「我们与设置 → 背景音乐」管理歌单和音源；播放器上的「词」按钮用于开关歌词。');
  if (/退出|登出/u.test(text)) return answer('us', '到「我们与设置 → 数据与账号」点「退出当前账号」，也可以使用账号旁的退出按钮。');
  if (/备份|导出|档案/u.test(text)) return answer('us', '到「我们与设置 → 数据与账号」选择「导出我的回忆」或「导出共同档案」。内容导出不等同于完整系统备份。');
  if (/悄悄话|谁能看|谁可以看|可见范围/u.test(text)) return answer('timeline', '发布记录时选择「悄悄话」，只有作者和管理员可见；普通随记和事件由共同空间成员共享。');
  if (/回收站|删除|恢复.{0,8}(?:记录|帖子)|清空/u.test(text)) return answer('trash');
  if (/管理小屋|账号活动|使用时长|服务资源/u.test(text)) return answer('admin');
  if (/商城管理|管理.{0,5}(?:商品|商城)|编辑.{0,5}(?:商品|规则)|发布挑战/u.test(text)) return answer('shop-admin');
  if (/背包|兑换的|已兑换|使用.{0,5}(?:商品|物品|卡券)/u.test(text)) return answer('backpack');
  if (/商城|商品|兑换/u.test(text)) return answer('shop');
  if (/积分|签到|共同挑战|共同回忆/u.test(text)) return answer('points');
  if (/纪念日|周年|农历|生日/u.test(text)) return answer('anniversaries');
  if (/统计|趋势|心情分布|标签分布/u.test(text)) return answer('stats');
  if (/收藏/u.test(text)) return answer('favorites');
  if (/(?:上传|添加|发布).{0,8}(?:照片|图片|视频)/u.test(text)) return answer('timeline', '在「时光线」点「记录这一刻」，选择图片或视频附件，再保存这条回忆；已有记录可以进入编辑页添加附件。');
  if (/相册|照片|图片|视频/u.test(text)) return answer('album');
  if (/重要时刻|事件/u.test(text)) return answer('events');
  if (/设置|开始日期|空间名字|副标题/u.test(text)) return answer('us');
  if (/时光线|时间线|发布|新建|发帖|随记|写.{0,5}(?:记录|帖子)/u.test(text)) return answer('timeline');
  return null;
}
