# 朝夕 · Memory

为两个人记录平凡小事和重要时刻的温柔生活记录本。时间线、文字与事件、心情、图片与少量视频、日历、统计和设置使用同一套页面。前端使用原生 JavaScript ES Modules；免费优先模式接入官方 Supabase SDK、认证、数据库与私有存储；原有 Memos 模式保留为自托管备选。

本项目独立保存在唯一目标仓库 [JJyuruyucheng/memory](https://github.com/JJyuruyucheng/memory)，源代码与部署配置均在该仓库内维护。

源码版本 **v0.16.0**。发布记录时可以在正文插入 Emoji，或把 GIF 等表情包作为私密附件添加。「问瓜子」可从选中的共享记录读取正文。详见 [修改日志](CHANGELOG.md)、[v0.7.0 验证记录](docs/release-v0.7.0.md) 和 [照片协议](docs/login-photos.md)。

**[Cloudflare 正式入口：朝夕](https://memory-awv.pages.dev/)** 已上线；用户已确认使用 `xbl` 完成真实 Turnstile 与口令登录并进入时间线。原生 Auth 已拒绝缺失和伪造验证码，真实用户 JWT 下的记录与私有图片权限探针也已通过。真实验证码 token 的过期与重放拒绝仍待专项验收。[GitHub Pages](https://jjyuruyucheng.github.io/memory/) 继续作为 `preview`：不加载记录、不提交真实口令，也没有跳过登录入口。

## 四种运行模式

| 能力 | GitHub Pages 预览 `preview` | 本地演示 `demo` | Memos 自托管 `live` | Supabase 免费托管 `supabase` |
| --- | --- | --- | --- | --- |
| 登录界面 | 仅展示，不提交真实口令 | 演示身份交互，不是真实认证 | 网关验证码与 Memos 账号会话 | 原生 Auth 与 Turnstile；用户已确认真实登录成功 |
| 记录与照片 | 不加载，不提供演示绕过入口 | 虚构样例及当前浏览器试写 | 通过 Memos 读写 | 登录后经数据库 RLS 与私有 Storage 读写 |
| 发布、评论、收藏 | 不可使用 | 本机演示数据 | 依赖正式部署与授权 | 已实现，依赖真实会话与数据库授权 |
| 双人跨设备同步 | 不支持 | 不支持 | 依赖运行中的 Memos 和共享空间 | 共享云端数据，双设备使用仍待验 |
| 私密存储 | 不提供 | 浏览器本地数据，不是私密云空间 | 完成目标部署、权限与恢复验收后使用 | 私有桶真实 HTTP 权限验收已通过，完整恢复仍待验 |

本地默认仍为 `demo`，人物、日期、照片说明和故事均为虚构样例。演示记录继续保存在原浏览器中；演示轮播照片仅保存在当前页面内存，刷新即清空。本轮模式升级不清空已有演示记录。清除网站数据或更换设备会影响可见数据，导出文件也不等于自动云备份。本地已通过官方 Memos 26.11.1 的真实接口测试；该证据不代表 Render 生产服务已经上线，详见 [安全边界](docs/security.md)。

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

日期控件采用 [Air Datepicker 3.6.0](https://github.com/t1m0n/air-datepicker/tree/v3.6.0)（MIT），本地打包、中文定制；版本、SHA-256 与原许可证记录在 `vendor/air-datepicker.lock.json`。QA 服务仅额外开放明确列名的日期组件文件与许可证，正式 Supabase 构建还开放已锁定的官方 SDK；没有开放任意 JS、JSON、文档或私密配置。

附件排序采用 [SortableJS 1.15.7](https://github.com/SortableJS/Sortable/tree/1.15.7)（MIT），固定版本本地打包，SHA-256 与原许可证见 `vendor/sortable.lock.json`。支持鼠标与触屏拖动；聚焦排序按钮后也可用方向键、Home、End 调整。固定版本公共组件可缓存；账号状态、业务代码与私密请求不因此改为离线缓存。

## 瓜子博客助手

登录页显示瓜子。完成 Supabase 登录并通过成员校验后，点击猫咪打开对话，按住猫咪即可在屏幕内移动。对话保留在当前页面内存里，清空、刷新或退出后移除。提问时可以带上共享记录的作者、标题或标签，也可以在记录旁点「问瓜子」。服务端按当前成员权限查找已发布的共享随记与事件，发送问题及回答所需的文字给 OpenAI。悄悄话、草稿、回收站和附件留在朝夕。聊天窗口上方可选模型，消息旁显示北京时间的时分。

询问城市天气时，瓜子向 Open-Meteo 查询城市和坐标，天气回复带数据来源。记录检索在朝夕服务端完成。〔[Open-Meteo](https://open-meteo.com/)〕

音符按钮旁可展开透明播放器，拖动时控件会一起移动。播放时音符按钮旁会弹出五彩音符，拖到四边会收起一半。两位成员共享歌单、曲目和播放模式，各自开关声音和歌词。进入「我们与设置 → 背景音乐」，点曲目的「…」上传音源和带时间标记的 LRC 歌词。点「词」后歌词随进度更新，可从文字处拖动，旁边的样式按钮可切换横排或竖排并调节字号和透明度。歌词位置与样式保存在当前浏览器。〔[Chrome 播放规则](https://developer.chrome.com/blog/autoplay)〕

管理小屋按前台活跃分钟统计两位成员的使用时长。页面切到后台或闲置五分钟后暂停，同一账号同一分钟只统计一次，时间从本功能上线起累计。

瓜子的走、跑、跳使用以原始全身照和头像为参考生成的透明动作帧。待机、思考和蜷睡使用原图，收到回复会轻跳，短时间连点三次会短暂闹脾气。闲置约 18 秒会蜷睡，贴边探头会显示完整头像。开启减少动态效果时使用静态姿势。

本机从 PowerShell 7 启动 Supabase 模式。掩码输入的新密钥只留在当前终端和本地服务进程的环境中。`OPENAI_MODEL` 可覆盖默认的 `gpt-6.1-terra`。

```powershell
node scripts/build-cloudflare.mjs
$env:OPENAI_API_KEY = Read-Host '输入新的 OpenAI API 密钥' -MaskInput
node scripts/serve.mjs --port 5187
```

访问本地 `http://127.0.0.1:5187/`，登录后试发一条消息。真实登录使用原有 Supabase 和 Turnstile 配置，本地域名需在对应 Turnstile 站点的允许范围内。可运行 `node --test tests/assistant.test.mjs`，用模拟上游核对登录拦截、共享记录权限、天气数据和 API 错误处理。测试不需要密钥。〔[Turnstile 本地测试说明](https://developers.cloudflare.com/turnstile/troubleshooting/testing/#local-development)〕

Cloudflare Pages 项目 `memory` 在 **Workers & Pages → memory → Settings → Variables and Secrets** 添加加密密钥 `OPENAI_API_KEY`。需要换模型时，添加普通变量 `OPENAI_MODEL`。部署后由 `functions/api/assistant.js` 在同源 `/api/assistant` 读取运行时配置。GitHub Pages 登录预览仅显示猫咪。〔[Cloudflare Pages 运行时绑定](https://developers.cloudflare.com/pages/functions/bindings/#secrets) · [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)〕

## 维护更新信息

每次产品更新在 `src/releases.js` 顶部追加一条唯一编号、日期、`v0.0.0` 版本与改动，再执行 `node scripts/generate-changelog.mjs`。站内“系统更新信息”直接读取同源数据；测试会检查 `CHANGELOG.md` 未发生漂移。较早版本根据实际 Git 提交补记，编号与版本的补记边界在修改日志中说明。

## 构建模式

免费模式使用 `MEMORY_MODE=supabase`；当前 Cloudflare 构建命令为 `node scripts/build-cloudflare.mjs`，读取 [公共部署配置](deploy/cloudflare.public.mjs)，产物目录为 `dist`。配置包含项目 URL、publishable 公共密钥、Turnstile Site Key 和用于管理面板的容量数值。`authReady` 由维护者在受控验收或正式开放时启用，不能替代后端授权。SDK 版本固定为 2.119.0，构建校验 SHA-256 并本地打包，带出原 MIT 许可证和 Cloudflare CSP 响应头。私有资料、示例记录、后台密钥和口令均不进入此产物。环境变量入口仍见 [cloudflare.env.example](deploy/cloudflare.env.example)，正式配置与验收进度见 [免费托管指南](docs/hosting-free.md)。

`MEMORY_MODE` 支持 `demo`、`preview`、`live`、`supabase`，默认 `demo`。构建先对全部 `src` JavaScript 执行 `node --check`，核对入口、静态/动态模块、样式和素材署名依赖，再复制白名单资源并重新生成 `dist/src/config.js`。唯一复制的 JSON 是 `assets/credits.json`；`.env`、部署配置、数据库、备份和文档不进入产物。`apiBase` 固定为空字符串供 Memos 使用；Supabase 的 HTTPS 项目 URL 另由构建校验，不能通过 URL 参数替换后端。

`preview` 和 `live` 在复制阶段排除 `demo-provider.js`、`sample-data.js` 及四张虚构示例 JPG，不采用“先复制再删除”。素材署名清单可保留来源记录；它不表示这些图片仍在非演示产物中。普通本地模块（包括 `login-controller.js`）自动参与依赖检查与复制。非演示入口如果仍静态导入已排除的演示模块，构建会失败；演示分支应使用动态导入。

Pages 预览构建示例（PowerShell）：

```powershell
$env:MEMORY_MODE = 'preview'
$env:MEMORY_TARGET = 'pages'
node scripts/build.mjs
```

`MEMORY_TARGET=pages` 严格拒绝除 `preview` 外的模式。回到本地演示前清除 `MEMORY_TARGET` 并设 `MEMORY_MODE=demo`，避免沿用上一条命令的环境设置。

PowerShell Memos 自托管构建示例：

```powershell
$env:MEMORY_MODE = 'live'
$env:MEMORY_SPACE = 'spaces/你的空间ID'
node scripts/build.mjs
```

Shell 示例：

```sh
MEMORY_MODE=live MEMORY_SPACE=spaces/your-space-id node scripts/build.mjs
```

缺少有效 `MEMORY_SPACE` 的 `live` 模式会构建失败。空间 ID 是资源标识，不是授权凭证；用户是否能读取和修改内容仍须由 Memos 验证。构建产物中不得放账号口令、Token、SMTP 密码或私人样例。

## GitHub 部署

`Checks` 工作流在 Node.js 22 上运行内建测试、本地演示构建和 Pages 预览构建，不执行 `npm install`。`Publish login preview to GitHub Pages` 在 `main` 更新或手动触发时执行测试，强制 `MEMORY_MODE=preview` 与 `MEMORY_TARGET=pages`，然后上传 `dist` 并部署到 `github-pages` 环境。官方 Actions 使用固定提交 SHA。

**发布边界：GitHub Pages 是公开登录预览，不是真实账号服务。** 当前预览不加载记录或接受真实口令；Actions 强制构建为 `preview`。仓库已公开，真实资料和凭证不提交仓库；Cloudflare 正式入口的认证、数据与私有媒体由 Supabase 提供。

需要仓库管理员把 Pages 构建源设为 **GitHub Actions**。源仓库私有不代表 Pages 网站私有；私有仓库是否能启用 Pages 取决于账号套餐，不能通过本项目自动改变仓库公开性。[GitHub 官方能力](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[私有发布条件](https://docs.github.com/en/enterprise-cloud%40latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)。

GitHub Pages 只托管静态页面，不能运行 Memos、数据库或私密存储。Actions 负责构建，不是常驻后端；Codespaces 会停止，也不作为长期服务。GitHub 官方亦不建议 Pages 承担发送密码等敏感交易，因此预览不会尝试真实账号登录。[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

## 正式使用

当前使用 [免费起步方案](docs/hosting-free.md)：Cloudflare Pages 托管前端，Supabase Free 提供原生认证、数据库与私有媒体，Turnstile 负责验证码。固定三账号、业务身份与私有桶已初始化，公开注册和匿名登录已关闭。使用公共 key 的直接密码请求在缺失或伪造验证码时均被原生 Auth 拒绝；用户已在正式入口使用 `xbl` 完成真实 widget 验证与口令登录，并确认成功进入时间线。真实 token 的过期、重放拒绝尚未专项测试，双设备使用及完整恢复也仍待验。口令和私密密钥不写入仓库或浏览器构建包。

真实 HTTP 权限探针的 11 项检查已全部通过，包含九图发布、三账号鉴权下载、匿名拒绝、跨作者修改拒绝及原子换图；业务断言使用普通用户 JWT，管理员凭证只用于测试会话准备与本次测试数据清理。清理后独立查询确认测试记录、媒体登记、Storage 对象和测试会话均无残留，初始化与探针端点均已覆写为 410。探针使用管理员生成的临时 magic-link 会话，其权限结论与上述用户实际密码及验证码登录证据分别记录；详见 [验收记录](docs/verification-free.md)。

现有 Memos/Render 模板保留为付费自托管备选，没有创建其资源或订阅。

已有底座证据：本地使用官方 **Memos 26.11.1 Windows release** 和独立临时数据库验证两个成员及管理员登录、`SPACE` 共享、PNG 媒体鉴权、评论、回应/收藏、软删恢复及含媒体的内容导出。安全网关验证验证码后转交官方 Connect 与会话 Cookie，访问令牌仅保留在内存；本轮也已通过实际网关联测，Cloudflare Siteverify 使用测试替身。演示浏览器的发布、刷新保留和评论也已检查；这些证据不等于新的 Render 网关或正式双设备使用已经验收。

尚未验证的部分包括 Docker/Render 容器实际运行、目标主机 TLS 与 Cookie 属性、实际视频设备兼容性及整卷备份恢复。托管费用、开通步骤及限制见 [Render 托管指南](docs/hosting-render.md)，真实测试复现命令见 [部署文档](docs/deployment.md) 和 [实现架构](docs/architecture.md)。本地演示的身份切换不是认证实现；也没有部署自动清理或自动备份任务。

日常使用两个成员账号，维护使用一个独立管理员账号；管理员可以由其中一位成员持有。Supabase 模式中的独立管理员仍使用普通 Auth 身份，其业务权限由受保护的 profiles 与 RLS 确定；项目拥有者的云端管理权限另行保管。Memos 自托管模式的原生管理员具有相应服务器及管理权限。本项目不承诺内容对后端维护者不可见，也未实现端到端加密。

## 开源与维护

前端原创代码按 [MIT License](LICENSE) 发布。Memos 是由其原维护者和社区独立维护的上游项目，本项目复用其后端能力，并非 Memos 官方产品或分支的官方发布。使用、修改或分发 Memos 时需保留上游 [许可证及版权声明](https://github.com/usememos/memos/blob/main/LICENSE)。本项目的许可证不替代第三方素材和上游代码各自的授权。

UI 资源按单个组件选用，已核实并适配一段 Uiverse 按钮图标交互，未借用资源库的整站外观。实际来源、未提取的站点及改动范围见 [组件来源](docs/component-sources.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。

构建产物不包含真实数据、个人凭证和 Memos 数据卷。升级上游前先备份，并重新验证登录、共享空间隔离、媒体授权和数据恢复；不要直接跟随未固定的镜像标签升级。
