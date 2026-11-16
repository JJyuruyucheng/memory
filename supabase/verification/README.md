# 临时真实 HTTP 权限验收探针

当前源码增加附件排序专项，为 **19 项**检查：在原 17 项基础上，用原有九张真实 PNG 先做全量逆序发布，再在替换时把新文件夹在旧文件中间，两次都重新经成员 API 以 `order=position.asc` 读取并逐项核对 ID 和连续序号。仍最多 3 个随机记录、12 个 PNG，清理边界不变。该源码与 mock 通过不等于新迁移和排序已在生产验证，实际执行结果需在发布记录中注明。

仓库保留默认关闭的审阅模板，固定目标仅为 `ijtrfjehqtoptsmsotin` 项目。**2026-11-16 已短期部署并完成真实 HTTP 权限验收，随后退役为 410。** 这次使用管理员生成的 magiclink 会话，不代表密码登录或真实 widget 验证码已经通过。

本次源码新增悄悄话专项后曾以16项版本执行云验收：前14项（含新建悄悄话的正文、子表、真实文件读写隔离）通过，但原本共享且已被对方访问的同一鉴权下载 URL 在改私密后仍返回200，验收因此失败。该轮151次请求、12个真实 PNG 的 Storage/业务行/会话清理均完成，探针已退役为410。不能把这次失败删去或宣称全面撤回旧访问。

现17项版本单独记录已预热共享 URL 的 HTTP 状态、cf-cache-status、Age 和 `knownCachedSharedAccess`；旧 URL 仍返回正确原字节时明确标为已知缓存访问，并非新的 RLS 授权成功。另用官方 `cacheNonce` 参数强制回源检查，以及从未被对方预热的第二张保留图片作独立冷路径对照。两项新的权限检查必须拒绝访问才通过，新增悄悄话的核心拒绝断言仍保持严格。此17项诊断版本的真实执行结果须由根任务另行记录。

## 本轮实际结果

v0.5.0 追加验收：19 项全部通过，169 次请求、12 个微型 PNG、3 个随机记录，新增九图逆序及旧新附件混排后重新读取位置的断言。所有临时文件、业务行和测试会话清理完成；函数随后退役，原能力实测返回 410。独立 SQL 核对本轮 marker 的记录剩余 0。保留此前已预热 URL 仍为 200/HIT 的已知边界，新的 cacheNonce 和冷路径均为 400/DYNAMIC；不宣称可以撤回缓存。详见 [v0.5.0 发布验证](../../docs/release-v0.5.0.md)。以下是更早的首次验收历史，并非当前空库状态。

真实调用返回 HTTP 200、`ok=true`，11 项检查全部为 true，实际完成 94 次请求并上传 10 个真实微型 PNG。检查包括身份与 profiles 一致、草稿隔离、PNG 流程、成员下载、匿名拒绝、跨作者修改拒绝、attached 删除拒绝、upsert 拒绝、九图限制、原子替换和管理员维护已发布记录。结果明确为 `authMethod=admin-generated-magiclink`、`passwordCaptchaTested=false`。

Storage、业务行和会话清理均为 true。根任务 finally 关闭数据库门，将同名函数覆盖为 `retired.ts` 入口，并使用原 capability 实测得到 410。独立 SQL 读回 Auth 用户与 profiles 各 3，entries、media、storage.objects、sessions 均为 0，数据库门当时为 false。维护者随后复核状态，已开启数据库门，并启用本地前端 `authReady=true` 配置且构建成功；线上新配置尚待推送部署确认。完整本地 114 项测试已一次运行全部通过、0 失败、0 跳过，其中含本探针 15 项 mock 单测；这些单测不能替代本段真实执行证据。

独立于本探针，原生密码接口已用公共 key 实测缺失及伪造 CAPTCHA 均返回 400/`captcha_failed` 且没有会话。真实 widget token 加密码的成功、过期和重放仍待验；重复伪造字符串不能算真实重放。下一步在新的前端配置部署确认后进行页面验收，本文不宣称线上新版本已部署。

## 验证范围

先通过官方管理员 Auth API 确认仅存在三个已确认、非匿名的固定邮箱身份，并核对每个真实用户 JWT 读到的 `profiles` UUID、slot、username、role。缺少或多出身份立即停止，避免 `generateLink` 为不存在的 magic-link 用户自动建号。生成链接返回的 UUID 还会再次核对；验收窗口内不得并行修改 Auth 账号。

`memory-admin` 是探针内部的管理员标识，Auth 邮箱别名保持 `memory-admin@memory.invalid`；当前网页登录名由受保护的 `profiles` 第 3 槽保存，不写入公开仓库。该槽必须匹配原 Auth UUID、保持 `role=admin`，用户名符合数据库格式且不同于 `xbl`、`ll`；前两槽的用户名与角色仍固定。

使用管理员 `generate_link` →公开 `verify` → `GET /auth/v1/user` 得到官方签发的真实会话。**这是一条可信管理员测试通道，不是密码或 CAPTCHA 验收**；结果固定标注 `authMethod: admin-generated-magiclink`、`passwordCaptchaTested: false`。不请求邮件发送接口，不访问或转发 action link，不处理密码。

业务 REST、RPC 和真实 Storage 断言都单独重建 `apikey: publishable key` 加对应用户 Bearer：

