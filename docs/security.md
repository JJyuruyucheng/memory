# 安全边界与部署验收

记录日期：2026-11-16。以下区分代码限制、本地验证和生产待验项；测试通过不等于 Render 已部署，也不等于完成全面安全审计。

## 模式与发布内容

- `supabase` 是免费托管适配。官方 SDK 禁用令牌持久化及 URL 会话检测；访问与刷新令牌只留内存，退出清理页面与 Blob URL。业务表和私有 Storage 通过受保护 `profiles` 的 UUID/角色授权，所有成员及媒体策略还受数据库默认关闭的 `runtime_guard.authReady` 限制。该开关不能由前端或 service_role 修改；未完成原生 CAPTCHA、关闭注册及权限实测时不能打开。
- Supabase 密码接口的 CAPTCHA 必须在 Auth 原生配置启用；前端 `authReady` 和按钮禁用不构成后端防护。Supabase 使用自己的原生限流，不沿用下文 Memos 网关的 IP/账号计数或 hostname/action 校验声明。Turnstile widget 必须限定正式域名。验证码不保证抵御所有分布式攻击，短初始口令仍有风险。
- 新帖先作为作者私有草稿，媒体预留并上传验证后，通过 `publish_entry` 原子切换最终附件。正式最多九张图片；临时上传也有独立上限。数据库与对象存储不共享事务，发布成功后旧附件清理失败会明确提示；缺失原字节时完整导出失败，不虚报完整备份。

- `demo` 是本地演示，身份切换不是登录。文字与上传文件保存在当前浏览器 IndexedDB，不向 Memos 同步，不适合保存私人资料。
- `preview` 只显示登录预览，不初始化 demo 或 Memos provider，不提交口令，没有跳过登录、体验演示或后台直达入口。Pages 固定使用此模式；`MEMORY_TARGET=pages` 拒绝构建 `demo/live`。
- `live` 使用同源安全网关与 Memos。API 基址由构建固定，URL 参数不能切换模式或替换后端。真实密码、验证码 Secret、令牌、数据库及备份不进入静态产物。
- 非演示构建在复制时排除演示 provider、样例数据模块和四张样例 JPG；只复制明确的前端与素材白名单，唯一允许的 JSON 是 `assets/credits.json`。隐藏文件、凭证命名、符号链接、部署文件及普通 JSON 被排除。语法、模块、样式和署名依赖检查先于覆盖旧输出。

已有浏览器演示数据不会因模式切换自动删除；清除网站数据、更换浏览器或设备会影响其可见性。**未实现演示数据向正式 Memos 的自动迁移，也未提供内容 JSON 的导入恢复。**

## Memos 备选登录与网关

公开入口由 [Node 安全网关](../deploy/auth-gateway.mjs) 承接。密码验证、保存及会话签发仍由官方 Memos 26.11.1 完成，没有另造密码数据库。

- `/auth/config` 只返回配置状态、公开 site key 和 `action=login`，不公布账号列表或 Secret。allowlist 明确配置两个日常账号及可选独立管理员；用户名精确匹配。
- `/auth/login` 要求 Origin 与 `PUBLIC_ORIGIN` 一致。服务端验证 Cloudflare Siteverify 的 `success`、预期 hostname 与 `action=login`，通过后才向 Memos Connect `SignIn` 发送口令。验证码失败、超时、缺配置时不转发口令；生产测试密钥不能启用登录。
- 缺少 Turnstile key 仍可显示登录页，便于取得托管域名后配置 widget；此时登录返回 503。页面可打开不表示真实账号已可用，每次登录尝试后需新 token。
- 公网原生 REST/Connect 登录、注册及创建用户被阻止。Connect 仅允许会话 `RefreshToken/SignOut`；其他 API 与文件请求须携带 Bearer 凭据，再由 Memos 验证身份、签名和数据权限。访问令牌只保留在前端内存，刷新 Cookie 经网关转发。
- 分享 API 与 `share_token` 被拒绝。底层 Memos 端口不能另行暴露公网，否则网关限制可能被绕过。已有会话、JWT 或 PAT 是已认证凭据，不会逐次触发验证码；迁入旧实例时须核对账号并撤销废弃凭据。
- 静态服务仅提供 `dist` 白名单，拒绝目录穿越、隐藏文件和符号链接。私密响应禁缓存；CSP 额外放行 Turnstile 所需的 `challenges.cloudflare.com` 脚本、连接与 frame。正文与评论转义为普通文字，私密媒体经授权请求生成 Blob URL。

### 限流及重放范围

默认限制：全局每分钟 60 次、socket IP 每分钟 12 次、归一化账号每 15 分钟 10 次。失败同样计数；账号限流忽略大小写差异，实际登录仍精确匹配。账号错误使用统一公开提示。

验证码 token 仅保留 SHA-256 摘要，远程验证前原子占用六分钟，防止本进程并发与短时重放。表有容量上限，满额拒绝，不驱逐有效记录来放行。

**三个限流计数和重放表默认均在内存，进程重启清空；尚未部署持久化或跨实例共享存储。**代码支持注入原子存储，不等于已经接入。多实例部署前须补共享策略。

