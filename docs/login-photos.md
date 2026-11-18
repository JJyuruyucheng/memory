# 登录页照片协议

登录页照片是专门选择在登录前展示的内容。它们与私密记录、悄悄话和 `memory-media` 完全分开，不从现有相册自动复制，不把记录附件变为匿名可读。发布者必须明确同意该组照片出现在公开登录页；移除只能停止后续新请求，无法收回其他人已下载、缓存或另存的副本。

## 数据与权限

迁移源由 CLI 3.1.0 `migration new login_photos` 生成，应用后与生产实际版本同步为 `supabase/migrations/20261117012619_login_photos.sql`；生产应用与实际 HTTP 验证结果由发布记录记载，不能以本文件或本地测试代替。

独立 `memory_login` schema 不应加入 Data API 暴露列表。`gallery` 只有一行，保存整数 `revision` 与有序照片 ID；`assets` 保存预留、上传者、随机路径、类型、大小和 pending / ready / retired 状态。两表均启用 RLS，`anon`、`authenticated` 和 `service_role` 没有直接表权限。客户端通过 public schema 中的窄 RPC 访问；public 函数是 invoker，特权实现放在非暴露 schema，固定空 `search_path` 并撤销默认 PUBLIC 执行权限。

专用 bucket 名称 `login-photos`，必须通过官方 Storage API 创建为 `public:false`、`fileSizeLimit:5000000`，允许类型仅 `image/jpeg,image/png,image/webp`。不要通过 SQL 修改 `storage.objects` / `storage.buckets`。路径固定 `slides/<随机照片UUID>`，不包含上传者 ID、原文件名或任何私密记录关联。

匿名可以读取清单，以及清单中已发布照片的 Storage bytes。它不能读取未发布、暂存、移除的照片，不能写入任何轮播数据。登录后的两名成员和管理员均可编辑该清单；写权限仍要求受保护的 `profiles` 白名单和 `runtime_guard.authReady=true`，不是仅检查一个 authenticated JWT。第四个已登录身份没有写权或暂存读取权。私密记录与账号角色权限独立保留；共同设置的成员维护范围见 [共同设置权限](shared-settings.md)。

关闭 runtime guard 会隐藏新的匿名清单/对象鉴权请求并禁止写入；这不撤回已有浏览器 Blob URL、下载副本、缓存或另行签发的 signed URL。

## RPC

| RPC | 参数 | 返回与权限 |
| --- | --- | --- |
| `get_login_photos` | 无 | anon / authenticated：`{revision,photos:[{id,path,mimeType,size}]}`，仅已发布。无 uploader、原文件名、内部状态。 |
| `reserve_login_photo` | `p_mime_type text,p_size bigint` | 三账号：预留 `{id,path,mimeType,size}`，服务端生成路径，status=pending。 |
| `finalize_login_photo` | `p_photo_id uuid` | 上传者：核验真实 Storage 对象 owner_id / metadata.size / metadata.mimetype 后 ready。 |
| `publish_login_photos` | `p_photo_ids uuid[],p_expected_revision integer` | 三账号：CAS 整组发布并返回新清单。最终最多 8 张，ID 唯一；只可选择当前已发布照片或本人的 ready 新上传。 |
| `get_login_photo_cleanup` | 无 | 三账号：仅自己的未发布上传与所有 retired 照片，用于恢复清理，匿名和第四用户不可调用。 |
| `discard_login_photo` | `p_photo_id uuid` | 上传者或 retired 的维护者：确认不再被选中、Storage 对象已通过 API 移除，才删除登记。 |

每个上传者最多保存 **16 张未被当前清单选中的照片**，pending、ready、retired 均占名额。加上最多 8 张当前展示图，全站这套协议最多 56 个登记、每个最多 5,000,000 bytes；不能将其视为平台无限存储。达到未发布名额时返回 SQLSTATE `P0001` / message `LOGIN_PHOTO_QUOTA`，客户端映射 `UPLOAD_QUOTA`。

预留与发布锁单例 gallery；发布、删除、丢弃依序锁 gallery→assets，Storage INSERT 锁自己的 pending asset，防止删除登记之后仍插入对象。没有对象 UPDATE / upsert 策略，替换必须创建新随机路径。发布重新核验所有真实对象并原子替换有序 ID 集合；被移除的旧图同事务变成 retired，不能复活到清单。过期 revision 返回 `PT409` / HTTP 409，不覆盖另一人的修改，也不将业务冲突当作数据库序列化错误重试。

