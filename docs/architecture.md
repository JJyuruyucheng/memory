# 朝夕：实现边界与接口

本项目复用 Memos 的认证、共享空间、记录、评论、附件及管理能力。GitHub Pages 仅发布登录预览，不初始化记录服务、不收取口令。真实模式由同源 Node 安全网关提供前端、登录入口与 Memos API；Memos 仅在内部网络或容器 loopback 监听。本地 demo 使用虚构资料及浏览器存储，不是双人在线同步。

初始固定 Memos 26.11.1，部署前检查该版本真实接口。模式由构建时 MEMORY_MODE=demo|preview|live 决定，live 还必须指定 MEMORY_SPACE=spaces/<id>。Pages 目标只接受 preview；非 demo 构建不包含演示 provider、样例记录及四张样例照片。运行时不接受 URL 参数切换模式。

## Provider contract

`src/demo-provider.js` 和 `src/memos-provider.js` 各导出 `createDemoProvider()` / `createMemosProvider(config)`。

Provider 异步方法：`init()` -> state；`saveEntry(entry, files=[])` -> entry；`deleteEntry(id)` -> void；`restoreEntry(id)` -> void；`toggleReaction(id)` -> entry；`toggleFavorite(id)` -> entry；`addComment(id,text)` -> comment；`saveSettings(settings)` -> settings；`exportData(scope='all')` -> Blob (JSON 内含媒体内容)；`login(username,password,captchaToken)` -> state；`logout()` -> void。demo 额外 `switchUser(id)` -> user 和 `resetDemo()` -> state。

state: `{mode, currentUser, users, entries, settings}`。currentUser 可以 null（live 未登录），users 每项 `{id,username,name,role:'member'|'admin',color}`。三个账户是两个普通成员和一个管理员；同一个人可以持有日常与管理员账户。

entry: `{id,authorId,type:'note'|'event',title,content,occurredAt,createdAt,updatedAt,mood:'happy'|'neutral'|'sad'|null,tags:string[],media:Media[],comments:Comment[],reactionBy:string[],favoriteBy:string[],deletedAt:null|string}`。media: `{id,type:'image'|'video',url,name,size}`。comment: `{id,authorId,content,createdAt}`。settings: `{spaceName,subtitle,startDate,anniversaries:[{id,title,date,yearly}]}`。

所有 ID 按不透明字符串处理。时间存 ISO UTC，日期按 Asia/Shanghai 归档。心情统计按记录而非按天；未填写排除分母。发布后的记录两人共享；各自编辑自己内容，管理员有 Memos 原生的读取和维护权。收藏按人分开。回收站保留原文和附件；没有启用自动清理任务。星形收藏使用原生反应，在共同空间内仍可被其他成员看到。

`src/domain.js` 提供 `validateEntry(entry,files,config)`, `filterEntries(entries,filters)`, `computeStats(entries,options)`, `dayKey(date)`, `relationshipDays(startDate,now)`, `anniversaryInfo(anniversary,now)` 和 `escapeHtml(value)`。过滤参数 `{query, type:'all'|'note'|'event', mood:'all'|'happy'|'neutral'|'sad'|'unset', authorId:'all'|id, favoritesOnly, userId, month:'YYYY-MM'|'' , trash:false}`。stats 返回 `{total,events,days,images,videos,moods:{happy,neutral,sad,unset},months:[{month,count}],authors:[{authorId,count}]}`。

前端由原生 ES modules 构成；正式登录页按需加载 Cloudflare 官方 Turnstile 脚本，不使用公网图床。构建复制并生成配置文件，测试使用 Node 内建 test runner。


## 登录与托管

正式登录流程为：`GET /auth/config` 获取公开 site key → Turnstile 产生一次性 token → `POST /auth/login` 提交 `{username,password,captchaToken}` → 网关限制全局、来源和账号尝试，核验 Siteverify 的 success、hostname、action → 内部调用 Memos Connect SignIn。原始 REST/Connect 登录与注册入口不对公网开放。密码哈希、会话及记录授权仍由 Memos 处理；访问 token 只留在 provider 闭包内，刷新 cookie 使用原生 HttpOnly 会话。

两个日常账号由服务端首次初始化固定为 `xbl`、`ll`，管理员独立。密码只从部署平台秘密配置或初始化终端输入，不写入公共源码和静态产物。没有注册入口；环境配置中缺验证码密钥时登录失败关闭。验证码不是不可破解的保证，短口令仍建议更换。

无自管服务器时，准备了 Render 单容器托管模板：Node 网关为唯一公网端口，Memos 监听 loopback；数据库与附件挂载持久磁盘。模板就绪不等于已部署，必须在实际账号、域名、真实 Turnstile keys 与磁盘上验收。详见 [部署说明](deployment.md) 和 [安全边界](security.md)。

## 媒体展示

时间线完整渲染已保存的全部附件；最多九张图片的发布校验沿用 domain。总数一张占满、两张均分，三张及以上为三列多行；移除第三张的 +N 遮罩。每一张都保留原始索引供大图查看器导航，混合视频也不截断。九张限制目前是应用校验，不能等同独立的服务端文件内容和配额审计。
