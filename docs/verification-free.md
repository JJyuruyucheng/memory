# 免费托管接入验证记录

日期：2026-11-16。仅针对专用 memory 项目和本次代码。正式前端已部署，线上登录配置和数据库门已启用；用户已确认通过正式页面的密码与 widget 验证进入时间线。

同日账号维护：管理员登录名与密码已按拥有者要求通过官方 Auth Admin API 及受保护 profile 更新；Auth UUID、内部邮箱和业务角色保持原绑定。新口令已通过受信任服务端原生密码接口验证，旧口令返回拒绝；用户 JWT 读回的新 profile 与输入一致。此维护验收不代替公开页面的 CAPTCHA 流程。测试管理员会话已独立查询为零，临时修改入口已覆盖为 410 并以旧 capability 复测关闭，本机受限凭据文件已同步。公开代码、构建产物和文档不保存实际新登录名或口令。登录名精确匹配属于前端入口逻辑，真正后端身份验证仍由密码、原生 CAPTCHA、限流及 UUID/RLS 约束。兼容改名及固定成员的完整本地测试本轮为 120 项通过、0 失败、0 跳过；Cloudflare 与 GitHub 检查通过。

已实际执行：

- Supabase Free 项目创建成功，报价 $0/月，新加坡区域，ACTIVE_HEALTHY。
- Cloudflare Pages Free 项目 `memory` 首次部署成功，地址为 <https://memory-awv.pages.dev>；来源为 `main` 分支提交 `6a15479`，构建命令 `node scripts/build-cloudflare.mjs`，输出目录 `dist`，Node 24。
- 后续历史发布提交 `009ce6b` 的 Cloudflare 部署检查成功；正式域名无查询参数的 `/src/config.js` 实际返回 HTTP 200、`mode=supabase`、`authReady=true`，并带有 `Cache-Control: no-store` 和 CSP 响应头。
- GitHub App 安装范围仅为 `JJyuruyucheng/memory`，没有授权其他仓库。
- Turnstile widget `memory-login` 已创建，使用 Managed 模式；唯一允许的 hostname 为 `memory-awv.pages.dev`，pre-clearance 关闭。Site Key 已写入公共构建配置，首次部署时前端登录门关闭。Supabase 控制台显示原生 Turnstile 已开启，保存后保存按钮禁用。
- 使用 Supabase 公共 `/auth/v1/settings` 实际确认：`disable_signup=true`、Email 登录开启、匿名登录关闭、其他已启用登录方式列表为空。
- 迁移 `20261116041930_memory_private_space` 已应用；本地文件名与远端 migration history 一致。
- 云端运行 `supabase/verify-isolation.sql`，没有断言错误，事务最终回滚，临时 Auth 用户残留为 0。它模拟请求 claims，验证数据库授权，不验证 JWT 签名或 CAPTCHA。
- 上述 SQL 测试阶段运行后查询：authReady=false、profiles=0、entries=0、Auth users=0、buckets=0；后续初始化及真实 HTTP 验收后的状态见文末。
- 使用项目公共 publishable key 发出真实匿名 HTTP 请求：profiles、entries、media、comments、reactions、favorites、settings 均为 401，Postgres code=42501；数据库门开启为 `true` 后再次请求七表，结果仍全部为 401/42501。
- 最新 Security Advisor 有一条 WARN：泄露密码保护未启用。已核实官方文档说明该功能仅 Pro 及以上提供，定价页列明 Free 不包含；当前保留 Free，不升级付费，也不把这条告警写成已解决。[密码安全](https://supabase.com/docs/guides/auth/password-security)、[套餐限制](https://supabase.com/pricing)。runtime_guard 无开放 RLS policy 的 INFO 属于有意拒绝访问。此前 Performance Advisor 的八条 unused-index INFO 来自空项目，暂不删除必要索引。
- 本轮 2026-11-16 在 Windows Node 24 重新运行完整本地测试：114 通过，0 失败、0 跳过，`MEMOS_BINARY` 使用官方 Memos 26.11.1 真实程序；其中包含 Supabase provider 23 项、bootstrap 工具 17 项及 HTTP 探针 15 项 mock 测试。本地替身结果与下面的真实云端证据分开，不代表真实 Turnstile 登录验收。
- 短期 bootstrap 已通过官方 Admin API 创建三个固定、邮箱已确认、非匿名、Auth role 为 `authenticated` 的身份及严格 private bucket；桶上限为 50,000,000 字节、八种允许 MIME。初始化工具不写 profiles、不打开权限门；后续由维护者写入三条 UUID 白名单 profiles。函数已覆盖为 410 退役入口，使用原 capability 复测确认 410。
- 原生密码接口使用公共 publishable key，缺失及伪造验证码请求均实际得到 HTTP 400、`captcha_failed`，均未生成会话。这是服务端拒绝行为证据，不是有效验证码或密码登录成功证据。
- Supabase Rate Limits 控制台将 token refresh 从 150/5min、signups/signins 从 30/5min 均调整为 5/5min；保存后重新读取页面，两项值均为 5、两个 Save 按钮均禁用，IP forwarding 关闭。这是配置保存证据，未进行 HTTP 429 压测。官方 token endpoint 限流涵盖 password、refresh、ID token、PKCE，并采用允许最高 30 次突发的 token bucket；不能据此声称“严格五分钟五次”或“五次失败锁号”。[官方限流说明](https://supabase.com/docs/guides/auth/rate-limits)
- 临时真实 HTTP 权限探针返回 HTTP 200、`ok=true`，11 项检查全部为 true：三身份与 profiles 一致、草稿隔离、PNG 上传确认发布链、成员下载、匿名拒绝、跨作者修改拒绝、attached 删除拒绝、upsert 拒绝、九图限制、原子换图及管理员维护已发布记录。实际发送 94 次请求、上传 10 个真实微型 PNG；Storage、业务行和测试会话清理均成功。
- 探针会话为官方 Admin `generateLink` 签发的 magiclink 会话，结果明确标注 `authMethod=admin-generated-magiclink`、`passwordCaptchaTested=false`；业务与文件断言使用公共 key 加对应真实用户 JWT。函数已覆盖为同名 410 退役入口，原 capability 复测 410；finally 关闭数据库门。
- 最新实际执行 `node scripts/build-cloudflare.mjs` 成功，使用真实公共 Site Key，发布配置 `authReady=true`；线上对应配置也已确认。构建或部署成功不代表真实密码登录已经通过。
- 实际浏览器加载正式页面正常，官方 Turnstile 自动显示“安全验证已完成”。其后用户明确确认：在正式站使用 `xbl`、密码与 widget 验证成功进入时间线；登录成功的证据来自用户确认，并非维护者亲自观察或代为输入口令。
- 用户已选择允许验证码自动通过，重点保留后端防护。Managed 仅在必要时要求交互，自动完成不表示绕过服务端校验；原生接口缺失及伪造 token 的拒绝证据仍单列保留。[Cloudflare widget 模式](https://developers.cloudflare.com/turnstile/concepts/widget/)
- Supabase 实际公共配置构建成功；本地浏览器加载官方本地 SDK 和登录页面，未配置 CAPTCHA 时提交按钮禁用，直接访问 `#admin` 仍为登录页，浏览器没有 error/warn。
- 正式构建校验 SDK SHA-256；GitHub Pages 仍强制 preview，排除演示记录、照片及 SDK 文件。实际初始密码未写入源码、配置或测试。

仍待完成或验证：

- 真实 widget token 的过期及重放专项，以及限流 HTTP 429 行为；重复提交伪造字符串不能算真实 token 的重放验收。已确认的一次真实页面登录和管理员 magiclink 权限探针均不能替代这些测试。Cloudflare 官方说明 token 复用状态最终一致，近同时重复验证可能都成功；本轮不承诺跨实例原子防重放。[服务端验证及网络收敛边界](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- 真实页面操作、退出清空、九图显示和含原始媒体导出。
- 两连接并发压力、双设备使用、大陆网络可达性、完整项目备份与恢复。

探针验收后独立 SQL 读回：Auth users=3、profiles=3，entries=0、media=0、storage.objects=0、sessions=0，数据库门当时已关闭。维护者随后核对三用户、三条 profiles 及零测试对象后，已将数据库 `authReady=true`，前端发布配置也已设为 `true` 并完成线上部署确认；此后用户确认正式页面登录成功。上述零会话是探针清理时点的状态，不代表用户登录后的会话数量。当前没有上传私人资料。源码中的维护流程不等于已经部署了自动清理、自动备份或导入迁移。
