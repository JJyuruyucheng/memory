# 朝夕 · Memory

为两个人记录平凡小事和重要时刻的温柔生活记录本。时间线、文字与事件、心情、图片与少量视频、日历、统计和设置使用同一套页面。前端使用原生 JavaScript ES Modules；当前已实现的 live 模式采用 [Memos](https://github.com/usememos/memos)；免费优先的 Supabase 路线尚待适配与云端权限验收。

本项目独立保存在唯一目标仓库 [JJyuruyucheng/memory](https://github.com/JJyuruyucheng/memory)，源代码与部署配置均在该仓库内维护。

**[Pages 入口：朝夕](https://jjyuruyucheng.github.io/memory/)**。本轮 Pages 发布目标升级为 `preview`：只显示登录预览，不初始化演示数据或记录服务，不提交真实口令，也没有跳过登录或进入演示的入口。**正式账号登录与私密存储尚未上线。**

## 三种运行模式

| 能力 | Pages 登录预览 `preview` | 本地演示 `demo` | 正式模式 `live` |
| --- | --- | --- | --- |
| 登录界面 | 仅展示，不提交真实口令 | 演示身份交互，不是真实认证 | 使用真正网关与账号会话 |
| 记录与照片 | 不加载，不提供演示绕过入口 | 虚构样例及当前浏览器试写 | 通过真实后端读写 |
| 发布、评论、收藏 | 不可使用 | 本机演示数据 | 依赖正式部署与授权 |
| 双人跨设备同步 | 不支持 | 不支持 | 依赖运行中的 Memos 和共享空间 |
| 私密存储 | 不提供 | 浏览器本地数据，不是私密云空间 | 完成目标部署、权限与恢复验收后使用 |

本地默认仍为 `demo`，人物、日期、照片说明和故事均为虚构样例。该模式的数据继续保存在原浏览器中；本轮模式升级不清空已有演示记录。清除网站数据或更换设备会影响可见数据，导出文件也不等于自动云备份。本地已通过官方 Memos 26.11.1 的真实接口测试；该证据不代表 Render 生产服务已经上线，详见 [安全边界](docs/security.md)。

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

`MEMORY_MODE` 支持 `demo`、`preview`、`live`，默认 `demo`。构建先对全部 `src` JavaScript 执行 `node --check`，核对入口、静态/动态模块、样式和素材署名依赖，再复制白名单资源并重新生成 `dist/src/config.js`。唯一复制的 JSON 是 `assets/credits.json`；`.env`、部署配置、数据库、备份和文档不进入产物。`apiBase` 固定为空字符串，表示同源请求，不能通过 URL 参数切换到真实后端。

`preview` 和 `live` 在复制阶段排除 `demo-provider.js`、`sample-data.js` 及四张虚构示例 JPG，不采用“先复制再删除”。素材署名清单可保留来源记录；它不表示这些图片仍在非演示产物中。普通本地模块（包括 `login-controller.js`）自动参与依赖检查与复制。非演示入口如果仍静态导入已排除的演示模块，构建会失败；演示分支应使用动态导入。

Pages 预览构建示例（PowerShell）：

```powershell
$env:MEMORY_MODE = 'preview'
$env:MEMORY_TARGET = 'pages'
node scripts/build.mjs
```

`MEMORY_TARGET=pages` 严格拒绝 `demo` 和 `live`。回到本地演示前清除 `MEMORY_TARGET` 并设 `MEMORY_MODE=demo`，避免沿用上一条命令的环境设置。

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

`Checks` 工作流在 Node.js 22 上运行内建测试、本地演示构建和 Pages 预览构建，不执行 `npm install`。`Publish login preview to GitHub Pages` 在 `main` 更新或手动触发时执行测试，强制 `MEMORY_MODE=preview` 与 `MEMORY_TARGET=pages`，然后上传 `dist` 并部署到 `github-pages` 环境。官方 Actions 使用固定提交 SHA。

**发布边界：Pages 是公开登录预览，不是真实账号服务。** 此前公开演示站已成功部署；本轮改为登录预览，实际切换以新的 Actions 成功记录及线上 `config.js` 的 `preview` 值为准。仓库已公开，真实资料和凭证不提交仓库；正式私密服务不由 Pages 承担。

需要仓库管理员把 Pages 构建源设为 **GitHub Actions**。源仓库私有不代表 Pages 网站私有；私有仓库是否能启用 Pages 取决于账号套餐，不能通过本项目自动改变仓库公开性。[GitHub 官方能力](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[私有发布条件](https://docs.github.com/en/enterprise-cloud%40latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)。

Pages 只托管静态页面，不能运行 Memos、数据库或私密存储。Actions 负责构建，不是常驻后端；Codespaces 会停止，也不作为长期服务。GitHub 官方亦不建议 Pages 承担发送密码等敏感交易，因此预览不会尝试真实账号登录。[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

## 正式使用

当前优先 [免费起步方案](docs/hosting-free.md)：Cloudflare Pages 托管前端，Supabase Free 提供原生认证、数据库与私有媒体，Turnstile 负责验证码。免费额度、低活跃暂停、账号连接及真实权限验收是前提；Supabase provider 尚未实现，不能称正式登录或云端存储已经上线。现有 Memos/Render 模板保留为付费备选，没有创建资源或订阅。口令和私密密钥不写入仓库或浏览器构建包。

已有底座证据：本地使用官方 **Memos 26.11.1 Windows release** 和独立临时数据库验证两个成员及管理员登录、`SPACE` 共享、PNG 媒体鉴权、评论、回应/收藏、软删恢复及含媒体的内容导出。安全网关验证验证码后转交官方 Connect 与会话 Cookie，访问令牌仅保留在内存；本轮也已通过实际网关联测，Cloudflare Siteverify 使用测试替身。演示浏览器的发布、刷新保留和评论也已检查；这些证据不等于新的 Render 网关或正式双设备使用已经验收。

尚未验证的部分包括 Docker/Render 容器实际运行、目标主机 TLS 与 Cookie 属性、实际视频设备兼容性及整卷备份恢复。托管费用、开通步骤及限制见 [Render 托管指南](docs/hosting-render.md)，真实测试复现命令见 [部署文档](docs/deployment.md) 和 [实现架构](docs/architecture.md)。本地演示的身份切换不是认证实现；也没有部署自动清理或自动备份任务。

日常使用两个成员账号，维护使用一个独立管理员账号；管理员可以由其中一位成员持有。原生管理员具有服务器及 Memos 相应管理权限，本项目不承诺内容对服务器管理员不可见，也未实现端到端加密。

## 开源与维护

前端原创代码按 [MIT License](LICENSE) 发布。Memos 是由其原维护者和社区独立维护的上游项目，本项目复用其后端能力，并非 Memos 官方产品或分支的官方发布。使用、修改或分发 Memos 时需保留上游 [许可证及版权声明](https://github.com/usememos/memos/blob/main/LICENSE)。本项目的许可证不替代第三方素材和上游代码各自的授权。

UI 资源按单个组件选用，已核实并适配一段 Uiverse 按钮图标交互，未借用资源库的整站外观。实际来源、未提取的站点及改动范围见 [组件来源](docs/component-sources.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。

构建产物不包含真实数据、个人凭证和 Memos 数据卷。升级上游前先备份，并重新验证登录、共享空间隔离、媒体授权和数据恢复；不要直接跟随未固定的镜像标签升级。