## 客户端

正式轮播仅接入 Supabase；Memos 备选版保留原登录文案并隐藏照片编辑入口。Demo 的登录页照片仅保存在当前页面内存，刷新即清空，不同于记录使用的 IndexedDB；不会上传或同步生产。GitHub Pages 仍是登录界面预览，不读取正式照片。

`src/login-photos-provider.js` 使用现有官方客户端和 publishable key；它不接收 secret/service role key。普通登录、会话和记录 Provider 不依赖轮播是否加载成功。

- `getLoginPhotos({hydrate:false})` 默认只读取 metadata；轮播用 `getPhotoUrl(id)`（别名 `getLoginPhotoUrl`）按需下载当前和下一张，再生成 Blob URL。全局最多并行两张，并复用同一图的进行中请求与 Blob URL。
- 编辑页可以 `getLoginPhotos({hydrate:true})` 下载缩略图；单张坏图返回 `unavailable:true`，不阻止打开编辑页移除或替换它。
- `saveLoginPhotos({revision,photos:[{id}|{fileIndex}]}, files)` 在任何上传前验证最终数、精确顺序、格式和大小。新增文件应先经 UI 安全重编码；客户端从不保存原文件名。官方 Storage upload 使用 `upsert:false`。
- 常规保存按 reserve→upload→finalize→publish 执行。发布前不删除旧图片；失败仅尝试精确清理这次已知预留，服务端拒绝删除已经发布的任何图，即使发布响应在网络中丢失。
- 发布成功后才清理 retired。清理失败仍返回保存成功和 `cleanupPending:true`，不能把它误报为整次发布失败。
- 自动清理只处理 retired。`cleanupLoginPhotos({includeRecent:true})` 是明确的手动恢复动作，清理当前账号全部未发布上传；它可能影响该账号其他页面正在编辑的上传，UI 应在执行前说明。它不能删除另一人的 pending/ready 或任何当前展示照片。
- 已移除的 Blob URL 与 dispose 时的 URL 会撤销。轮播资源错误只影响图片展示，不得阻塞密码输入、验证码或登录。

正常上传流程会用浏览器重新编码图片，去掉原始 EXIF 等 metadata。服务端大小/MIME 对照不等于对文件的深度解码，也不能证明绕过 UI 的上传必定已去除 EXIF；具备写权的账号仍须谨慎选择公开图片。浏览器解码失败需要保留删除/替换入口。

## 验证

`tests/login-photos-provider.test.mjs` 以 SDK 形状的 fixture 验证懒加载与限并发、严格 metadata 投影、上传顺序、CAS 失败保留旧图、发布响应丢失不删除新图、清理失败与账号切换。`tests/login-photos-sdk.test.mjs` 再运行实际发送的官方 SDK、Provider 和请求传输，验证匿名精选下载链路；网络仍为合成响应。二者都不伪称运行了真实 Postgres RLS。

`supabase/verify-login-photos.sql` 在单一事务中模拟四种角色并最终 ROLLBACK，复用三名既有受保护身份而不修改 Auth/密码/会话。它检查清单投影、匿名/第四用户拒绝、暂存隔离、两个成员和管理员可编辑、CAS、配额和 guard。它不写 Storage 系统表，不证明真实 JWT 签名、HTTP bytes 或并发请求。

每次涉及轮播权限的发布都应核验：匿名读取已发布照片成功；已知 pending / ready-unselected / retired 路径拒绝；两成员都能增改与排序；最大 8 张与 MIME / 大小限制；禁止 upsert 和直接删 selected；失效 CAS 返回 409；原 `memory-media` 匿名依旧拒绝。第四用户以回滚 SQL 断言验证，不在生产创建第四个真实账号。v0.6.0 的 21 项真实 HTTP 及 28 项 SQL 验证均通过，证据见 [发布记录](release-v0.6.0.md)。临时对象与登记必须逐一通过 Storage API / 受控协议清理，并验证剩余数为零。若清单已有真实照片，不可为测试先清空它；需要先制定不会删除/退役现有照片的验证步骤。

参考：[Storage public/private](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)、[Storage 系统表只读原则](https://supabase.com/docs/guides/storage/schema/design)、[固定角色与最小授权](https://supabase.com/docs/guides/api/securing-your-api)。
