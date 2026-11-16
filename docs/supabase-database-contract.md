# Supabase 数据库与 Provider 契约

状态：正式迁移为 `supabase/migrations/20261116041930_memory_private_space.sql`，已应用于专用 memory 项目。先用官方 CLI 创建迁移文件，工具应用后按远端实际 migration version 对齐文件名。`supabase/verify-isolation.sql` 已在云端单事务执行通过并回滚，临时 Auth 用户没有残留。之后已通过官方 API 初始化三身份、UUID 白名单及私有桶，并用真实用户 JWT 完成 Storage 字节请求和十一项权限检查，测试文件、记录和会话清理后另经 SQL 核对。原生密码接口缺失及伪造 CAPTCHA 均被拒；用户已确认真实 widget 加口令登录并进入时间线，过期及重放专项仍待验。最新部署及开关状态见 [验证记录](verification-free.md)，不能把 SQL 模拟身份断言等同真实认证。

## 身份与启动门

业务只认可 `public.profiles` 中的真实 Auth UUID，不根据前端用户名、JWT `user_metadata` 或“任何已登录用户”授权。`slot` 唯一且只允许 1、2、3：1 为 xbl/member，2 为 ll/member，3 为不同用户名的独立 admin，因此最多三个业务身份。空 profiles 会拒绝所有业务访问；客户端不能插入、修改或删除 profiles。

管理员的 `memory-admin` 仅为内部标识与默认名称，固定 Auth 邮箱别名是 `memory-admin@memory.invalid`。当前网页登录名保存在受保护的 `profiles.username`，可由可信维护者修改而保持第 3 槽、原 Auth UUID 和 admin 角色；真实私密登录名及密码不进入公开代码、文档或构建配置。

账号通过 Supabase 官方 Admin API 创建，密码不写入 SQL、仓库、日志或浏览器构建产物；不能通过手写 `auth.users` 密码字段完成长期初始化。可信初始化得到三个 UUID 后再写 profiles。业务 admin 账号的用户 JWT 不等于项目 secret/service-role key；后者不得进入浏览器。

`memory_private.runtime_guard` 只有 id=1 一行，`authReady` 默认 false，anon/authenticated/service_role 均没有表权限。所有业务 RLS、附件 RPC 和 Storage 策略最终都检查这个门。项目拥有者完成原生 Auth Turnstile、关闭公开注册与匿名登录、限制其他登录方式，并实际验证直连接口缺验证码失败之后，才能通过可信数据库通道开启。只打开网页验证码不满足条件。

`memory_private` 必须保持不在 Data API 暴露 schema 列表。它的 SECURITY DEFINER 函数仅为非递归白名单查询、受控媒体操作及 Storage 权限检查所需；每个入口都检查 `auth.uid()`、真实 profiles 和启动门，并固定 `search_path=''`、撤销隐式 PUBLIC EXECUTE。公开 RPC 包装器均为 SECURITY INVOKER。

## 表与字段

表名使用小写；为复用现有 Provider，字段刻意采用引号保留 camelCase。手写 SQL 必须写 `"authorId"` 等完整引号，SDK/REST 使用原样列名。

| 表 | 字段与用途 |
| --- | --- |
| profiles | `id uuid, slot, username, name, role:member/admin, color:#RRGGBB`；前三个真实 UUID 构成白名单。 |
| entries | `id uuid, authorId uuid, status:draft/published, type:note/event/whisper, title, content, occurredAt, mood:happy/neutral/sad/null, tags:text[], createdAt, updatedAt, deletedAt`。 |
| media | `id uuid, entryId uuid, authorId uuid, uploadedBy uuid, name, mimeType, size bigint, type:image/video, storagePath, position, status:pending/ready/retired, attached:boolean, createdAt`。 |
| comments | `id uuid, entryId uuid, authorId uuid, content, createdAt`。 |
| reactions | `entryId uuid, userId uuid, createdAt`，二元主键；一个用户对一帖最多一个爱心。 |
| favorites | 与 reactions 相同，独立表；收藏按人保存，当前共享契约也允许成员看到收藏人列表。 |
| settings | 单例 `id=1, spaceName, subtitle, startDate:date, anniversaries:jsonb[], updatedAt`；仅业务 admin 可更新。 |

