# v0.6.0 验证记录

日期：2026-11-17。对应站内第 7 次更新；`src/releases.js` 与 `CHANGELOG.md` 同源。

## 变更与授权范围

用户明确同意“仅轮播图片公开”。登录页不从私密相册选取现有附件，编辑入口为「我们与设置 → 登录页照片」。两位成员及管理员均可新增、替换、移除和排序，最多八张；保存前可预览登录效果。初始没有正式照片时保留原登录文案，不用测试图片冒充情侣合照。

采用 GitHub 官方仓库核查的 Embla Carousel 8.6.0（MIT），固定 npm 包完整性与本地 UMD / LICENSE 的 SHA-256。脚本随项目发布，不新增运行时 CDN。支持触屏滑动、左右箭头、圆点、暂停和六秒自动播放；后台页面、减少动态效果、悬停和焦点停留会暂停。照片失败不重绘表单或验证码，坏图会在有限次数内跳过。

上传校验实际 JPEG/PNG/WebP 文件头、尺寸与像素上限，最长边不超过 1920px，重新编码为 JPEG，随机命名，不复制源 EXIF。原始文件最多 15 MB，输出最多 5 MB。服务端仍校验预留与实际对象的拥有者、MIME、字节数；这不等于服务端深度解码，也不能证明绕过网页的写入必定移除了元数据。

## 权限结构

- 生产迁移 `20261117012619_login_photos.sql` 新增独立非暴露 `memory_login` schema。两表启用 RLS、无客户端直接表权限，通过最小化 RPC 操作；特权函数不放在 public schema。
- 专用 `login-photos` 桶保持 `public:false`。匿名仅能读取精选清单及其中 ready 的照片，不能读取未发布、暂存或移除的对象，也不能写入。
- 写入要求三名受保护账号及启用的 runtime guard；第四个 authenticated 身份仍不具备权限。随机路径不暴露上传者 ID 或原文件名。
- CAS revision 避免覆盖另一人修改；不允许 Storage UPDATE/upsert。替换先发布新图，再清理旧图；不能直接删除当前精选图。
- 后续迁移 `20261117014415_login_photo_conflict_http_status.sql` 仅将业务版本冲突改为 `PT409` / HTTP 409；权限、锁顺序与对象验证保持不变。首次真实 HTTP 验收在旧 `40001` 冲突请求超时，同期数据库记录 67 次该错误，与服务层重试相符，但不能仅凭日志确定具体重试组件。改动后真实冲突请求按预期返回 409。
- 原 `memory-media` 桶及既有记录、悄悄话权限不变。不得为了展示登录页而公开原私密桶。

## 验证证据

- 全部本地测试 **224 通过，0 失败，0 跳过**；含官方 Memos 二进制、项目实际发送的 Supabase SDK、图片安全重编码、轮播坏图与并发导航、Provider 冲突与清理，以及临时探针的故障注入。
- Cloudflare 目标构建成功；设计静态检查 **0 FAIL、1 WARN**，唯一保留项为现有日历的日期补零。
- 生产 SQL 单事务验证 **28 项断言通过**，最后 ROLLBACK；未修改 Auth、口令、会话，未写 Storage 系统表。包含非空精选集合下 guard 关闭的拒绝验证。
- 生产真实 HTTP 验收 **21 项通过**，79 次请求、3 张微型轮播 PNG 和 1 张独立私密草稿 PNG。包含已上传且本人可读的 pending 图匿名拒绝、ready 未选中拒绝、已发布匿名逐字节读取、另一成员暂存隔离、两名成员与管理员编辑、替换排序、409 冲突、上限及格式拒绝、selected 删除与 upsert 拒绝、原私密桶的本人可读和匿名拒绝。
- 测试使用可信管理员生成的短期 magiclink 会话，不修改密码或验证码；不等同于密码与 Turnstile 验收。首次中途退出和最终成功两轮均完成精确清理。独立 SQL 查回轮播登记/对象/精选、测试私密记录及时间窗口内私密对象/新会话均为 0，runtime guard 保持 true；原桶依然 private。
- 临时验收入口已用无导入退役文件覆盖为版本 4，原短期能力返回 **410**，激活能力未写入仓库或静态产物。
- 生产 Security Advisor 无新增 WARN/ERROR。三个 INFO 为刻意启用 RLS 且禁止客户端直接访问的内部表；原有泄漏密码检测未启用 WARN 仍存在，不宣称免费计划已有该能力。
- 本地浏览器以许可演示素材实测新增三张、替换、拖动与键盘排序、保存后切换另一位普通成员再打开；原管理员设置继续禁用。
- 桌面、390px 手机、768px 平板无横向溢出；实际照片正确解码并显示。本地预览仅使用风景素材，不代表真实情侣照片已上传。

## 保留边界

公开照片可能被访客保存或缓存。移除可停止后续重新鉴权的读取，不能收回已下载副本、旧缓存、既有 Blob URL 或另行签发链接。正式轮播由 Supabase 持久化；Demo 轮播仅在当前页面内存，刷新清空。Memos 备选版保留原登录文案，不提供照片编辑。

此前用户已确认 v0.5.0 手机关闭 VPN 后刷新正常且保持登录；该结果仅对应其当时设备与线路，本次不把模拟验证改称真实长时间后台测试。

来源：[Embla 源码与许可](https://github.com/davidjerleke/embla-carousel/tree/v8.6.0)、[Storage 私有桶](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[Storage 权限](https://supabase.com/docs/guides/storage/security/access-control)、[Storage 系统表只读原则](https://supabase.com/docs/guides/storage/schema/design)、[PostgREST 自定义 HTTP 错误](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes)。完整协议见 [登录页照片协议](login-photos.md)，本地验收快照见 [preflight](login-carousel-preflight.md)。
