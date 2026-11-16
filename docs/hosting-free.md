# 免费起步方案

核查日期：2026-11-16。当前采用 **Cloudflare Pages Free + Supabase Free + Cloudflare Turnstile Free** 路线。GitHub 的 `memory` 仓库继续管理源码；现有 GitHub Pages 仍是登录预览。用户已批准在指定 Free 组织创建专用 `memory` 项目（新加坡），实际创建报价为 **$0/月**；项目已创建并应用业务数据库迁移。正式登录尚未启用。

## 当前已完成和待完成

已完成：官方 Supabase SDK 本地固定版本、前端 provider、七张业务表及 RLS、作者私有草稿、原子选图、媒体登记与 Storage 权限规则。真实云端 SQL 隔离测试通过并全部回滚；匿名 HTTP 请求七表均得到 401/42501。数据库启动门保持 false；项目当前没有 Auth 用户、正式 profiles、记录或 bucket。

Cloudflare Pages 已关联且只授权 `JJyuruyucheng/memory`，首次部署成功，入口为 https://memory-awv.pages.dev。Turnstile 的 `memory-login` 使用 Managed 模式，仅允许该精确 hostname，pre-clearance 关闭。Supabase 公共 Auth settings 已实际确认公开注册关闭、匿名登录关闭，只有 Email 登录开启。

尚待完成：将 Turnstile Secret 保存到原生 Auth 配置并验证后端验证码拦截，通过官方 API 创建三账号与 private bucket，真实用户 JWT 上传下载及登录验收。没有这些证据时不能把 `MEMORY_AUTH_READY` 或数据库门设为 true。SQL 模拟身份、SDK mock 测试和浏览器登录页加载不等于已验证真实验证码。