数据库生成 UUID 和创建时间。记录的 id、authorId、createdAt 不能通过客户端改动，管理员也不能重新归属文章；updatedAt 由数据库更新，可保留微秒。Provider 的乐观并发比较必须使用 REST 原始时间字符串，不要经过 JavaScript Date 丢失精度。

标题最多 120 字符、正文最多 20000、回应非空且最多 5000；事件必须有标题。tags 最多 20 个、单项 1–40 字符、不能空、重复或包含首尾空白。日期有限且在 1000–9999 年范围；settings 名称 1–60、副标题最多 300、纪念日最多 100 个，日期必须是真实日期。SQL 字符长度与 JavaScript UTF-16 长度不完全相同，前端可更严格，不能因此放宽数据库。

所有 public 业务表启用 RLS，同时显式授最小权限；anon 没有业务表或公开 RPC 权限。authenticated 仅可读取允许的行，entries 插入/列级更新、comments 插入、自己的 reactions/favorites 插入与删除、管理员 settings 列级更新。没有 entries 物理 DELETE、profiles 写权限、media 直接写权限或评论更新权限。trusted service_role 拥有业务表维护权限，不能交给前端。对未来新增表仍必须单独审查授权，当前草案不保证未来默认权限安全。

## REST 与草稿发布

读取 `/rest/v1/{table}?select=*` 并分页。entries 的 RLS 允许三名成员读取 published 的 note/event；published 的 whisper（悄悄话）仅作者和业务 admin 可读，情侣另一方不能通过已知 UUID、搜索、统计计数、回收站或导出访问。draft 严格只对作者可见，业务 admin 也不能读取他人的未发布草稿。Provider 列表只组装 `status='published'`；保留 draft 原始数据用于恢复，不把未完成内容放入共享 UI。软删除保留原有可读范围，不能把删除称为撤回已下载的副本。

悄悄话的权限迁移文件是 `supabase/migrations/20261116092604_private_whispers.sql`。它同时约束 entries、comments、reactions、favorites、media 与私有 Storage 读取；禁止仅在 UI 隐藏正文而仍公开附件。管理员可以维护已发布悄悄话。普通记录改为悄悄话后，新的鉴权请求按私有权限处理，但不能收回对方此前已经看见、下载、缓存或另存的内容，也不能保证收回此前已签发且未到期的 Storage signed URL（本应用下载仅用鉴权请求与 Blob URL，不主动创建 signed URL）；改回日常随记或事件会重新向对方公开。迁移已在目标云端应用并完成真实文件验证，见 [v0.4.0 验证记录](release-v0.4.0.md)。

本地 Demo 仅模拟身份隔离，并不是防护同一设备的安全边界；完整示例数据仍存在该浏览器 IndexedDB。Memos 的现有 SPACE 协议不能提供“作者与独立管理员可见”的私密约束，因此该 Provider 会拒绝保存 whisper，不降级为共享记录。

新记录 POST entries，status 由数据库默认 draft，authorId 默认当前 UUID。可发送 `id, authorId, type, title, content, occurredAt, mood, tags`；不可设置 status、createdAt、updatedAt、deletedAt。允许空 note 草稿，给纯图片记录留上传阶段；空草稿不得发布。普通成员仅能修改自己记录，管理员可以维护 published 记录；draft 只能作者改。

更新 PATCH entries 可以发送 `type,title,content,occurredAt,mood,tags,deletedAt`。配合 `id=eq.<id>&updatedAt=eq.<rawTimestamp>`、返回单行检测并发；0 行视为冲突/不可编辑，不得假成功。只改 deletedAt 完成软删除及恢复，数据库用服务端时间标记删除；回收站记录须先恢复才能改正文。

