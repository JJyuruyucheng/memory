# 免费托管接入验证记录

日期：2026-11-16。仅针对专用 memory 项目和本次代码。静态登录页面已部署，业务数据门仍关闭，尚未完成正式使用验收。

已实际执行：

- Supabase Free 项目创建成功，报价 $0/月，新加坡区域，ACTIVE_HEALTHY。
- Cloudflare Pages Free 项目 `memory` 首次部署成功，地址为 <https://memory-awv.pages.dev>；来源为 `main` 分支提交 `6a15479`，构建命令 `node scripts/build-cloudflare.mjs`，输出目录 `dist`，Node 24。
- GitHub App 安装范围仅为 `JJyuruyucheng/memory`，没有授权其他仓库。
- Turnstile widget `memory-login` 已创建，使用 Managed 模式；唯一允许的 hostname 为 `memory-awv.pages.dev`，pre-clearance 关闭。Site Key 已写入公共构建配置，前端 `authReady` 仍为 `false`。这不代表 Supabase 已强制验证 CAPTCHA。
- 使用 Supabase 公共 `/auth/v1/settings` 实际确认：`disable_signup=true`、Email 登录开启、匿名登录关闭、其他已启用登录方式列表为空。
- 迁移 `20261116041930_memory_private_space` 已应用；本地文件名与远端 migration history 一致。
- 云端运行 `supabase/verify-isolation.sql`，没有断言错误，事务最终回滚，临时 Auth 用户残留为 0。它模拟请求 claims，验证数据库授权，不验证 JWT 签名或 CAPTCHA。
- 运行后再次查询：authReady=false、profiles=0、entries=0、Auth users=0、buckets=0。
- 使用项目公共 publishable key 发出真实匿名 HTTP 请求：profiles、entries、media、comments、reactions、favorites、settings 均为 401，Postgres code=42501。
- Security Advisor：没有 ERROR/WARN；runtime_guard 无开放 RLS policy 的 INFO 属于有意拒绝访问。Performance Advisor 的八条 unused-index INFO 来自空项目，暂不删除必要索引。
- 本轮 2026-11-16 在 Windows Node 24 重新运行完整本地测试：99 通过，0 失败、0 跳过，`MEMOS_BINARY` 使用官方 Memos 26.11.1 真实程序；其中包含 Supabase provider 23 项及 bootstrap 工具 17 项 mock 测试。这些结果不等于真实 Edge Function、Auth 初始化或 Turnstile 验收。
- 实际执行 `node scripts/build-cloudflare.mjs` 成功，使用真实公共 Site Key，前端 `authReady=false`；构建成功不代表真实验证码已经通过。
- Supabase 实际公共配置构建成功；本地浏览器加载官方本地 SDK 和登录页面，未配置 CAPTCHA 时提交按钮禁用，直接访问 `#admin` 仍为登录页，浏览器没有 error/warn。
- 正式构建校验 SDK SHA-256；GitHub Pages 仍强制 preview，排除演示记录、照片及 SDK 文件。实际初始密码未写入源码、配置或测试。

仍待完成或验证：

- Turnstile Secret Key 正由用户在 Supabase 控制台输入保存，保存结果尚未核验；未测试原生 Auth 对缺失或伪造验证码的拒绝，也未测试真实 widget token 的成功、过期或重放。重复提交伪造字符串不能算真实 token 的重放验收。
- 固定三账号与私有 bucket 初始化、真实 JWT 下的 Storage 上传/下载/原子选图及跨账号/匿名文件请求。
- 短期 capability bootstrap 和真实 HTTP 权限探针仅准备了可审查工具；尚未部署或执行，不能把 mock 测试计为云端初始化成功。
- 两连接并发压力、双设备使用、大陆网络可达性、完整项目备份与恢复。

当前再次核验的云端状态仍为：Auth users=0、profiles=0、entries=0、buckets=0，数据库 `authReady=false`。只有原生验证码配置和拒绝行为核验后，才可由维护者受控开放数据库门进行真实用户权限验收；真实 Auth/Storage 权限验收通过后，才可启用前端 `authReady` 供日常使用。当前没有上传私人资料。源码中的维护流程不等于已经部署了自动清理、自动备份或导入迁移。
