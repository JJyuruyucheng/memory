# 朝夕 · Memory

为两个人记录平凡小事和重要时刻的温柔生活记录本。时间线、文字与事件、心情、图片与少量视频、日历、统计和设置使用同一套页面。前端使用原生 JavaScript ES Modules；正式版以 [Memos](https://github.com/usememos/memos) 为认证和数据后端。

本项目独立保存在唯一目标仓库 [JJyuruyucheng/memory](https://github.com/JJyuruyucheng/memory)，源代码与部署配置均在该仓库内维护。

**[在线演示：朝夕 · 我们的记忆](https://jjyuruyucheng.github.io/memory/)**。GitHub Pages 只发布公开演示模式；试写和照片保存在当前浏览器，不是双人云同步。页面中的人物、日期、照片说明和故事均为虚构样例。

## 演示版与正式版

| 能力 | Pages 演示版 | 正式版部署目标 |
| --- | --- | --- |
| 浏览页面与样例 | 可使用 | 可使用 |
| 体验发布、评论、收藏等交互 | 仅当前浏览器的演示数据 | 通过 Memos 接口读写 |
| 演示身份切换 | 便于检查双方与管理员视角，不是账号认证 | 真实 Memos 登录 |
| 双人跨设备同步 | 不支持 | 依赖运行中的 Memos 和共享空间 |
| 私人照片与视频 | 请勿在公开演示站存放私人资料 | 需要受保护的媒体接口及部署验证 |
| 隐私与可靠性承诺 | 无真实私密空间 | 完成部署、权限、备份恢复验收后才可使用 |

演示数据保存在当前浏览器时，清除网站数据、换浏览器或换设备会影响可见数据；它不是云备份。下载导出文件也不等于已配置自动备份。本地已启动官方 Memos 26.11.1 并通过真实接口集成测试；Docker、反向代理、HTTPS 和目标主机恢复演练仍待部署验收，详见 [安全边界](docs/security.md)。

## 本地运行

需要 Node.js 22 或更新版本，不需要安装 npm 依赖。先构建，再运行仅绑定本机的 QA 服务：

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

访问 `http://127.0.0.1:5173/`。页面使用相对资源路径和 Hash 路由，可在仓库子路径部署。

修改源码时可直接预览：

```sh
node scripts/serve.mjs --source
```

服务默认优先使用 `dist`，不存在构建产物时使用源码白名单。它不会把整个仓库作为静态目录暴露；只允许首页、`src` 中的 JavaScript/CSS、媒体字体，以及唯一明确允许的素材署名清单 `assets/credits.json`。也可使用 `--port 5174` 指定其他本机端口。此服务用于本地 QA，不能替代正式反向代理或 Memos 服务。

## 构建模式

默认 `MEMORY_MODE=demo`。构建先对全部 `src` JavaScript 执行 `node --check`，核对入口、模块、样式和素材署名依赖，再复制白名单资源并重新生成 `dist/src/config.js`。唯一复制的 JSON 是 `assets/credits.json`；`.env`、部署配置、数据库、备份和文档不进入公开产物。`apiBase` 固定为空字符串，表示同源请求，不能通过 URL 参数切换到真实后端。

PowerShell 正式构建示例：

```powershell
$env:MEMORY_MODE = 'live'
$env:MEMORY_SPACE = 'spaces/你的空间ID'
node scripts/build.mjs
```

Shell 示例：

```sh
MEMORY_MODE=live MEMORY_SPACE=spaces/your-space-id node scripts/build.mjs
```

缺少有效 `MEMORY_SPACE` 的真实模式会构建失败。空间 ID 是资源标识，不是授权凭证；用户是否能读取和修改内容仍须由 Memos 验证。构建产物中不得放账号口令、Token、SMTP 密码或私人样例。

## GitHub 部署

`Checks` 工作流在 Node.js 22 上运行内建测试和演示构建，不执行 `npm install`。`Publish demo to GitHub Pages` 在 `main` 更新或手动触发时执行测试，强制构建 `demo`，然后上传 `dist` 并部署到 `github-pages` 环境。官方 Actions 使用固定提交 SHA。

**实际发布状态：已上线公开演示版。** 仓库已设为公开，Pages 构建源为 GitHub Actions；部署工作流成功，线上首页、演示配置和素材署名接口已验证 HTTP 200。正式私密服务不由 Pages 承担。

需要仓库管理员把 Pages 构建源设为 **GitHub Actions**。源仓库私有不代表 Pages 网站私有；私有仓库是否能启用 Pages 取决于账号套餐，不能通过本项目自动改变仓库公开性。[GitHub 官方能力](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[私有发布条件](https://docs.github.com/en/enterprise-cloud%40latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)。

Pages 只托管静态页面，不能运行 Memos 和数据库。Actions 负责构建，不是常驻后端；Codespaces 会停止，也不作为长期服务。GitHub 官方亦不建议 Pages 承担发送密码等敏感交易，因此该工作流不发布真实登录模式。[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

## 正式使用

正式版需要另行运行 Memos、数据库与媒体持久存储，并把网站及其 API 放在同一 HTTPS 来源。已在本地用官方 **Memos 26.11.1 Windows release** 和独立临时数据库验证两个成员及管理员登录、`SPACE` 共享、PNG 媒体鉴权、评论、回应/收藏、软删恢复及包含媒体的内容导出。认证使用官方 Connect 接口与会话 Cookie，访问令牌仅保留在内存。真实浏览器已检查演示发布、刷新后保留和评论；这些演示交互检查不冒充正式双设备使用测试。

尚未验证的部分包括 Docker/nginx 实际运行、目标主机 TLS 与 Cookie 属性、实际视频设备兼容性及整卷备份恢复。部署材料与真实测试复现命令见 [部署文档](docs/deployment.md) 和 [实现架构](docs/architecture.md)。公开演示的本地身份切换不是认证实现；也没有部署自动清理或自动备份任务。

日常使用两个成员账号，维护使用一个独立管理员账号；管理员可以由其中一位成员持有。原生管理员具有服务器及 Memos 相应管理权限，本项目不承诺内容对服务器管理员不可见，也未实现端到端加密。

## 开源与维护

前端原创代码按 [MIT License](LICENSE) 发布。Memos 是由其原维护者和社区独立维护的上游项目，本项目复用其后端能力，并非 Memos 官方产品或分支的官方发布。使用、修改或分发 Memos 时需保留上游 [许可证及版权声明](https://github.com/usememos/memos/blob/main/LICENSE)。本项目的许可证不替代第三方素材和上游代码各自的授权。

UI 资源按单个组件选用，已核实并适配一段 Uiverse 按钮图标交互，未借用资源库的整站外观。实际来源、未提取的站点及改动范围见 [组件来源](docs/component-sources.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。

构建产物不包含真实数据、个人凭证和 Memos 数据卷。升级上游前先备份，并重新验证登录、共享空间隔离、媒体授权和数据恢复；不要直接跟随未固定的镜像标签升级。