Provider 禁止在同一次保存中把 whisper 改成共享类型并移除旧附件或新增文件，且必须在任何写入前拒绝；先保留悄悄话类型保存最终附件集合，再单独切换为日常随记/事件。这样可避免 type 先公开而旧私密附件尚未解除 attached 的时间窗口。保留相同附件集合时，用户仍可明确将整条记录改为共享。

### 附件显示顺序

`saveEntry(input, files)` 的可选 `input.mediaOrder` 是精确排列：`[{id: "已保留附件ID"}, {fileIndex: 0}, ...]`；`fileIndex` 是本次 `files` 数组的零起始序号。必须各出现一次、覆盖 `input.media` 保留的全部旧文件和全部新文件，不能重复、遗漏、越界或引用其他记录。未传时兼容原行为：保留旧文件顺序，再追加新文件。所有 Provider 在任何上传/写入前验证排列，再用可信附件对象及真实上传结果解析，调用者不能伪造 URL、身份或数据库 position。同一集合仅调顺序仍可明确把悄悄话改为共享。

排序迁移为 `supabase/migrations/20261116112257_attachment_order.sql`（文件名与云端实际迁移版本一致）。`publish_entry` 的 `p_media_ids` 从集合升级为有序集合；保留原授权、并发检查、真实对象与数量校验，在同一事务内按该顺序分配连续 `position=0..n-1`。未选中的暂存/retired 附件排在其后。为兼容立即唯一约束，持锁后先整体移到未使用的正序号范围，再压缩；序号溢出会拒绝并回滚，不放开客户端直接写 position。已在生产应用并完成真实文件顺序验证，详见 `docs/release-v0.5.0.md`。

评论 POST comments 的 `entryId,content`；authorId 默认当前用户，不能冒充他人。爱心/收藏 POST `entryId`，DELETE 时按 entryId 与当前 userId 定位。仅 published 且未删除的记录可新增回应、爱心、收藏；移除自己的爱心/收藏仍允许。settings PATCH 仅管理员通过 RLS 生效。

### 媒体与原子选图协议

Bucket 固定 **memory-media**，通过官方 Storage API 创建，配置 `public:false, fileSizeLimit:50000000`。允许类型只有 `image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime`。50,000,000 bytes 是本项目的保守上限，不能沿用旧 domain 的 50 MiB。草案不通过 SQL INSERT/DELETE 修改 storage 系统元数据；对象字节只由 Storage API 管理。

所有 RPC 参数严格使用以下 snake_case 名称，返回为单个 JSON 对象而非数组：

| RPC | 参数 | 返回 |
| --- | --- | --- |
| reserve_media | `p_entry_id uuid,p_name text,p_mime_type text,p_size bigint` | 单个 media JSON，status=pending、attached=false。 |
| finalize_media | `p_media_id uuid` | 单个 media JSON，核验对象后 status=ready，仍 attached=false。 |
| publish_entry | `p_entry_id uuid,p_media_ids uuid[],p_expected_updated_at timestamptz=null` | 单个 entry JSON，status=published，含新 updatedAt。 |
| discard_media | `p_media_id uuid` | void；只能丢弃尚未 attached 且物理对象已不存在的登记。 |

