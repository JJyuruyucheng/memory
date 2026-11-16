# 免费托管接入验证记录

日期：2026-11-16。仅针对专用 memory 项目和本次代码，以下不构成正式站已上线的声明。

已实际执行：

- Supabase Free 项目创建成功，报价 $0/月，新加坡区域，ACTIVE_HEALTHY。
- 迁移 `20261116041930_memory_private_space` 已应用；本地文件名与远端 migration history 一致。
- 云端运行 `supabase/verify-isolation.sql`，没有断言错误，事务最终回滚，临时 Auth 用户残留为 0。它模拟请求 claims，验证数据库授权，不验证 JWT 签名或 CAPTCHA。
- 运行后再次查询：authReady=false、profiles=0、entries=0、Auth users=0、buckets=0。
- 使用项目公共 publishable key 发出真实匿名 HTTP 请求：profiles、entries、media、comments、reactions、favorites、settings 均为 401，Postgres code=42501。
- Security Advisor：没有 ERROR/WARN；runtime_guard 无开放 RLS policy 的 INFO 属于有意拒绝访问。Performance Advisor 的八条 unused-index INFO 来自空项目，暂不删除必要索引。
- Windows Node 24，使用已核实的官方 Memos 26.11.1 测试程序运行全套测试：82 通过，0 失败、0 跳过，其中 Supabase provider 23 项。验证码服务的单元/集成替身不是真实 Turnstile。
- Supabase 实际公共配置构建成功；本地浏览器加载官方本地 SDK 和登录页面，未配置 CAPTCHA 时提交按钮禁用，直接访问 `#admin` 仍为登录页，浏览器没有 error/warn。
- 正式构建校验 SDK SHA-256；GitHub Pages 仍强制 preview，排除演示记录、照片及 SDK 文件。实际初始密码未写入源码、配置或测试。

尚未验证或开通：

- Cloudflare Pages 发布及真实域名、Turnstile 原生 Auth 强制校验、关闭注册/匿名及无关登录方式。
- 固定三账号与私有 bucket 初始化、真实 JWT 下的 Storage 上传/下载/原子选图及跨账号/匿名文件请求。
- 两连接并发压力、双设备使用、大陆网络可达性、完整项目备份与恢复。

只有原生验证码和真实 Auth/Storage 权限验收完成，才可启用数据库门及前端 authReady。当前权限保持关闭，没有上传私人资料。源码中的维护流程不等于已经部署了自动清理、自动备份或导入迁移。
