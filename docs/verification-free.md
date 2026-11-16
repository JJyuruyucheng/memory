# 免费托管接入验证记录

日期：2026-11-16。仅针对专用 memory 项目和本次代码。静态登录页面已部署；数据库门及本地发布配置已启用，新配置的线上部署和真实页面登录尚待验收。

已实际执行：

- Supabase Free 项目创建成功，报价 $0/月，新加坡区域，ACTIVE_HEALTHY。
- Cloudflare Pages Free 项目 `memory` 首次部署成功，地址为 <https://memory-awv.pages.dev>；来源为 `main` 分支提交 `6a15479`，构建命令 `node scripts/build-cloudflare.mjs`，输出目录 `dist`，Node 24。
- GitHub App 安装范围仅为 `JJyuruyucheng/memory`，没有授权其他仓库。
- Turnstile widget `memory-login` 已创建，使用 Managed 模式；唯一允许的 hostname 为 `memory-awv.pages.dev`，pre-clearance 关闭。Site Key 已写入公共构建配置，首次部署时前端登录门关闭。Supabase 控制台显示原生 Turnstile 已开启，保存后保存按钮禁用；真实 widget token 登录仍待验。
- 使用 Supabase 公共 `/auth/v1/settings` 实际确认：`disable_signup=true`、Email 登录开启、匿名登录关闭、其他已启用登录方式列表为空。
- 迁移 `20261116041930_memory_private_space` 已应用；本地文件名与远端 migration history 一致。
- 云端运行 `supabase/verify-isolation.sql`，没有断言错误，事务最终回滚，临时 Auth 用户残留为 0。它模拟请求 claims，验证数据库授权，不验证 JWT 签名或 CAPTCHA。
- 上述 SQL 测试阶段运行后查询：authReady=false、profiles=0、entries=0、Auth users=0、buckets=0；后续初始化及真实 HTTP 验收后的状态见文末。
- 使用项目公共 publishable key 发出真实匿名 HTTP 请求：profiles、entries、media、comments、reactions、favorites、settings 均为 401，Postgres code=42501。
- 最新 Security Advisor 有一条 WARN：泄露密码保护未启用。控制台该选项不可操作，原因及可用套餐尚未核实，不能归因为 Free 限制。runtime_guard 无开放 RLS policy 的 INFO 属于有意拒绝访问。此前 Performance Advisor 的八条 unused-index INFO 来自空项目，暂不删除必要索引。
- 本轮 2026-11-16 在 Windows Node 24 重新运行完整本地测试：114 通过，0 失败、0 跳过，`MEMOS_BINARY` 使用官方 Memos 26.11.1 真实程序；其中包含 Supabase provider 23 项、bootstrap 工具 17 项及 HTTP 探针 15 项 mock 测试。本地替身结果与下面的真实云端证据分开，不代表真实 Turnstile 登录验收。
- 短期 bootstrap 已通过官方 Admin API 创建三个固定、邮箱已确认、非匿名、Auth role 为 `authenticated` 的身份及严格 private bucket；桶上限为 50,000,000 字节、八种允许 MIME。初始化工具不写 profiles、不打开权限门；后续由维护者写入三条 UUID 白名单 profiles。函数已覆盖为 410 退役入口，使用原 capability 复测确认 410。
- 原生密码接口使用公共 publishable key，缺失及伪造验证码请求均实际得到 HTTP 400、`captcha_failed`，均未生成会话。这是服务端拒绝行为证据，不是有效验证码或密码登录成功证据。
- 临时真实 HTTP 权限探针返回 HTTP 200、`ok=true`，11 项检查全部为 true：三身份与 profiles 一致、草稿隔离、PNG 上传确认发布链、成员下载、匿名拒绝、跨作者修改拒绝、attached 删除拒绝、upsert 拒绝、九图限制、原子换图及管理员维护已发布记录。实际发送 94 次请求、上传 10 个真实微型 PNG；Storage、业务行和测试会话清理均成功。
- 探针会话为官方 Admin `generateLink` 签发的 magiclink 会话，结果明确标注 `authMethod=admin-generated-magiclink`、`passwordCaptchaTested=false`；业务与文件断言使用公共 key 加对应真实用户 JWT。函数已覆盖为同名 410 退役入口，原 capability 复测 410；finally 关闭数据库门。
- 最新实际执行 `node scripts/build-cloudflare.mjs` 成功，使用真实公共 Site Key，本地发布配置 `authReady=true`；线上新配置尚待推送部署确认，构建成功不代表真实验证码已经通过。
- Supabase 实际公共配置构建成功；本地浏览器加载官方本地 SDK 和登录页面，未配置 CAPTCHA 时提交按钮禁用，直接访问 `#admin` 仍为登录页，浏览器没有 error/warn。
- 正式构建校验 SDK SHA-256；GitHub Pages 仍强制 preview，排除演示记录、照片及 SDK 文件。实际初始密码未写入源码、配置或测试。

仍待完成或验证：

- 真实 widget token 加密码的页面登录成功、token 过期及重放；重复提交伪造字符串不能算真实 token 的重放验收。管理员 magiclink 权限探针也不能替代这些测试。
- 新配置推送并部署后确认线上 `authReady=true`，再进行真实页面操作、退出清空、九图显示和含原始媒体导出。
- 两连接并发压力、双设备使用、大陆网络可达性、完整项目备份与恢复。

探针验收后独立 SQL 读回：Auth users=3、profiles=3，entries=0、media=0、storage.objects=0、sessions=0，数据库门当时已关闭。维护者随后核对三用户、三条 profiles 及零测试对象后，已将数据库 `authReady=true`，本地前端发布配置也已设为 `true` 并构建成功。线上新配置尚待推送部署确认，真实页面密码登录验收仍待完成。当前没有上传私人资料。源码中的维护流程不等于已经部署了自动清理、自动备份或导入迁移。
