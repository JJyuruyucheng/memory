# 免费起步方案

核查日期：2026-11-16。当前采用 **Cloudflare Pages Free + Supabase Free + Cloudflare Turnstile Free** 路线。GitHub 的 `memory` 仓库继续管理源码；现有 GitHub Pages 仍是登录预览。用户已批准在指定 Free 组织创建专用 `memory` 项目（新加坡），实际创建报价为 **$0/月**；项目已创建并应用业务数据库迁移。数据库门及线上登录配置已启用，用户已确认通过正式页面的密码与 widget 验证进入时间线。

## 当前已完成和待完成

已完成：官方 Supabase SDK 本地固定版本、前端 provider、七张业务表及 RLS、作者私有草稿、原子选图、媒体登记与 Storage 权限规则。真实云端 SQL 隔离测试通过并全部回滚；匿名 HTTP 请求七表均得到 401/42501，在数据库门开启为 `true` 后使用公共 publishable key 复测仍全部为 401/42501。现已通过官方 API 初始化三个已确认、非匿名的固定 Auth 身份及 private bucket，并写入三条 UUID 白名单 profiles；桶上限为 50,000,000 字节、八种 MIME。

Cloudflare Pages 已关联且只授权 `JJyuruyucheng/memory`，首次部署成功，入口为 https://memory-awv.pages.dev。Turnstile 的 `memory-login` 使用 Managed 模式，仅允许该精确 hostname，pre-clearance 关闭。Supabase 公共 Auth settings 已实际确认公开注册关闭、匿名登录关闭，只有 Email 登录开启。

后续历史发布提交 `009ce6b` 的 Cloudflare 部署检查成功。正式域名无查询参数的 `/src/config.js` 实际返回 HTTP 200，`mode=supabase`、`authReady=true`，含 `Cache-Control: no-store` 与 CSP 响应头；实际浏览器页面正常，官方 Turnstile 自动显示“安全验证已完成”。其后用户明确确认使用 `xbl`、密码与 widget 验证成功进入正式站时间线；该成功事实来自用户确认，并非维护者亲自观察或代为输入口令。

