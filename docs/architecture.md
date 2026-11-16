# 朝夕：实现边界与接口

本项目复用 Memos 的认证、共享空间、记录、评论、附件及管理能力。GitHub Pages 仅发布演示模式；真实模式必须与 Memos 同源部署。演示数据都是虚构的，不能称作已实现双人在线同步。

初始固定 Memos 26.11.1，部署前检查该版本真实接口。模式由构建时 MEMORY_MODE=demo|live 决定，live 还必须指定 MEMORY_SPACE=spaces/<id>。运行时不接受 URL 参数切换为 live，也不允许 Pages 演示界面收取密码。

## Provider contract

`src/demo-provider.js` 和 `src/memos-provider.js` 各导出 `createDemoProvider()` / `createMemosProvider(config)`。

Provider 异步方法：`init()` -> state；`saveEntry(entry, files=[])` -> entry；`deleteEntry(id)` -> void；`restoreEntry(id)` -> void；`toggleReaction(id)` -> entry；`toggleFavorite(id)` -> entry；`addComment(id,text)` -> comment；`saveSettings(settings)` -> settings；`exportData(scope='all')` -> Blob (JSON 内含媒体内容)；`login(username,password)` -> state；`logout()` -> void。demo 额外 `switchUser(id)` -> user 和 `resetDemo()` -> state。

state: `{mode, currentUser, users, entries, settings}`。currentUser 可以 null（live 未登录），users 每项 `{id,username,name,role:'member'|'admin',color}`。三个账户是两个普通成员和一个管理员；同一个人可以持有日常与管理员账户。

entry: `{id,authorId,type:'note'|'event',title,content,occurredAt,createdAt,updatedAt,mood:'happy'|'neutral'|'sad'|null,tags:string[],media:Media[],comments:Comment[],reactionBy:string[],favoriteBy:string[],deletedAt:null|string}`。media: `{id,type:'image'|'video',url,name,size}`。comment: `{id,authorId,content,createdAt}`。settings: `{spaceName,subtitle,startDate,anniversaries:[{id,title,date,yearly}]}`。

所有 ID 按不透明字符串处理。时间存 ISO UTC，日期按 Asia/Shanghai 归档。心情统计按记录而非按天；未填写排除分母。发布后的记录两人共享；各自编辑自己内容，管理员有 Memos 原生的读取和维护权。收藏按人分开。回收站默认 30 天，但未经验证的自动清理不能声称已启用。

`src/domain.js` 提供 `validateEntry(entry,files,config)`, `filterEntries(entries,filters)`, `computeStats(entries,options)`, `dayKey(date)`, `relationshipDays(startDate,now)`, `anniversaryInfo(anniversary,now)` 和 `escapeHtml(value)`。过滤参数 `{query, type:'all'|'note'|'event', mood:'all'|'happy'|'neutral'|'sad'|'unset', authorId:'all'|id, favoritesOnly, userId, month:'YYYY-MM'|'' , trash:false}`。stats 返回 `{total,events,days,images,videos,moods:{happy,neutral,sad,unset},months:[{month,count}],authors:[{authorId,count}]}`。

前端由原生 ES modules 构成，无第三方运行时脚本或公网图床。构建复制并生成配置文件，测试使用 Node 内建 test runner。
