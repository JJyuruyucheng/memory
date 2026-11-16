# 真实模式部署与恢复

GitHub Pages 发布的是浏览器本地演示。Pages 不运行 Memos、数据库或双人在线同步。真实模式使用同一个 HTTPS origin 下的自定义前端、Memos API 与媒体接口，必须有一台支持 Docker Compose 和持久存储的主机。数据库、真实照片、密码、会话令牌和备份均不提交 GitHub。

## 已固定并实测的底座

- Memos 固定 `neosmemo/memos:26.11.1`，Compose 同时锁定镜像 digest，依据 [26.11.1 发布记录](https://github.com/usememos/memos/releases/tag/26.11.1)。Node 与 nginx 基础镜像也固定版本及 digest。
- 认证复用官方浏览器 Connect 接口：`POST /memos.api.AuthService/SignIn`、`RefreshToken`、`SignOut`，正文均为 JSON。登录正文为 `{ "passwordCredentials": { "username": "...", "password": "..." } }`。访问令牌只保留在内存；刷新令牌由服务器写入 HttpOnly、SameSite=Lax cookie，HTTPS 请求还设置 Secure。没有自建认证服务、管理员共享 token 或 localStorage token。
- **26.11.1 的 REST 登录接口陷阱：** 本项目用官方 Windows release 实测发现 `/api/auth/signin` 把 cookie 放在 `Grpc-Metadata-Set-Cookie` 响应头，浏览器不会把它当作 cookie。本项目因此采用官方 Connect 认证接口；不要把它替换回 REST 登录。其他数据接口使用 `/api` REST。
- `GET /api/auth/me`；`GET/POST /api/memos`；`PATCH /api/memos/{id}?updateMask=content,space,visibility,attachments`；`POST /api/attachments:upload`；`POST /api/memos/{id}/comments`；`POST /api/memos/{id}/reactions`；Space 成员与设置接口均来自 [固定 tag API schema](https://github.com/usememos/memos/tree/26.11.1/proto/api)。

## 第一次启动

在仓库根目录执行以下 Linux/macOS 命令；Windows PowerShell 使用 `Copy-Item deploy/.env.example deploy/.env` 代替 `cp`。

```sh
cp deploy/.env.example deploy/.env
```

编辑 `deploy/.env`：`MEMORY_SITE_URL` 填实际公开 HTTPS origin（如 `https://memory.example.com`）；`MEMORY_SPACE` 默认为 `spaces/together`；`MEMORY_LISTEN` 保持 `127.0.0.1`。这份环境文件只含地址和空间名，不存账号密码。

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
node deploy/init.mjs
```

初始化 CLI 需要 Node 22 或更新版本。在主机终端运行时，服务地址填写 `http://127.0.0.1:8080`；若从自己的电脑运行，先使用 SSH 隧道或使用已经配置好的同源 HTTPS 地址。脚本逐项询问一个管理员账号、两个不同的日常账号和密码，密码输入不回显，且不会输出或写入密码。密码至少 12 位；不要把真实密码写入命令行、脚本源码或 shell 历史。支持从 stdin 读取，不要保存明文答案文件。

脚本创建首个管理员，关闭自助注册，开启 private access，创建 Space，再让两个普通账号接受邀请。管理员是 Space ADMIN，两个日常账号是 USER。重复执行会保留已有账号、已有设置和记录，不自动重置密码或改变角色。初始化最后核对三个成员、private access 和关闭注册；失败会明确停止，可能已经创建的账号不会自动删除。修正问题后使用相同账号重跑。

`MEMORY_SPACE` 必须与初始化 Space ID 一致；更换它以后重新构建 web。初始化前不要开放公网入口，以免其他人抢先创建首个管理员。真实前端发现版本不匹配、公开实例或开放注册，会拒绝加载记录并提示修复。

如果主机没有 Node，可在受信任的本机执行 CLI 并把服务地址设为 SSH 隧道地址：

```sh
ssh -N -L 8080:127.0.0.1:8080 user@your-server
```

完成初始化后，由主机现有 HTTPS 反向代理转发到 `127.0.0.1:8080`，保留原始 `Host`，并**覆盖** `X-Forwarded-Proto: https`。TLS 证书由实际主机配置；本仓库不虚构域名、证书或已经上线的服务。可使用主机 Caddy 的最小配置：

```caddyfile
memory.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Compose 默认只在 loopback 发布 nginx 的 8080，Memos 没有任何宿主机端口。nginx 同源代理 `/api/`、`/file/` 和官方 `AuthService` 路径；禁止匿名 share API 和 `share_token` 文件请求。不要把 `.github.io` 静态站直接连到另一个站的后端；跨站 SameSite cookie 无法提供此方案的刷新会话。

## 使用及目前限制

- 两个日常账号阅读同一 `SPACE` 范围的数据、发布自己的内容、留言和回应；只允许编辑、删除、恢复本人记录。独立管理员账号可以维护他人的记录和共同设置。管理员也是本人持有的第三个身份，具有内容读取权；这不是端到端加密。
- type、title、occurredAt、mood、tags、deletedAt 放在 `<!-- chaoxi-entry:v1:BASE64URL_JSON -->` 内容头，后面保留独立正文。未知版本或损坏的头会报错，避免覆盖。普通原生 Memos 内容可当作普通文本读取；不要手动破坏头部。共同设置存入 Space.description 的 `chaoxi-settings:v1:` 数据。原生 Memos 界面会看到这些元数据；原生搜索不等同朝夕结构化搜索。
- `reactionBy` 使用原生 ❤️；`favoriteBy` 使用原生 ⭐。两者按账号分开；⭐属于共享 Space 的原生反应，其他成员可以看到，**不是私密收藏**。留言使用原生评论并显式设置相同 Space 与 SPACE visibility。
- 删除为内容元数据中的软删除，**不调用物理删除接口**，也没有部署自动清理任务。回收站 30 天是显示/维护规则，不是已启用的定时销毁。原生 Memos API 中原文和附件仍存在，管理员可恢复。删除整個 Space 是原生永久删除操作，不应作为回收站功能使用。
- 媒体通过带当前 access token 的 fetch 获取，再生成 Blob URL；退出登录会撤销本地 Blob URL。不会把 token 放进 URL。少量视频也先完整下载到浏览器内存，当前没有逐段视频流、转码、断点续传或后台压缩。上传虽然分块，服务器重启仍会中断临时上传。网络失败后必须刷新核对，不能把“请求中断”当作“服务器一定没写入”。
- 推荐 JPEG/PNG/WebP 图片和 MP4（H.264/AAC）或 WebM。MOV/HEVC 即使上传成功也可能不能被当前浏览器解码，需自行转成兼容格式；SVG/HTML 不接受为媒体。每个文件默认最多 50 MiB、每条最多 9 张图片；实际 Memos 使用额度还可能更低。首次加载与导出会读取媒体全部内容，媒体很多时耗时、占用内存；当前定位为双人、少量视频的私人站点。
- JSON 导出包含共享记录、回收站、评论、人员显示信息、共同设置和媒体 `data`（base64）/`mimeType`，不包含密码或令牌。这是可读内容导出，不是已完成的导入功能，也不是服务器完整备份。它不复制用户登录、会话、历史版本、全部系统设置或未绑定附件。没有后台轮询或 WebSocket 实时刷新；另一人新发内容后刷新页面可见。
- 不将正文和评论作为 HTML 信任。自定义前端将文本转义显示；保存的 `<script>` 等只应被当作普通文字。原生 Memos 服务端仍负责真正的数据权限；隐藏前端按钮不能替代服务端权限。
- 编辑前会检查服务器时间戳，发现旧版本时要求刷新；Memos 此接口没有本项目可用的原子 compare-and-swap，所以极短窗口内同时编辑同一记录仍可能后写覆盖前写。当前没有声称已实现协同编辑、冲突合并或版本回滚。

## 原生后台与账号维护

默认不公开额外管理域名。需要原生 Memos 管理界面时，在服务器暂时启用只绑定 loopback 的 override：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml -f deploy/compose.admin.yaml up -d
ssh -N -L 5231:127.0.0.1:5231 user@your-server
```

随后在自己的浏览器打开 `http://127.0.0.1:5231`，使用独立管理员账号登录，执行账号创建、停用、密码重置或查看原生设置。HTTP 只存在于 SSH 隧道的本地端；公网入口仍必须 HTTPS。`compose.admin.yaml` 不要改成 `0.0.0.0`。结束维护后运行仅含基础 compose 的 `up -d`，移除临时端口。自定义管理页面展示记录、回收站和导出，不声称已提供未经实现的账号管理 API。

## 完整备份

默认数据使用 Docker volume `chaoxi-memory-data`，包括 SQLite 数据库、配置和本地附件。**先停写再完整打包整个卷**，不要只复制数据库文件，也不要仅靠内容 JSON 导出。保留这份仓库对应提交、`deploy/.env`、镜像 digest 和备份时间，备份包存到服务器之外并限制读取；其中包含双方私密内容和敏感服务器配置。若后来改为 S3，必须另行备份对象存储，数据库卷不包含 S3 原文件。

以下在仓库根目录执行，使用与镜像一致的官方 Memos 容器内 `tar`，不启动服务。日期文件名由自己填写，避免 shell 平台差异：

```sh
mkdir -p backups
docker compose --env-file deploy/.env -f deploy/compose.yaml stop web memos
docker run --rm --entrypoint sh -v chaoxi-memory-data:/data:ro -v "$(pwd)/backups:/backup" neosmemo/memos:26.11.1@sha256:5dcd6e6b973a55b964f2fe2ccdaa33319463ab448a23404ebb5d2acbd19299ba -c 'tar czf /backup/chaoxi-2026-11-16.tgz -C /data .'
docker compose --env-file deploy/.env -f deploy/compose.yaml start memos web
```

PowerShell 用 `New-Item -ItemType Directory -Force backups`，卷挂载路径用 `${PWD}/backups:/backup`，其余 Docker 参数相同。备份之后检查文件大小并计算 SHA-256，至少做一次隔离恢复演练。这里提供的是手动备份步骤，仓库未悄悄部署定时任务。

## 恢复与升级

1. 停止 web 和 memos，保留当前卷作为回退；不要对唯一一份数据卷执行 `docker compose down -v`。
2. 校验可信备份的 SHA-256。创建一个新的空卷，先把备份解到新卷，禁止覆盖正在运行的数据库。

```sh
docker volume create chaoxi-memory-restore
docker run --rm --entrypoint sh -v chaoxi-memory-restore:/data -v "$(pwd)/backups:/backup:ro" neosmemo/memos:26.11.1@sha256:5dcd6e6b973a55b964f2fe2ccdaa33319463ab448a23404ebb5d2acbd19299ba -c 'tar xzf /backup/chaoxi-2026-11-16.tgz -C /data'
```

3. 复制基础 Compose 为本机专用恢复配置，只把 volume 的 `name: chaoxi-memory-data` 改成 `name: chaoxi-memory-restore`；使用同一 26.11.1 镜像启动，先仅 loopback 验证。恢复配置不得提交密码或备份内容。
4. 依次验证三个登录账号、Space 成员、private access、关闭注册、正文/留言、图片/视频、软删恢复和内容导出。确认后再开放 HTTPS 入口；保留旧卷直到验证完成。恢复的是完整卷，因此不再运行初次建号脚本去覆盖设置。
5. 升级前另做完整备份、阅读目标版本迁移说明，在备份副本上验证后更新镜像版本及 digest。26.11.1 会建立附件索引并迁移 schema；只启动一个新版本进程执行迁移，不让不同版本共用数据库。旧镜像不能直接回滚已经迁移的新数据库；回退使用升级前备份及匹配版本。前端目前明确核验 26.11.1，更换版本前也要更新并运行集成测试。

## 验证命令

```sh
node --test tests/memos-provider.test.mjs
```

`tests/memos-live.test.mjs` 默认跳过，避免测试向真实私密站点写入。设置 `MEMOS_BINARY` 为已校验 SHA-256 的**官方 26.11.1 可执行文件绝对路径**后，它会在新的系统临时目录和空数据库中启动独立服务，自行创建随机测试密码，跑真实 API 测试后关闭服务并删除这份临时数据。它不会使用 `MEMORY_SITE_URL` 或现有生产数据库。

```sh
MEMOS_BINARY=/absolute/path/to/memos node --test tests/memos-live.test.mjs
```

Windows PowerShell：先设置 `$env:MEMOS_BINARY='C:\absolute\path\memos.exe'`，再执行 `node --test tests/memos-live.test.mjs`。开发期间已使用官方 Windows amd64 release、核对官方 checksums.txt 后实测了两账号共享、权限拒绝、媒体鉴权、评论、原生反应、管理员维护、完整媒体导出和软删恢复。Docker/nginx/实际 HTTPS 主机仍需部署环境验证，本机没有把这些验证冒称为已完成上线。
