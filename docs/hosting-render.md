# Render 托管方案

推荐保留成熟开源 [Memos](https://github.com/usememos/memos)，采用 Render 托管容器与持久盘，避免现在重写认证、数据库、文件权限和 Provider。现有模板为 `deploy/render.yaml` 与 `deploy/render.Dockerfile`；它们只准备可审阅配置，**没有创建资源、订阅或扣款**。

## 费用与账号前提

截至 2026-11-16 核查官方价格：

| 项目 | 事实/计算 |
| --- | --- |
| Render 付费最小实例 `0.5c-512mb` | 0.5 CPU、512 MB，$7/月；旧名称 Starter 仍兼容。 |
| 5 GB 持久磁盘 | $0.25/GB/月，计算为 $1.25/月。 |
| 基础合计 | **$8.25/月**，只是上述两项算术和，不是最终账单承诺；另考虑带宽超额、税等。 |
| 带宽 | Hobby 工作区当前含 5 GB/月，超额 $0.15/GB；图片/视频预览和导出会消耗带宽。 |
| 免费实例 | 没有可用于此方案的持久盘，不作为私人记录长期存储。 |

来源：[Render 定价](https://render.com/pricing)、[Render 官方当前实例说明](https://render.com/articles/set-up-self-hosted-github-actions-runners-on-render)、[持久盘](https://render.com/docs/disks)。512 MB 是否足够属于针对双人小站的实施假设，尚未做 Render 内存压力测试，实际应观测后调整。付费档不因闲置自动休眠；磁盘服务重部署会短暂中断，不能多副本共享磁盘。[实例行为](https://render.com/docs/faq)、[磁盘限制](https://render.com/docs/disks#disk-limitations-and-considerations)

需要用户自己的 Render 账号、可用于该付费服务的支付方式、对 GitHub 仓库的连接授权，以及一个 Cloudflare 账号创建 Turnstile widget。这些外部账号、付款与授权不能由代码模板代替。Turnstile 有免费档，可独立于 Cloudflare DNS 使用，不要求购买域名或把 DNS 迁移给 Cloudflare。[Turnstile 免费方案](https://developers.cloudflare.com/turnstile/plans/)

## 创建前审阅

1. 审阅付费实例、5 GB 磁盘与上述成本；确认后由用户在 Render 创建 Blueprint，关联 `JJyuruyucheng/memory`，Blueprint 路径选择 `deploy/render.yaml`。这里没有自动执行付费部署。
2. 模板地区是 Singapore，自动部署仅在 GitHub checks 通过后触发；Memos/Node 镜像均固定版本与 digest。持久盘挂载 `/var/opt/memos`。
3. 在 Render Secrets 输入两个日常账号的口令：`MEMORY_MEMBER_ONE_PASSWORD`、`MEMORY_MEMBER_TWO_PASSWORD`，**源码没有默认密码**。用户名配置为 `xbl`、`ll`。用户明确选择的至少 6 位初始口令被接受，但短口令的风险不会被验证码完全消除。
4. 独立管理员用户名默认 `memory-admin`，`MEMORY_ADMIN_PASSWORD` 由 Render `generateValue` 创建随机 Secret，至少 12 位。它不写入仓库，也不嵌入前端。需要管理员登录时在受信任环境查看平台 Secret，不要复制到聊天、截图或提交记录。
5. 不填 `PUBLIC_ORIGIN` 时，启动器读取平台自动 `RENDER_EXTERNAL_URL`，使用 Render 分配的完整 HTTPS URL，无须自购域名。[官方默认环境变量](https://render.com/docs/environment-variables)

## 首次启动与验证码

启动器先运行 Memos，**只监听 `127.0.0.1:5230`**。它等待真实服务就绪，验证版本；只在空实例首次初始化账号、Space、关闭注册和 private access，然后才启动 `0.0.0.0:$PORT` 的唯一 Node 网关。平台只公开 Node 端口，不公开 Memos。

初始化标记文件 `.chaoxi-bootstrap-v1.json` 仅包含格式、版本和 pending/complete 状态，没有账号名、密码、令牌或密钥。若本启动器的首次初始化中断，pending 状态允许安全补齐缺失账号/邀请，不覆盖已有口令。已有实例无标记时只核验，不自动改账号或权限；完成标记与空数据库矛盾时拒绝重新建号，防止误把数据丢失当作新安装。验证失败时不开公众网关。

首次尚未配置 Turnstile 时，**可服务登录壳取得 Render 域名，但所有登录拒绝**。随后：

1. 在 Cloudflare Turnstile 创建 widget，hostname 填实际 `xxx.onrender.com`，widget mode 采用 Managed。它是成熟验证服务，不需要自制复杂算术/扭曲字符验证码。
2. 在 Render Environment 添加公开 `TURNSTILE_SITE_KEY` 和私密 `TURNSTILE_SECRET_KEY`，保存后重新部署。不要使用 Cloudflare 官方测试密钥部署生产。
3. 访问 `/auth/config` 只应看到 configured=true、公开 sitekey、action=login；不得看到 Secret 或账号名单。
4. 两个日常账号与独立管理员均经过同样验证；真正 Siteverify 调用在服务器执行，并检查 hostname/action。前端挂载 widget 自身不构成保护。[服务端验证要求](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

网关不把账号密码存入自定义数据库，也不使用共享管理员 token 访问双方数据；它只在防护验证通过后交给原生 Memos 认证。原生 SignIn、REST signin、注册、分享链接和未登录数据/文件请求均不得绕过网关。请勿新增直接访问 Memos 的公开服务、端口或备用域名。

## Secrets 与修改

`MEMORY_SPACE` 是 `spaces/together`；更换时需要重新构建前端并进行显式数据迁移，不能靠改变量把旧内容自动移走。用户名属于 Memos 资源标识；不允许直接改已有生产部署的用户名变量来“改名”。

成员口令变量用于首次建号；正常重启不会覆盖数据库中的已有口令。修改平台变量不是密码重置。管理员口令用于启动时核验已有实例，若在原生维护中改了管理员密码，也须同步更新平台 Secret，否则下一次启动会安全拒绝开放。运行中两个网络子进程不会继承三账号的明文初始化口令；只有监督启动器在内存内用于建号/核验。

## 完整备份与恢复

Render 每 24 小时创建磁盘快照，保留 7 天，但官方明确提醒自建数据库不能仅靠磁盘快照恢复一致性。**不能把每日磁盘快照等同已实现的 SQLite 完整可靠备份**。[磁盘快照与数据库恢复说明](https://render.com/docs/disks#disk-snapshots)

日常可从登录后的管理页面导出含 base64 媒体的内容 JSON，保存到自己的离线位置。这不备份账号、系统设置、未绑定附件或全部历史，不代替服务器恢复包。

Render 完整恢复包需要在该服务实例的受信任 Shell 中完成应用一致备份：暂时阻断写请求并暂停 Memos，完整打包 `/var/opt/memos`（含 SQLite、附件和初始化标记），然后恢复服务。由于本启动器会在子进程退出时停止整个容器，**不要在运行容器里随意 kill Memos 后期待继续用同一个 Shell 打包**；部署前应补齐并验证受控备份维护模式，或通过 SQLite Online Backup API 生成数据库一致副本并连同附件完整导出。当前模板未声称已部署这个自动备份功能。

持久盘只在当前实例运行时可用，不能通过 Render pre-deploy command 或 one-off job 访问；因此不要提供一个实际上无法挂载生产磁盘的“自动备份 cron”当作已完成方案。[磁盘访问限制](https://render.com/docs/disks#disk-limitations-and-considerations)

恢复前校验备份 SHA-256，使用新的空盘/隔离服务、相同镜像与 Secrets，完整恢复数据目录，验证三账号、Space、private access、禁注册、媒体、评论、软删恢复和导出后再切换流量；保留旧盘及升级前备份。由于完整一致备份/恢复操作还没在 Render 目标账号验证，**不要在完成恢复演练前把这里当作唯一长期档案**。用户电脑的内容导出也应定期保留。

## 已验证与尚未验证

- 本机已使用官方 Windows 26.11.1 release 并核对 SHA-256，集成测试穿过真实 Node 网关和 Memos，真实验证密码、cookie 刷新、Space、媒体、评论、回应、导出、软删以及首次初始化中断恢复；仅 Cloudflare Siteverify 在测试中使用替身。
- 生产代码没有 Turnstile 失败放行、默认密码或测试认证后门。当前没有创建 Render 服务、填写真实 Secrets、购买实例或把口令写进 GitHub。
- 本机没有 Docker，因此 Linux 镜像构建、Render 内存/卷权限、实际 HTTPS cookie、真实 Turnstile、大文件和备份恢复仍需目标环境验证。`render.yaml` 是可审阅部署配置，不是上线完成证明。

## 其他托管路线为何暂不采用

Railway Hobby 最低 $5/月并计入资源用量，卷 $0.15/GB/月、当前 Hobby 卷上限 5 GB，实际账单还依 CPU、RAM、流量；可以运行同一镜像，但不能把“最低 $5”当固定总价。[Railway 定价](https://docs.railway.com/pricing)、[卷](https://docs.railway.com/volumes/reference)

Supabase 提供成熟开源 Auth/DB/Storage 及原生 Turnstile。Free 有 500 MB 数据库、1 GB 文件，闲置一周会暂停；Pro 从 $25/月。切换需要重写 Provider、表结构和 RLS，并迁移账号/文件/评论；本阶段不是最小改造。[定价](https://supabase.com/pricing)、[CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)、[私有存储](https://supabase.com/docs/guides/storage/buckets/fundamentals)

Cloudflare Workers+D1+R2 可降低小站基础用量费用（Workers Free 10 万请求/日，D1 Free 5 GB，R2 Standard 每月含 10 GB-month），但要更换 Memos 后端、认证和 Provider，重新实现并审查文件鉴权与迁移。它不是把 Memos Docker 直接放上去；R2 还要开通计费订阅，免费额度不代表无账户/账单前提。[Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[R2](https://developers.cloudflare.com/r2/pricing/)、[R2 开通](https://developers.cloudflare.com/r2/get-started/)