用户已选择保留 Managed 自动通过，重点保证后端防护。Managed 模式只在必要时要求交互，自动完成不等于关闭验证码；原生 Auth 仍须验证 token。[官方 widget 模式](https://developers.cloudflare.com/turnstile/concepts/widget/)

Supabase 控制台已开启并保存原生 Turnstile；使用公共 key 的原生密码接口对缺失及伪造验证码均实际返回 400/`captcha_failed`，未产生会话。真实 HTTP 权限探针已用官方签发的三个用户 JWT 完成 11 项检查，94 次请求及 10 个真实微型 PNG 的上传、下载、九图限制、原子替换和隔离检查全部通过；Storage、业务行和会话均已清理。探针使用管理员生成的 magiclink，明确没有测试密码 CAPTCHA。

探针结束后独立读回 Auth 用户和 profiles 各为 3，entries、media、storage.objects、sessions 均为 0；这是用户正式登录之前的清理时点，不代表登录后仍无会话。两项临时工具均已退役为 410，原 capability 复测确认关闭。维护者随后开启数据库门，前端 `authReady=true` 构建及线上部署均已确认，用户其后确认真实页面登录成功。真实 token 过期、重放及进一步页面操作仍未验收，不能以一次成功登录、管理员 magiclink 或伪造 token 的拒绝替代。

最新数据库安全 Advisor 有一条 WARN：泄露密码保护未启用。官方文档已核实该功能仅 Pro 及以上提供，定价页明确 Free 不包含；当前保持免费方案，不升级付费，此告警仍保留。[密码安全](https://supabase.com/docs/guides/auth/password-security)、[套餐限制](https://supabase.com/pricing)。一条 INFO 是 `memory_private.runtime_guard` 启用 RLS 且没有开放策略，这是有意拒绝全部 API 访问。此前空项目索引尚未使用的 INFO 保留观察，不为消除提示删除必要索引。[Advisor 说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

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
5. 浏览器仅允许公共 publishable key，绝不放入 `service_role`、数据库密码或验证码 Secret。纯静态前端无法沿用 Memos 同源 HttpOnly Cookie；v0.4.0 根据使用需求改为本设备保留官方 Auth 会话 30 天，专用适配器限制绝对期限、跨标签身份与令牌轮换，恢复仍须服务器验证。密码不存储；这不是服务端强制 timebox，详见 [实际会话边界](release-v0.4.0.md)。[前端数据安全](https://supabase.com/docs/guides/database/secure-data)、[Auth 客户端](https://supabase.com/docs/reference/javascript/auth)

本轮已在 Supabase Rate Limits 控制台把 token refresh 从 150/5min、signups/signins 从 30/5min 均改为 5/5min；保存后重新读取页面，两项值均为 5、两个 Save 按钮均禁用，IP forwarding 关闭。仅确认配置保存，尚未进行 HTTP 429 压测。官方 token endpoint 限流覆盖 password、refresh、ID token、PKCE，使用 token bucket 并允许最高 30 次突发，因此配置值不代表“严格五分钟五次”或“五次失败锁号”，也不能保证阻止分布式攻击。短初始口令的风险不会被验证码消除。[Auth 限流](https://supabase.com/docs/guides/auth/rate-limits)

真实 token 的过期和重放专项仍未测试。Cloudflare 官方说明 token 复用状态最终一致，近同时的重复验证可能都成功；本项目不宣称跨实例原子防重放。一次登录成功和伪造 token 被拒不能替代这项边界验收。[服务端校验及网络收敛](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 实施顺序与验收

Supabase 已连接，专用项目、迁移和 provider 已准备。Cloudflare 当前构建命令为 `node scripts/build-cloudflare.mjs`，产物目录 `dist`，`.node-version` 固定 Node 24。它只读取 [明确的公共配置](../deploy/cloudflare.public.json)：项目地址、publishable key、Turnstile Site Key 和布尔 authReady；不接收环境里的后台密钥。这些值会进入浏览器，不是秘密。先以 authReady=false 发布空登录壳取得正式域名，再限定 Turnstile hostname，配置 Supabase Auth 原生 CAPTCHA，关闭公开注册/匿名及无关认证方式。官方连接目前不提供 Auth 配置更新接口，这些配置需要已登录的控制台完成；不提取连接的 OAuth/PAT 绕过。

若独立使用 `node scripts/build.mjs`，仍可采用 [公开环境变量模板](../deploy/cloudflare.env.example)；不能混淆两个入口的配置来源。

本轮已按 [数据库契约和初始化顺序](supabase-database-contract.md) 用官方 Auth Admin / Storage API 初始化固定三身份及私有桶，并由维护者写入真实 UUID 白名单。原生验证码拒绝行为确认后，曾受控打开数据库门完成真实 HTTP 权限验收，finally 重新关闭；完成清理复核后，维护者再次开启数据库门并完成前端启用配置的线上部署，用户已确认正式页面密码登录成功。需要的 Secret 仅进入可信服务端或平台配置，不发送到聊天或公开仓库。

已提供默认关闭的 [短期初始化工具](../supabase/bootstrap/README.md)，仅创建固定三身份及严格私有桶，不修改既有密码、不写 profiles、不打开权限门。本轮已短期部署执行成功，随后覆盖为 HTTP 410，并用原 capability 复测关闭；原生 Admin API 另行读回身份及桶配置。它的 17 项本地 mock 测试与这次真实执行是不同证据。[真实 HTTP 权限探针](../supabase/verification/README.md) 也已执行并同样退役。Supabase 原生密码硬下限为 6 字符，不能保留 5 字符初始口令，也不能用前端补位绕过。

真实 HTTP 验收已覆盖匿名记录与原图拒绝、跨作者修改拒绝、草稿隔离及管理员维护权限，用户已确认一次正式页面密码与 widget 登录成功。后续仍需验证真实 token 过期和重放、退出后不再显示内容、九图完整展示、网络失败不误报保存成功，并验证双设备访问与包含原始媒体的导出。源码文件存在或模拟测试通过，不能替代真实云权限及页面验收。

旧 IndexedDB 演示记录不会因方案切换自动删除，但**尚未实现迁入 Supabase 的工具**，也不应声称它们已经云端备份。上传前压缩可以作为控制用量的选择，不自动替换已有原图。

## 其他免费路线

Cloudflare Workers/D1 有免费额度，但 R2 需要开通按量订阅并可能产生超额账单，不作为当前避免新付费承诺的首选。[R2 开通要求](https://developers.cloudflare.com/r2/get-started/)

Neon 的免费存储与托管认证也值得保留为备选，但本轮尚未核实其托管认证能否强制 Turnstile；不能把开源认证库的插件能力等同于托管服务已支持，更不能仅加前台验证码而留下原生登录旁路。