- 两位成员的私草稿互相隔离，管理员也看不到他人的未发布草稿；普通成员不能修改对方记录，管理员可以维护已发布记录。
- 预留、上传真实微型 PNG、确认、发布九图；三位成员鉴权下载并核对原字节，匿名和公开桶 URL 访问被拒。
- attached 原图直接删除及以另一张有效 PNG upsert 被拒，随后重新下载核对原字节。
- 第十图不能直接发布；通过原子选图将九图之一替换成功。
- 新建 whisper 经正常媒体流程发布后，作者与管理员能读；对方以已知 UUID 查询正文、附件 metadata、comments、reactions、favorites 以及 count=exact 仍为空，不能 PATCH、写回应/爱心/收藏或执行附件 RPC。
- 对方不能下载已知悄悄话文件路径，也不能向尚未存在的合法 pending 路径上传；后者不会将“已有文件重复错误”误判为权限隔离。作者随后在该路径上传成功并 finalize，对方仍不能下载/删除，管理员可读取发布帖的临时文件。
- 将本次原本共享的记录改成 whisper：本人已经写入的回应、爱心和收藏在后续 REST 查询中隐藏，盲删爱心/收藏也不生效；图片必须在新的回源鉴权及冷路径请求中拒绝对方访问。此前已下载、缓存或已签发链接无法承诺收回；探针保留同 URL 已预热访问的实际结果。管理员仍可维护已发布悄悄话。

没有增加 settings 写入、未知用户创建、口令重置、系统表 SQL 或额外完整矩阵。数据库和 Storage 的最终权限仍以目标项目真实执行结果为准。

## 入口和限制

`index.ts` 的 enabled / prerequisitesVerified 默认为 false，摘要全零、时间全过期，因此所有请求返回410。只有根任务在原生 CAPTCHA 配置、关闭注册与匿名登录已核实，并另行确认数据库门后，才可在**临时部署 payload**中替换开启值、SHA-256 能力摘要及时间窗；不把激活配置提交仓库。本探针从不修改 Auth 设置或数据库门。

能力应为随机32字节、64位小写十六进制字符串，仅保留它的 SHA-256 摘要在临时函数内。有效期最长10分钟，开始时至少剩余125秒。服务端只读取固定项目的 `SUPABASE_URL` 和管理员凭证（`SUPABASE_SECRET_KEYS.default`，或兼容的 `SUPABASE_SERVICE_ROLE_KEY`）；公共 key 固定在模板公开配置中。新式 secret 只用于 apikey，不伪装成用户 JWT。

部署使用 `index.ts` / `core.mjs` 两文件和 `verify_jwt=false`，由探针核验独立能力。受信任客户端经固定项目 HTTPS 端点发 `POST`，body只有 `{"run":true}`，Authorization 为短期能力 Bearer；不得把能力放 URL、argv、命令历史、仓库文件或普通日志。拒绝浏览器 Origin、查询参数、其他 body 字段和错误能力。内部代理可提供 http Request URL；外部客户端和所有上游仍须固定 HTTPS。

请求体最多1024字节，上游 JSON 最多65536字节、下载最多1024字节；每次请求及读取有8秒上限，主体工作85秒、含清理总预算120秒。不会跟随重定向，所有上游限定同一个项目。一次验收最多创建三个随机 UUID 记录与十二个68字节 PNG 对象，并只在这些记录下创建回应、爱心和收藏。短期能力并非跨实例原子单次令牌；应只调用一次，完成后立即退役。

## 清理和退役

finally 清理仅限本次预生成 UUID，并先用 UUID、作者和精确 run marker 一起核对记录，避免 UUID 碰撞或未知内容被删除。根任务已授权独立管理员清理：仅向本次已验证路径调用 Storage remove，再逐一使用官方 `object/info` 确认缺失；这些调用使用独立 server headers，**不计为用户 RLS 通过证据**。不列举桶、不下载其他对象，也不直接 SQL 删除 `storage.objects`。

确认所有本次文件已不存在后，才以管理员 REST 凭证删除对应 comments、reactions、favorites、media 子行及记录；不读取或修改真实 settings、profiles、Auth 用户。精确路径仍存在、错误不能明确判定缺失、超时或清理失败时，保留登记和 `remainingFixtureIds`，结果返回 `cleanup.complete=false`，由根任务继续精准恢复。函数终止或平台故障也可能留下数据，不能承诺绝对无残留。

每个已获取会话最后都以用户 JWT 调用 `logout?scope=local`，不会退出真人其他设备。会话引用随后丢弃；JWT 到期前仍可能被其他下游接受，故绝不返回、持久保存或打印 JWT、refresh token、magic hash、口令或项目 secret。结果仅含检查布尔值、请求计数、runId 与清理状态，失败不回显原生异常、响应正文或测试内容。

无论成功或失败，根任务均应覆盖为 `retired.ts` 的无导入410入口，并用原能力再次确认410；不要只依赖有效期自然过去。权限验收失败由根任务关闭数据库门，真实密码 CAPTCHA 须通过独立流程再验证。

本地验证：`node --test tests/verification.test.mjs`，仅运行注入 HTTP mock，不访问云端。

## 官方依据

- [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)、[原生 SDK 管理员请求及平铺响应转换](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts)、[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)。
- [Storage 原生上传、下载、删除及 info/exists](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageFileApi.ts)：当前 exists 使用有界 metadata info，避免 HEAD 省略错误正文后混淆缺失与鉴权失败。
- [Storage 错误](https://supabase.com/docs/guides/storage/debugging/error-codes)、[scope=local及JWT撤销限制](https://supabase.com/docs/reference/javascript/auth-signout)。
- [Smart CDN 的 Bypassing cache/cacheNonce](https://supabase.com/docs/guides/storage/cdn/smart-cdn)：新查询值强制回源，并不撤销既有缓存或下载副本。
