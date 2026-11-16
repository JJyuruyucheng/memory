# 临时初始化能力端点

这是可审查模板，默认 disabled、截止时间为 0，所有请求返回 410。没有部署或执行本目录代码就不能称三账号或私有桶已创建。测试只模拟官方 REST，不代表真实 Edge/Cloudflare/Auth/Storage 验收。

更简洁的首选是项目拥有者在 Supabase 控制台分别创建三名用户与私有桶，无需开放临时管理员能力端点。如果代理确需自动化而无法取得可信本机 Admin API 通道，才采用这个短期模板。不要为初始化长期暴露管理员接口，也不要把项目 secret 下载到前端。

## 端点仅做什么

`core.mjs` 使用 Deno 支持的 `node:crypto` 与原生 fetch，零第三方依赖。固定 Auth 邮箱：

| 用户名 | 固定内部邮箱 |
| --- | --- |
| xbl | xbl@memory.invalid |
| ll | ll@memory.invalid |
| memory-admin | memory-admin@memory.invalid |

三者均以 `email_confirm:true` 创建；`.invalid` 无法收邮件，因此不能依赖邮箱自助找回。Auth role/aud 必须保持普通 authenticated，独立管理员的业务角色由后续受信任 profiles 白名单配置决定，绝不创建 service_role/admin Auth 用户。已有用户只验证并返回 UUID，不 UPDATE、不重置口令、不改角色；专用项目出现未知用户、重复 ID/邮箱、匿名/未确认/高权限用户会停止，交项目拥有者核查。

固定私有桶 `memory-media`，50,000,000 bytes，上限八种 MIME 与现有数据库契约一致；先读取现有桶，配置不符拒绝、不自动修复或覆盖。新建之后重新读取校验。端点不创建/写入 profiles，不改 Auth CAPTCHA 配置，不打开 runtime_guard，也不操作 SQL。

## 审阅及启用顺序

1. 先完成 Supabase 原生 Turnstile、关闭注册/匿名登录等控制台配置，并验证直接密码登录请求缺少/无效验证码被拒。此步完成前不要部署、执行或激活模板，数据库 guard 保持 false。
2. 由受信任进程用安全随机数产生 32 bytes，编码为64位小写 hex，原始能力值只留该进程内存。对这64个 ASCII 字符计算 SHA-256 hex 摘要。不要打印、写源码、命令行参数、URL、截图或聊天；不要把真实能力、活跃摘要或密码提交到仓库。
3. 仅在此次 MCP 部署 payload 内替换 `index.ts` 的 enabled/prerequisitesVerified=true、固定 projectOrigin、capabilitySha256、issuedAt/expiresAt 毫秒时间戳。有效窗口必须≤600,000ms；模板默认全过期。精确核对 SUPABASE_URL 等于固定项目，避免误部署到别的库。入口使用当前官方支持的 `export default {fetch}`，部署选项 **verify_jwt=false**，由函数自行核验短期能力。
4. 能力放 `Authorization: Bearer <hex>`，不放 URL；内部 Supabase secret 与这个请求凭证不同。函数读取平台 `SUPABASE_SECRET_KEYS` JSON 中 default，新 secret 仅放内部 `apikey` 请求头；无新字典时可回退 legacy SUPABASE_SERVICE_ROLE_KEY（apikey+Bearer JWT）。不读取、接受或返回调用者提供的项目密钥。
5. 可信 Node 客户端通过 TLS POST，body 只有 `{"passwords":{"xbl":"…","ll":"…","memory-admin":"…"}}`。成员最少6位，独立管理员最少12位，上限128字符。能力和口令不使用环境默认值，不记录请求/上游正文，不输出密码。请求/上游 JSON 都流式限制长度，拒绝浏览器 Origin、跨项目 origin、重定向及超时；这不是公开网页登录入口。
6. 成功只回用户名、UUID、是否新建及固定桶 ID。HTTP/API 跨系统不具事务：中途失败可能已创建桶或个别账号，重试只补缺而不会重设既有密码。先核对状态，不要盲目删除已有对象。
7. 根任务必须在 **finally**（成功、异常和超时都包括）用 `retired.ts` 覆盖同一 Edge Function，再带原能力实测 HTTP 410；这一步不能仅依赖10分钟自然过期。模板不持有控制平面 token，不能自行部署覆盖。覆盖与实际 Auth/Storage/登录验收由根任务记录。

这里是“短期能力凭证”，不是分布式一次性 token；多个 isolate 在有效窗口内仍可重试。重复创建的竞态只回读现有固定账号/桶，绝不重置密码；失效检查在每次上游请求前执行，但截止前已发出的操作仍可能在截止后完成。原生 `timingSafeEqual` 比较固定32字节摘要，不声称整个网络处理时间恒定。应用代码不写秘密日志；未审计平台默认日志或网关元数据，不能据此保证所有平台日志均不含请求信息。

## 本机客户端

Node24 运行：

```powershell
node supabase/bootstrap/run.mjs --endpoint https://ijtrfjehqtoptsmsotin.supabase.co/functions/v1/临时函数名
```

将实际短期函数 slug 替换上例；交互输入能力和密码均不回显。客户端固定项目 origin，拒绝带查询参数、用户信息或其他主机的端点，不跟随重定向。非交互受信任进程可加 `--stdin`，经匿名管道送入 `{"capability":"…","passwords":{…}}`；不要使用含秘密的 shell 字面量、argv、历史记录或仓库内输入文件。stdout 仅投影经过检查的 UUID/状态；错误不回显上游正文。

## 已核查的官方接口

- Edge 环境注入新 JSON keys 与 legacy fallback：[默认 secrets](https://supabase.com/docs/guides/functions/secrets)、[新 key 迁移及 header 规则](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)。新 secret 不是 JWT，不能放 Authorization Bearer。
- 当前 Edge 支持 Node built-ins：[依赖说明](https://supabase.com/docs/guides/functions/dependencies)；Deno 的原生恒时比较：[node:crypto](https://docs.deno.com/examples/node_crypto/)。
- 原生 Auth Admin：`GET /auth/v1/admin/users?page=N&per_page=100`、`POST /auth/v1/admin/users`，[官方客户端实现](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts)、[createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。分页有界、最多只接受固定三身份。
- 原生 Storage：`GET /storage/v1/bucket/memory-media`、`POST /storage/v1/bucket`，POST 使用 `id,name,public,file_size_limit,allowed_mime_types`。[官方客户端实现](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageBucketApi.ts)、[createBucket](https://supabase.com/docs/reference/javascript/storage-createbucket)。
- 实施前已读 [changelog](https://supabase.com/changelog.md)，并经 MCP search_docs 查阅环境变量、新 key 迁移、Auth Admin 与 bucket 配置；仍须在实际部署运行环境验收。