1. 新记录先建 draft；更新现有记录先按时间戳 CAS 更新文字字段，保留原 attached 附件。文字 PATCH 与后续上传不是一个事务，后续失败可能已经改了文字，必须在错误中明确说明。
2. 每个新文件调用 reserve_media。服务端锁 entry 后分配名额、UUID 和 position；storagePath 固定 `<entryAuthorUUID>/<entryUUID>/<mediaUUID>`，不含原文件名。authorId 永远取 entry 作者；uploadedBy 是当前执行者。普通用户不能向别人的记录预留附件，管理员只可维护他人 published 记录。
3. 每条正式记录最多 **10 个 attached 附件，其中图片最多9张**。为安全替换旧图，未 attached 的临时附件总数另最多 **10 个**，其中图片最多 **9 张**；pending、ready 和 retired 都占临时名额。预留、发布、上传权限及删除操作都依序锁 entry→media，防止同时上传绕过计数或边删登记边插入对象。最多可临时存在 10 个旧 attached 附件加 10 个临时附件，图片合计最多18张；UI 正式记录始终最多九图/十附件，不能把暂存空间称为免费无限额。
4. 使用用户 JWT 调用 Storage upload，路径必须与预留一致，`contentType=media.mimeType,upsert:false`。没有对象 UPDATE policy，因此替换、upsert 和 move/rename 不开放。finalize_media 读取真实 storage.objects 的 owner_id、metadata.mimetype、metadata.size，必须逐项匹配预留后才 ready。MIME 元数据匹配不等于深度识别文件字节，损坏或伪装的媒体仍需浏览器解码失败处理。
5. 上传全部完成后调用 publish_entry，p_media_ids 是最终保留的旧 ready 附件加新 ready 附件的完整 ID 集合，p_expected_updated_at 用上一步 entries 返回的原始值。RPC 锁行并核验唯一 ID、同一 entry/作者、ready、真实对象仍存在、最终附件数≤10且图片数≤9、正文/标题/媒体至少一项；CAS 冲突 SQLSTATE **40001**。同一事务把选中附件 attached=true，把移除的旧 attached 附件改 retired/attached=false，并把 entry 置 published。空文本/空图不能发布，也不能通过普通 PATCH 把 published 文本帖改空。
6. 发布失败不会从本次操作中先删旧图。发布成功之后，才对本次移除的 retired 附件逐一 Storage.remove(path)→discard_media(id)。清理失败表示“发布成功，但存在待清理附件”，不能谎称发布回滚，也不能把未确认完成当完整备份。原子选图只覆盖数据库登记；Storage 对象字节、Auth、HTTP 和 SQL 不属于同一个事务，仍要真实请求验证。

Storage SELECT 只允许：作者自己的草稿/临时文件；published note/event 的 attached ready 文件允许三人读取，published whisper 的 attached ready 文件仅作者和业务 admin 可读；业务 admin 可维护 published 记录的临时文件。对方不能读新草稿、悄悄话或别人暂存上传。Storage DELETE 仅允许有编辑权的人删除未 attached 文件；不能直接删仍在正式记录或回收站中的 attached 文件。先通过 publish_entry 解除附着后才删物理对象，能降低“还在展示但字节已删除”的风险。

## 失败与维护恢复

Provider 必须允许读取未完成草稿的合法字段，不能用“草稿为空”拒绝整个空间。UI 只展示 published；单附件 404、网络失败或解码失败应显示 unavailable 状态，不能导致两人无法登录或看其他记录。导出缺少任何应包含的媒体字节时必须明确失败，不能生成假完整备份。

上传中断后，作者查询 media 的 unattached 行核对其 entry、id、storagePath、status：已有对象则可重试 finalize，完成后重新发布选图；不保留的文件先 Storage.remove，再 discard。网络错误使删除结果未知时，可重试 Storage.remove；若对象已经不存在，discard 的服务端存在检查允许完成清理。对象仍在时 discard 必须拒绝，不能通过删登记制造孤儿。不要自动删除其他会话的 pending 上传。

发布后的清理中断可重新执行 Storage.remove→discard。retired 和未使用的 pending/ready 会一直占存储与暂存名额，未配置自动清理；维护提示必须写明。普通应用导出只覆盖 published 的可见记录及 attached 媒体，不包含隐藏草稿、临时/retired 文件或整个项目 Auth/SQL 配置，因此不能替代数据库与 Storage 全量备份。

## 根任务验收清单

真实数据库测试应在隔离事务/专用测试身份中验证并最终 ROLLBACK：默认 guard=false 对三已登录身份也拒绝；guard=true 后 anon、第四个用户、成员一/二、管理员的逐表读写；不能改 profiles/role、作者/id/createdAt；作者能建草稿而另两账号不可读，空草稿不能发布；九图发布、临时图数与总数上限；跨作者、跨 entry 媒体 ID、伪造路径、upsert、未完成对象拒绝；CAS、软删与恢复；管理员只维护 published 他人帖子；公开 RPC 不可被 anon 执行。并发上限与上传/删除互斥还需要至少两条实际连接重叠事务，单事务顺序断言不算并发验证。