数据库安全 Advisor 当前没有 ERROR/WARN；一条 INFO 是 `memory_private.runtime_guard` 启用 RLS 且没有开放策略，这是有意拒绝全部 API 访问。空项目索引尚未使用的 INFO 保留观察，不为消除提示删除必要索引。[Advisor 说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

具体证据和未验收范围见 [本轮验证记录](verification-free.md)。

## 推荐判断

已先核查成熟开源底座：[Supabase](https://github.com/supabase/supabase) 与官方 [supabase-js](https://github.com/supabase/supabase-js)。复用其认证、Postgres 与私有 Storage，避免自己实现密码保存与校验。原有时间线、九宫格、编辑器与统计界面保留；Memos/Render 作为需要付费托管时的备选，不会自动购买。

正式前端建议使用 Cloudflare Pages。GitHub Pages 官方提醒不应用于发送密码等敏感交易，因此不直接把当前 Pages 预览改成正式密码登录站。[GitHub 官方使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) Cloudflare Pages 可以关联现有 GitHub 仓库，并提供 `pages.dev` 域名；Free 目前支持每月 500 次构建。[部署静态站](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)、[Pages 限制](https://developers.cloudflare.com/pages/platform/limits/)

## 已核实的免费额度与限制

| 服务 | 当前事实 | 对本项目的影响 |
| --- | --- | --- |
| Supabase Free | $0/月，500MB 数据库、1GB 文件存储、每月 5GB 普通出站与另列的 5GB 缓存出站；最多两个活跃免费项目。 | 适合先保存文字和少量照片，不能把两类流量简单当作任意 10GB 共用额度。 |
| 文件上传 | Free 单文件上限 50MB；不包含免费图片转换。 | 正式适配需按平台实际字节上限校验，不能原样沿用当前 50MiB 提示；视频宜提前压缩。 |
| 活跃与恢复 | 过去七天低活动可能导致暂停，少量真实使用也不保证避免；当前政策允许暂停后最长一年从控制台恢复。 | 偶尔可能需要项目拥有者进入后台恢复，不能承诺永久在线或免维护。 |
| 备份与服务保证 | Free 不含自动数据库备份及可用性 SLA。 | 应定期导出文字和全部媒体到自己的设备；现有内容导出不是完整恢复或自动迁移工具。 |
| Turnstile Free | 免费档支持不限次数的挑战。 | 使用原生服务端校验，不能只在页面里画一个验证码。 |

来源：[Supabase 定价](https://supabase.com/pricing)、[上传上限](https://supabase.com/docs/guides/storage/uploads/file-limits)、[当前暂停政策](https://supabase.com/docs/guides/platform/free-project-pausing)、[Turnstile 方案](https://developers.cloudflare.com/turnstile/plans/)。以上为当前额度，不是永久不变的承诺。Supabase 官方说明免费超额会通知并可能限制服务；不应默认为升级付费。[计费 FAQ](https://supabase.com/docs/guides/platform/billing-faq)

本轮已在用户 Free 组织实际创建 $0/月项目，未开通付费订阅。如后续控制台要求付款、升级或开通按量收费产品，应停止并说明，不代替用户接受新账单。大陆网络下两人的登录、上传及验证码实际可达性尚未验证。

## 登录、权限与媒体方案

1. 在可信后台预建两个日常身份及独立管理员，页面仍输入 `xbl`、`ll`。Supabase 原生密码身份使用邮箱或电话，用户名需映射到预建身份；口令不进入公开仓库。关闭公开注册与匿名登录，不提供注册入口。[认证配置](https://supabase.com/docs/guides/auth/general-configuration)、[后台创建用户](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
2. 在 Supabase Auth 开启原生 Turnstile 保护，并将 Secret 只保存到认证配置。前端使用官方 `signInWithPassword` 的 `captchaToken`；直接访问原生密码接口也必须经过服务端验证码验证。[官方 CAPTCHA 配置](https://supabase.com/docs/guides/auth/auth-captcha)
3. 启用所有业务表的 RLS，按三个预建身份的 UUID 限制读取；普通成员仅修改本人记录，管理员按受保护角色授权。不能信任用户自行修改的 `user_metadata` 来授予管理员权限。统计查询也须遵守同一边界。[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
4. 照片和视频保存在 **private bucket**，下载也执行 RLS；继续采用鉴权下载后生成 Blob URL，不使用公开桶或可转发的长期签名链接。退出时清理页面、令牌和 Blob URL。[私有存储权限](https://supabase.com/docs/guides/storage/buckets/fundamentals)
5. 浏览器仅允许公共 publishable key，绝不放入 `service_role`、数据库密码或验证码 Secret。纯静态前端无法沿用 Memos 同源 HttpOnly Cookie；初版建议关闭 SDK 默认持久化、令牌只留内存，刷新后重新登录。如要保留刷新会话，须另行设计并审查服务端会话层。[前端数据安全](https://supabase.com/docs/guides/database/secure-data)、[Auth 客户端](https://supabase.com/docs/reference/javascript/auth)

原生 Auth 已有限流，但不是每账号永久锁定，也不是防御分布式攻击的保证。短初始口令的风险不会被验证码消除。[Auth 限流](https://supabase.com/docs/guides/auth/rate-limits)

## 实施顺序与验收

Supabase 已连接，专用项目、迁移和 provider 已准备。Cloudflare 当前构建命令为 `node scripts/build-cloudflare.mjs`，产物目录 `dist`，`.node-version` 固定 Node 24。它只读取 [明确的公共配置](../deploy/cloudflare.public.json)：项目地址、publishable key、Turnstile Site Key 和布尔 authReady；不接收环境里的后台密钥。这些值会进入浏览器，不是秘密。先以 authReady=false 发布空登录壳取得正式域名，再限定 Turnstile hostname，配置 Supabase Auth 原生 CAPTCHA，关闭公开注册/匿名及无关认证方式。官方连接目前不提供 Auth 配置更新接口，这些配置需要已登录的控制台完成；不提取连接的 OAuth/PAT 绕过。

若独立使用 `node scripts/build.mjs`，仍可采用 [公开环境变量模板](../deploy/cloudflare.env.example)；不能混淆两个入口的配置来源。

之后按 [数据库契约和初始化顺序](supabase-database-contract.md) 用官方 Auth Admin / Storage API 初始化固定三身份及私有桶，写入真实 UUID 白名单；真实验证码与权限实测完成后才打开数据库门及前端登录。需要的 Secret 仅进入可信服务端或平台配置，不发送到聊天或公开仓库。

已提供默认关闭的 [短期初始化工具](../supabase/bootstrap/README.md)，仅创建固定三身份及严格私有桶，不修改既有密码、不写 profiles、不打开权限门。它的 17 项本地测试已通过，但尚未部署或调用。若使用此方式自动化，须在原生验证码配置验证后短期激活，并在成功或异常后覆盖为 HTTP 410、实际复测关闭。Supabase 原生密码硬下限为 6 字符，不能保留 5 字符初始口令，也不能用前端补位绕过。

在开放正式入口前，实际验证：匿名无法读取记录/统计/原图，未知账号不能进入，普通成员不能修改对方记录或伪造管理员，无验证码直接调用原生登录失败，退出后不再显示内容，九图完整展示，网络失败不误报保存成功。还需验证双设备访问与包含原始媒体的导出。源码文件存在或模拟测试通过，不能替代真实云权限验收。

旧 IndexedDB 演示记录不会因方案切换自动删除，但**尚未实现迁入 Supabase 的工具**，也不应声称它们已经云端备份。上传前压缩可以作为控制用量的选择，不自动替换已有原图。

## 其他免费路线

Cloudflare Workers/D1 有免费额度，但 R2 需要开通按量订阅并可能产生超额账单，不作为当前避免新付费承诺的首选。[R2 开通要求](https://developers.cloudflare.com/r2/get-started/)

Neon 的免费存储与托管认证也值得保留为备选，但本轮尚未核实其托管认证能否强制 Turnstile；不能把开源认证库的插件能力等同于托管服务已支持，更不能仅加前台验证码而留下原生登录旁路。
