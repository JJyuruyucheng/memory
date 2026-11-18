# 共同设置的成员权限

本次开放范围为当前正式 Supabase 版与浏览器 demo 的“我们与设置”：共同空间名称、副标题、开始日期、纪念日增删修改、登录页照片编辑、本人档案导出、可见共同档案导出及退出登录。只有已登录的受邀成员与管理员可以使用；未登录访客和白名单以外的 authenticated 账号不因此获得访问权。

“可见共同档案”包含该身份本来能读取的已发布记录及其媒体（含可见的回收站记录），不是全系统备份。普通成员的导出不包含对方悄悄话；管理员仍可读取已发布悄悄话。未发布草稿不会因这次变更对其他身份公开。管理小屋、profiles 角色、他人记录的编辑权限和私密媒体授权均未改变。登录轮播原有的专门公开授权边界保持不变。

## 数据库变更与验证

使用官方 Supabase CLI 3.1.0 `migration new member_settings` 创建迁移源；应用后按远端实际版本对齐为 `supabase/migrations/20261118022125_member_settings.sql`。该迁移已应用于正式 memory 项目 `ijtrfjehqtoptsmsotin`，远端版本为 `20261118022125`。迁移仅修改既有 `settings_update` 策略的 `USING` / `WITH CHECK` 为受保护 `memory_private.member_role()` 非空。该函数同时核查受邀 profiles 白名单和 runtime guard；不信任客户端可编辑 metadata。

既有列级 `UPDATE ("spaceName", subtitle, "startDate", anniversaries)` 授权继续约束可修改字段；不授予 INSERT、DELETE、`id`、`updatedAt` 或 profiles 写权限。`settings_read` 已允许相同受邀成员读取，因此 UPDATE 的 SELECT 前置条件不缺失。

应用后执行 `supabase/verify-isolation.sql` 整份单事务验证，最后 ROLLBACK。验证模拟数据库请求角色与 claims，不需要口令或 API key；它证明 SQL 授权，不冒充真实 JWT、CAPTCHA、浏览器或线路测试。新增断言覆盖双方成员实际更新四列与纪念日后互读、匿名拒绝、白名单外账号拒绝、guard 关闭拒绝、`id` / `updatedAt` 不可写；既有悄悄话、草稿、附件和记录归属断言保留。

本次已在正式项目执行完整 `supabase/verify-isolation.sql`，单事务通过并 ROLLBACK；最终查询 `remaining_isolation_auth_users` 为 0。工具仅返回最后一次 SELECT，因此不按输出臆测断言总数。此处仍是数据库角色与 claims 模拟，不等同实际用户 JWT 或口令登录验收。

前端/provider 测试另覆盖双方与管理员保存共同设置、失败请求不伪报保存成功、未登录设置/导出不发业务请求、可见共同档案导出排除对方悄悄话，以及 demo 重开后仍保留双方保存的设置；已纳入本次全量 240 项通过、0 跳过的测试。本机 demo 浏览器也完成双方分别修改副标题、保存并互读。正式前端发布与真实账号页面验收仍待完成，详见 [v0.7.0 验证记录](release-v0.7.0.md)。

## 旧 Memos 模式

Memos 26.11.1 是保留的旧部署适配器，当前正式站不走这条路径。它的原生空间设置 PATCH 要求空间管理员；本次未提升成员的空间角色，也未新增持有维护密钥的代理。此模式普通成员保存共同空间设置仍得到明确 403，原有测试继续验证该边界。Memos 的 SPACE 无法满足悄悄话的逐作者权限，仍拒绝创建该类型。不能把正式 Supabase 的成员设置能力描述为 Memos 已实现的能力。