客户端 IP 只取 socket 地址，不信任任意 `X-Forwarded-For/CF-Connecting-IP`。Render 代理后两人可能合并为同一 IP 额度；可信代理头边界核实前保留此保守行为。向 Memos 转发的 Host 与协议来自固定 `PUBLIC_ORIGIN`。

## 托管与数据权限

[托管启动器](../deploy/hosted-start.mjs) 先启动仅监听 loopback 的 Memos，核验版本、三个账号及其角色、Space 成员、private access 与关闭注册，再启动唯一公开网关。子进程不继承三个账号口令；原生服务输出不直接转录到平台日志。平台 Secrets 不写入仓库。

初始化标记区分未完成初始化与既有实例；损坏标记、完成标记对应空数据库、账号或权限不符时停止，不自动删除或覆盖账号。已有口令不随重启重置。更改管理员口令后需同步平台 Secret，避免下次启动核验失败。

服务端授权由 Memos 执行，隐藏按钮不是权限边界。`type/title/occurredAt/mood/tags/deletedAt` 仍是作者可改的正文元数据头；九图、格式与 50 MiB 的应用校验不能替代服务端独立校验及 Memos 配额。损坏元数据头会停止读取以避免覆盖，未实现不可篡改字段或完整审计日志。

管理员和服务器所有者具有相应读取能力，未实现端到端加密。收藏是共享 Space 原生星形反应，其他成员可见。删除仅更新元数据并移入回收站，原文与媒体仍在 Memos；未启用自动 30 天销毁。已经下载的内容无法通过网站收回。

## 已完成的本地验证

- **构建与单测：**检查失败不覆盖旧输出、非演示产物排除样例模块/JPG、Pages 只接受 preview。网关测试覆盖配置缺失、生产测试 key、hostname/action、Origin、登录旁路、三类限流、并行重放、匿名文件、Range 与断连取消。
- **官方 Memos 真实接口：**使用核验官方校验值的 Windows 26.11.1 release 与独立临时数据库，验证三账号、原生认证 Cookie、SPACE 共享、正文/PNG 鉴权、评论、回应/收藏、管理员维护、软删恢复及原始媒体导出。
- **本轮真实后端经过网关：**已通过 [真实集成测试](../tests/memos-live.test.mjs)，以及托管配置与初始化测试；网关后的密码认证、Cookie、数据操作由真实 Memos 执行，邀请已创建但接受前中断的初始化也能续跑。**只有 Cloudflare Siteverify 使用测试替身，不是实际 Cloudflare key 验收。**
- **托管子进程：**真实启动器两次启动官方 Memos 与 Node 网关；未配验证码时页面 200、登录 503，重启不覆盖已有日常口令，停止处理器关闭两个服务端口。Windows 测试通过专用 IPC 包装派发 JS 的 SIGINT/SIGTERM 处理器，未把它说成真实操作系统信号或生产容器验收，也未加入生产 IPC 入口。托管单测、真实接口及子进程三组共六项无跳过通过；主任务最终全套测试 57 项通过。
- **本轮预览浏览器：**preview 与 `/#admin` 均保持登录预览、禁提交、无跳过入口；没有加载两个演示模块和样例 JPG，并查验构建产物。
- **本地演示浏览器：**发布、刷新保留、评论、快速关闭草稿、回收站恢复和档案下载已检查；本轮还验证九图发布及打开第九张原图。布局证据见 [设计检查](design-review.md)。这些不是正式双设备验收。

真实 Memos 测试只有设置 `MEMOS_BINARY` 并执行才成立，默认跳过不算再次通过。Pages 历史演示部署成功也不代替本轮 preview 的 Actions 和线上配置核验。

## 生产待验

1. Render/Docker 容器真实构建运行、持久磁盘、唯一公网端口、崩溃联动与重启保留数据。已有部署配置，**本轮尚未运行 Render 生产容器**。
2. 真实 Cloudflare widget、hostname/action、Secret、失败及重放行为；测试替身不验证实际可达性或密钥。账户、密钥及目标验收未完成前不得称真实登录已上线。
3. 实际域名 TLS、Cookie 的 Secure/HttpOnly/SameSite、Origin/CSRF、防缓存与退出后的页面/会话/媒体失效；无痕检查列表、详情、评论、原图、缩略图、视频及分享，另以非成员检查原生 API。
4. 文件真实内容、数量/尺寸、服务端额度、手机视频解码和内存。当前视频完整下载到内存，没有转码、逐段播放或断点续传保证；照片元数据可能含定位信息。
5. 数据库、媒体、配置及初始化标记的完整备份和隔离恢复，保存限制读取的加密异地副本。JSON 内容导出不是完整系统备份，也没有自动迁移或灾难恢复承诺。
6. 真实双设备、网络中断、长会话与同时编辑。本版刷新查看对方新内容，未实现实时推送、协同冲突合并或版本回滚，极短窗口仍可能后写覆盖。

## 参考

- [GitHub Pages 静态托管能力](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Cloudflare Turnstile 服务端校验](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Memos 固定版本认证接口](https://github.com/usememos/memos/blob/26.11.1/proto/api/auth_service.proto)
- [Memos 附件权限](https://usememos.com/docs/usage/attachments)与[分享规则](https://usememos.com/docs/usage/sharing)
- [部署及恢复步骤](deployment.md)