再以真实用户 JWT 对 Storage API 验证：私有下载、禁匿名、真实文件大小/MIME、owner_id/metadata 格式、禁止替换与删除 attached、成功 finalize/publish/清理、请求中断后的恢复。只伪造 storage.objects 元数据的 SQL 测试不能代替这些请求。

## 云初始化顺序

以下为重新初始化时应遵守的流程，具体已经完成的步骤见 [验证记录](verification-free.md)。项目创建、数据库执行与平台配置由根任务和项目拥有者统一控制；应用不能根据“项目存在”就自动打开运行门。

1. 核对项目 ref、组织、套餐、区域和状态；先列出现有 public 表、函数、授权与 storage.objects 策略，确认是专用目标。已有宽泛的 Storage SELECT/INSERT/UPDATE/DELETE policy 可能与本项目策略以 OR 合并放宽权限，不能不检查就追加。不要暴露 memory_private schema。
2. 审阅草案，使用当前官方 CLI 的 `migration new` 生成迁移，保存可审核的 SQL；执行前确认实际目标与命令 `--help`。CLI v3 默认本地，托管变更需明确选择远端；工具提供 apply_migration 时由根任务按其说明控制。迁移后的 runtime_guard 必须仍为 false。
3. 用可信服务端官方 Storage API 创建 memory-media，private、50,000,000 bytes 和八种 MIME；如 bucket 已存在，先读取并核验配置，不覆盖未知 bucket。API 创建 bucket 不等于文件隔离验收通过。
4. 项目拥有者在 Supabase 控制台开启原生 Turnstile，secret 只留平台；Cloudflare widget 的 hostname 配实际前端域名。关闭 Allow new users to sign up、Allow anonymous sign-ins 及无关身份提供商，保留 email/password。测试直接 Auth password endpoint 缺少/假/过期 token 被拒，不能以隐藏网页按钮代替。Captcha 未配置或未验收，guard 保持 false。
5. 验证原生防护配置后，再通过官方 Auth Admin API 创建两个普通用户和独立管理员，使用预先确认的固定用户名映射与秘密密码输入；若采用邮箱别名并 email_confirm=true，需明确没有真实邮箱时无法依赖邮箱自助找回。得到实际三个 Auth UUID 后，可信初始化写入 profiles，严格核对 slot/username/role，不能自动把未知已有账号提权或覆盖口令。不要在服务端留下长期公开的管理员初始化端点。
6. 数据库模拟权限矩阵可在事务中临时开启 guard 并最终 ROLLBACK。跨连接的真实 HTTP 验收需要维护者另行提交受控的 guard 开启，前端保持关闭；不能声称其他 HTTP 连接能看到未提交的开关。完成真实用户 JWT 与 Storage 检查后清理本次文件、记录和会话，再复查残留；异常时关闭 guard。真实 widget 加口令登录另行验收，不能用管理员生成会话替代。
7. 只有上述实际结果满足要求，可信数据库管理员才永久设置 runtime_guard.authReady=true。若验收失败，false 保持；切回 false 可停止后续业务 API 访问，但不能收回用户已下载的副本、浏览器缓存或此前泄露的有效 bearer token，不能称为抹除数据。

在原生验证码可用前，不批量创建三账号，不提前写个人记录，不开启业务访问。当前只持有 publishable key 的客户端不具有 Auth Admin 初始化能力；缺少可信初始化渠道时应停止在可审阅流程，不能把 secret 塞入浏览器作为替代。

参考：[官方 changelog](https://supabase.com/changelog.md)、[CLI v3 breaking change](https://supabase.com/changelog/supabase-cli-v3)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[最小授权](https://supabase.com/docs/guides/api/securing-your-api)、[Storage schema 只读原则](https://supabase.com/docs/guides/storage/schema/design)、[私有 bucket](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)、[Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。已通过 Supabase MCP search_docs 查阅相关 RLS、Storage 及系统元数据说明，未据此声称实际云验证。
