# 部署、隐私与恢复

**没有服务器时，采用 [Render 托管指南](hosting-render.md)。** 这是当前推荐方案：一个付费 Docker Web Service、一个持久磁盘，平台提供 HTTPS，不需要自己管理 Linux。仓库只包含可审阅模板，尚未创建任何付费资源，也没有已配置好的 Turnstile 密钥或实际托管站点。

GitHub Pages 是公开静态托管，不能安全保存登录口令、会话或私人记录。本项目公开预览只展示登录壳，不能作为双人真实数据后端。真实内容、照片、视频及备份不得提交 GitHub。正式入口统一经过 `deploy/auth-gateway.mjs`：所有公开登录都先服务端验证 Turnstile，原生 Memos 登录、注册、公开分享路由被阻断。旧 nginx 直通部署文件已移除，不能拿过去的 `/api/auth/signin` 直通方案绕开验证码。

## 认证与数据边界

- 官方底座固定 [Memos 26.11.1](https://github.com/usememos/memos/releases/tag/26.11.1)，容器同时固定 digest。认证仍由 Memos 完成，不自建密码数据库。公众只可 `POST /auth/login`；只有网关验证成功后才代理到官方 Connect `AuthService/SignIn`。
- `/auth/config` 只提供公开 sitekey、action 和配置状态，不披露账号名单或 Secret。缺少验证码配置时允许打开登录壳，但登录返回 503，前端不提交密码。
- access token 只在内存保存；刷新依赖同源 HttpOnly cookie。网关从规范 `PUBLIC_ORIGIN` 设置转发协议，HTTPS 使用 Secure cookie；不信任客户端伪造的 X-Forwarded-For / X-Forwarded-Proto。
- 普通账号是两个独立身份，另保留一个独立管理员。三者都经过相同验证码登录；管理账号有读取及维护全部记录的权限。这不是端到端加密。
- 所有记录明确设置目标 Space 与 `SPACE` visibility；`PROTECTED` 只代表全实例登录可读，不代表两人空间。只编辑、删除、恢复本人记录；管理员可维护空间内其他人的记录。服务端 Memos 权限才是真正保护，隐藏按钮不是权限措施。
- Turnstile 使用 [服务端 Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)，核对 success、hostname、action，同时防 token 重放并按账号、来源和全局限流。它不保证彻底阻止攻击。平台可信客户端 IP 未核实时使用 socket 地址；Render 共享代理可能合并来源限流。重启会清空当前内存限流状态，不能把它称为跨实例的持久全局防护。

## 自有 Docker 主机的可选部署

以下是已有主机时的替代方案。`compose.yaml` 只运行两个服务：私有 Memos 与公开 Node 网关，不再运行 nginx。Node 网关使用与 Render 相同的镜像和认证代码。

```sh
cp deploy/.env.example deploy/.env
```

编辑本机 `deploy/.env`：填写 `PUBLIC_ORIGIN`、目标 `MEMORY_SPACE`、三个账号的用户名，以及 Turnstile sitekey/secret；**不要提交此文件**。主机已有 HTTPS 代理时，`MEMORY_LISTEN` 保持 `127.0.0.1`。

首次初始化先仅启动 Memos，并临时启用只绑定 loopback 的维护端口：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml -f deploy/compose.admin.yaml up -d memos
node deploy/init.mjs
```

初始化 CLI 服务地址填写 `http://127.0.0.1:5231`，账号名称与 `.env` 一致。CLI 仅从终端 stdin 读取密码，不回显、不写文件、不打印原始服务响应。管理员至少 12 位；按用户明确选择允许日常账号使用至少 6 位初始口令，仍建议改用长而唯一的口令。脚本开启 private access、关闭注册、创建 Space 与两个成员并接受邀请。重复执行补齐缺失项目，不覆盖已有密码，不自动降级角色。

初始化完成后启动正式基础配置，移除维护端口：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

网关默认只在本机发布 `127.0.0.1:8080`，Memos 没有宿主机端口。主机 HTTPS 代理转发到 `127.0.0.1:8080`。不要公开 `5230/5231`，不要增加直通 Memos 的域名、路径或端口。需要原生维护界面时再次加上 `compose.admin.yaml`，通过 `ssh -N -L 5231:127.0.0.1:5231 user@server` 后在自己的浏览器打开本机 5231，结束后移除 override。

PowerShell 使用 `Copy-Item deploy/.env.example deploy/.env` 代替 `cp`。更换 Space 后需要重新构建 web，使构建时 `MEMORY_SPACE` 与运行时一致。

## 内容、媒体与目前限制

- type/title/occurredAt/mood/tags/deletedAt 存在 `<!-- chaoxi-entry:v1:BASE64URL_JSON -->` 内容头，后面为独立正文；共同设置存在 Space.description 的版本化数据。未知版本或损坏格式会明确报错，避免覆盖。原生 Memos 页面可能看到这个元数据头，不要手动破坏。
- ❤️和⭐分别复用原生回应与收藏，按人分开。⭐是同一空间可见的原生回应，**不是私密收藏**。留言为原生 SPACE 评论。
- 删除是内容中的软删除，不调用物理删除接口。没有部署自动清理任务；“30 天”不是已经启用的定时销毁。原生 API 中原文及附件仍存在；从原生界面物理删除记录或 Space 会绕过本站回收站。
- 图片/少量视频通过附带访问令牌的 fetch 获取后生成 Blob URL，令牌不放 URL，退出撤销 Blob URL。视频先完整下载至浏览器内存，没有逐段流媒体、转码、断点续传或后台压缩。建议 JPEG/PNG/WebP 和 MP4（H.264/AAC）/WebM；MOV/HEVC 可能需要自行转码。SVG/HTML 不允许作为上传媒体。
- 默认单文件最多 50 MiB，每条最多 9 张图片；Memos 实际额度可能更低。大量媒体会增加首次加载、导出时间和浏览器内存。另一人新内容通过刷新页面查看，当前没有宣称已完成 WebSocket 实时同步。
- 编辑前检查服务端时间戳，但没有原子 compare-and-swap；极短窗口内同时编辑仍可能后写覆盖。网络中断后的保存结果可能未知，须刷新核对，不要盲目重发。
- JSON 导出含共享记录、回收站、评论、人员显示信息、设置与媒体 `data`（base64）/`mimeType`，不包含口令或令牌。它是内容导出，**不是已实现的导入功能或完整服务器备份**；不复制账号、会话、系统配置、历史版本或未绑定附件。

## 自有 Docker 主机的完整备份与恢复

持久卷 `chaoxi-memory-data` 保存 SQLite、配置和本地附件。先停写，再完整打包卷，不能只复制数据库文件。备份包含私密内容和敏感配置，存储到主机之外，限制读取，并保留对应代码提交、镜像 digest、`.env` 和 SHA-256。

```sh
mkdir -p backups
docker compose --env-file deploy/.env -f deploy/compose.yaml stop web memos
docker run --rm --entrypoint sh -v chaoxi-memory-data:/data:ro -v "$(pwd)/backups:/backup" neosmemo/memos:26.11.1@sha256:5dcd6e6b973a55b964f2fe2ccdaa33319463ab448a23404ebb5d2acbd19299ba -c 'tar czf /backup/chaoxi-backup.tgz -C /data .'
docker compose --env-file deploy/.env -f deploy/compose.yaml start memos web
```

PowerShell 用 `New-Item -ItemType Directory -Force backups`，挂载路径用 `${PWD}/backups:/backup`。此处提供的是手动步骤，不代表已建立定时备份。若改用 S3，须另外备份对象存储。

恢复时停止服务、保留当前卷，验证备份 SHA-256，再恢复到新的空卷 `chaoxi-memory-restore`：

```sh
docker volume create chaoxi-memory-restore
docker run --rm --entrypoint sh -v chaoxi-memory-restore:/data -v "$(pwd)/backups:/backup:ro" neosmemo/memos:26.11.1@sha256:5dcd6e6b973a55b964f2fe2ccdaa33319463ab448a23404ebb5d2acbd19299ba -c 'tar xzf /backup/chaoxi-backup.tgz -C /data'
```

在本机专用 Compose 副本中把 volume 名称改为恢复卷，先用同一版本 loopback 验证三个登录、成员、禁注册、private access、正文/评论、图片/视频、软删恢复和导出，确认后再开放 HTTPS。不要对唯一数据卷执行 `down -v`。

升级先完整备份，在副本上验证迁移。只允许单个新版本迁移数据库；旧镜像不能直接回滚已迁移的数据库，回退须使用升级前备份及匹配版本。

## 验证

`node --test tests/memos*.test.mjs` 默认跳过真实服务测试。设置 `MEMOS_BINARY` 为官方、已经核对 checksums.txt 的 26.11.1 可执行文件绝对路径后，`tests/memos-live.test.mjs` 会在独立临时空数据库启动真实 Memos 和公开网关，只对 Cloudflare Siteverify 使用测试替身；验证真实口令、cookie 刷新、SPACE、媒体鉴权、评论、回应、管理员维护、导出、软删以及初始化中断恢复。测试不会接触生产数据库。Docker 镜像构建、Render 磁盘、真实 Turnstile 及公网 HTTPS 还必须在目标环境验证，不能把源代码/本机测试当作已上线。
