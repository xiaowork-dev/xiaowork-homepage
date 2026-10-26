# XiaoWork Homepage V1.0 — P4 交互、性能与上线前准备交付

- 日期：2026-10-26（Asia/Shanghai）；版本：`1.0.0-p4`；分支：`main`。
- 范围：保留 P2 视觉与 P3 项目/关于页，完善交互、素材、静态资源、验证和发布准备。真实资料继续按用户安排后续提供。
- 状态：**P4 功能、性能与本机验收完成，待用户阶段验收**；尚未生产部署，安全风险未清零。Git 交付记录见第 9 节。

## 1. 基线与设计约束

已阅读 P0 规范与确认的效果图、P0–P3 交付、PROGRESS、内容及部署说明，核对现有源码和 Git。开始时工作区干净，本地与 GitHub main 均为 `9d5983d96d1bd04d4b82a0c23566a2c63cad7018`。使用既有用户授权身份，不重设全局身份、不强推或覆盖远端历史。

P0 原阶段表中的 P4 主要聚焦 Docker，本次按用户最新指令扩展为交互、性能与上线前准备；不改写原设计文档。三份原件 SHA256 保持与 P3 一致。首页结构、渐变/网格、颜色、字体、圆角、卡片与深浅主题保留，没有大规模重构；新增内容继续使用 Nuxt 4 静态站和 TypeScript 配置，无数据库、后台、远程字体或新增项目运行依赖。

## 2. 完成功能与修正

### 项目目录与交互

- 搜索名称、简介和已确认的技术栈，支持 Enter/按钮提交、大小写无关、多词全部匹配。输入最长 100 字，不把用户输入作为正则表达式或 HTML 执行。
- 分类与搜索可组合；支持推荐顺序、精选优先、名称正/倒序。不编造项目日期或“最近上线”顺序。
- `category`、`q`、`sort` 保存到 URL，刷新、内部跳转返回和浏览器返回恢复条件。静态 HTML 共用，查询状态在 hydration 后恢复，避免直达查询链接的 DOM 不匹配；无 JS 时仍能阅读预渲染的完整列表。
- 结果数量播报、空分类、无搜索结果和重置。重置后将焦点交还搜索框；未添加项目时保留空状态，不生成假作品。
- 移动菜单 Enter/Escape、导航关闭及焦点恢复；修正点击当前页面链接时菜单仍可能保持展开的情况。
- 未确认的项目官网/源码继续隐藏，入口区域是不可交互的待确认说明；没有虚构项目链接或把无链接卡片设成假按钮。
- 保留主题头部同步恢复和持久化；内链、Hero、菜单、排序和筛选均实际测试。关于页与项目入口的无障碍名称包含可见文字，修复 Lighthouse 找到的“前往”名称不匹配问题。

### 封面与素材

- 每项目独立路径沿用 P3，新增可选 `coverSources.avif/webp`，通过原生 picture/source 选择格式；`cover` 兼容现有 SVG/PNG/JPEG 及现代格式，不增加图片服务。
- 960×600 属性和 16:10 显示区域预留空间；首张封面 eager + high priority，其余 lazy + async。首页首张图在部分手机首屏中可见，依据实际 LCP 报告调整加载优先级。
- 原图失败 → 明确占位图 → 相同比例文字后备，最多两次请求，不反复触发错误。实际故障测试发现优先图片可能在 Vue 接管前失败，增加挂载检查后复测通过。
- 原图/占位图双 404 时，首张区域实测约 376.22×235.14px，保持 16:10；访问日志各一次失败请求。测试使用独立端口与 Nginx 故障配置，不删除真实资源。
- 三项目仍使用已确认的占位图，没有接入真实截图或自动抓取第三方图片。AVIF/WebP 配置机制已完成；真实变体未提供，尚未进行实际素材的跨浏览器解码/清晰度验收。
- 更新 [内容配置](../CONTENT.md) 与 [封面替换说明](../../public/images/projects/README.md)，包括审批边界、格式、尺寸、压缩、alt、缓存和版本化文件名。

### 响应式与静态运行

- 320px 截图发现搜索区域被排序挤窄，修正为窄屏分行；搜索输入与按钮保留同一行，排序单独占满可用宽度。
- Nginx 开启 gzip、图片一天缓存，保留哈希 JS/CSS 一年 immutable 和页面/主题重新验证。没有延后主题恢复脚本换分数，也没有牺牲已验收视觉。
- 修正 Nginx location 添加缓存头后丢失上层安全头的问题；显式引入统一 nosniff、Referrer-Policy、X-Frame-Options 与 Permissions-Policy。
- Compose 增加 10 MB × 3 文件日志轮转；保留非 root、只读根目录、临时 /tmp、ALL capabilities 移除、no-new-privileges 和回环端口。

## 3. 主要修改文件

| 文件                                                                               | 内容                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `app/pages/projects.vue`、`app/utils/project-catalog.ts`                           | 搜索、排序、组合筛选、查询恢复和空状态      |
| `app/components/ProjectCard.vue`、`app/types/project.ts`                           | 现代格式、图片优先级、两层后备与可访问入口  |
| `app/pages/index.vue`                                                              | 仅传递首张封面的加载策略，首页视觉结构保持  |
| `app/components/SiteHeader.vue`、`app/pages/about.vue`                             | 当前链接关闭移动菜单、按钮名称修正          |
| `app/assets/css/main.css`                                                          | 搜索/排序控件、窄屏分行及文字后备样式       |
| `deploy/nginx.conf`、`deploy/security-headers.conf`、`Dockerfile`                  | 压缩、缓存与统一安全头                      |
| `compose.yaml`、`.env.example`                                                     | p4 默认标签、日志轮转                       |
| `scripts/catalog.test.mjs`、`scripts/smoke.mjs`、`scripts/performance-summary.mjs` | 组合逻辑/输入测试、响应头冒烟、真实性能汇总 |
| `package.json`、`package-lock.json`                                                | p4 版本和测试命令；依赖版本不变             |
| `README.md`、`docs/CONTENT.md`、`public/images/projects/README.md`                 | 运行、搜索与素材维护                        |
| `docs/DEPLOYMENT.md`、`docs/RELEASE-CHECKLIST.md`                                  | 缓存、日志、故障验证、发布条件与风险维护    |
| 本文件、`docs/PROGRESS.md`、`docs/evidence/P4-*`                                   | 阶段记录、真实报告和截图                    |

## 4. 性能实测

工具为临时 npm exec 运行的 Lighthouse 13.5.0，未加到应用依赖。Chrome 155，无扩展；手机默认模拟为 412×823、DPR 1.75，4 倍 CPU、150ms RTT、1638.4 Kbps throughput；desktop 使用官方 preset。P3 基线为 `p3-verified` 静态镜像 / 3102，P4 最终为 `p4-qa-final` / 3103，均为本机 Nginx。其他日常服务保持运行，非专用性能硬件。首页各三次、取中位数；最终轮没有并行构建或浏览器验收。

| 首页手机指标 | P3 基线中位数           | P4 最终中位数           |
| ------------ | ----------------------- | ----------------------- |
| 性能分       | 94（三次 92 / 94 / 94） | 98（三次 97 / 98 / 98） |
| FCP          | 2405.57 ms              | 1713.33 ms              |
| LCP          | 2630.57 ms              | 2041.65 ms              |
| CLS          | 0                       | 0                       |
| TBT          | 5.50 ms                 | 39.50 ms                |
| Speed Index  | 2405.57 ms              | 3170.32 ms              |
| 实际总传输量 | 277,863 B               | 127,539 B               |

LCP 中位数下降约 22.4%，总传输减少约 54.1%。TBT 和 Speed Index 没有同步改善，未隐去该回归，也不声称每项指标都提高；当前 TBT 仍较小，后续在真实素材/设备与真实流量中复查主线程和可视完成时间。压缩与图片优先级同时调整，不能将改善全部归因于单一改动。

| 最终单次报告 | 性能 / 可访问性 / 最佳实践 / SEO | LCP        | CLS | TBT      |
| ------------ | -------------------------------- | ---------- | --- | -------- |
| 首页桌面     | 100 / 100 / 100 / 100            | 453.66 ms  | 0   | 0 ms     |
| 项目页手机   | 98 / 100 / 100 / 100             | 2037.59 ms | 0   | 57.50 ms |
| 关于页手机   | 98 / 100 / 100 / 100             | 1809.95 ms | 0   | 59.50 ms |

本机最终 generate 的全部 JS/CSS（包括懒加载路由和错误页）为 267,172 B，逐文件 gzip 合计 98,327 B；这不是首页实际传输量，也不是仅初始 bundle。明细在 [汇总 JSON](../evidence/P4-performance-summary.json)。原始结果为 `P4-baseline-mobile-{1,2,3}.json`、`P4-final-mobile-{1,2,3}.json` 及各页面报告，可执行 `node scripts/performance-summary.mjs` 重算。`P4-diagnostic-*` 是精修前诊断轮，保留但不混入最终统计；`P4-a11y-before.json` 记录已修正的名称问题，最终关于页该检查 score=1。

剩余诊断主要为网络依赖树、偶发 forced reflow 和 bfcache 内部错误；后者标注 Not actionable，不通过改动应用来掩盖。关于页仍有小型主题脚本等阻塞提示；没有使用大型依赖或大规模架构改动追分。

Lighthouse 为实验室检测，TBT **不能替代 INP**。正式域名和真实访问数据尚无，CrUX/真实用户 LCP、CLS、INP 未测；P5 发布后补。系统字体无需远程字体下载；主题同步脚本为避免错误主题闪烁保留。真实项目图片到齐后需重新评估图片大小和 LCP，不能把小型占位图的成绩当作最终素材成绩。

## 5. 浏览器、SEO 与可访问性

最终候选前的视觉版及图片修正后的候选均使用本机实际浏览器；最终 30 组几何数据保存在 [响应式结果](../evidence/P4-responsive-results.json)。最后的名称修正不改布局，另做浏览器和 Lighthouse 复验。每页一个 h1，主要容器和控件均在可用宽度内，无卡片重叠；视口宽度包含 15px 滚动条。

| 宽度 | 内容宽/滚动宽 | 首页/项目列数 | 三页 × 两主题 |
| ---- | ------------- | ------------- | ------------- |
| 320  | 305 / 305     | 1             | 通过          |
| 390  | 375 / 375     | 1             | 通过          |
| 768  | 753 / 753     | 2             | 通过          |
| 1024 | 1009 / 1009   | 2             | 通过          |
| 1440 | 1425 / 1425   | 3             | 通过          |

- 搜索 Enter/按钮、网站/应用/空分类、组合无结果、重置焦点、名称排序、查询直达/刷新、桌面/手机返回均通过。自动检查需等待路由完成；首次过早读取的历史状态与修正后的明确等待结果均保留在 [浏览器记录](../evidence/P4-browser-checks.json)，不把未完成导航当作应用错误。
- 菜单 Enter、Escape、导航后关闭和当前链接关闭均通过；Hero Enter、Tab 及重置焦点轮廓可见。卡片行等高，悬停轻微位移保持原设计；无资料项目没有可点击入口或额外 tabindex。
- 深/浅切换后刷新正确保留，观察没有明显错误主题闪烁；未做逐帧闪烁测量。正常页面控制台 warn/error 查询为空；故障图片源的预期 404 单独记录。
- 三页独立 title/description、OG/Twitter、中文语言及语义结构在静态 HTTP 和浏览器中复查。正式域名空时无假 canonical/绝对分享地址，robots 正常、sitemap 为 404；本机 origin 的独立镜像实测三页 sitemap、canonical、绝对分享图与 robots 声明。
- 分享图仍为本地自有 1200×630 品牌图，不冒充项目截图。Lighthouse 自动可访问性/对比度检查采用默认深色；浅色经实际浏览器逐页检查，未单独跑浅色 Lighthouse。自动 100 分不代表完整 WCAG 认证或全面逐元素人工对比度审核。
- prefers-reduced-motion 规则实际存在，取消位移/缩放和长过渡；当前浏览器系统偏好为 false，**没有系统偏好仿真**。未进行完整读屏、Firefox/Safari 或真实手机测试。
- 本站 GitHub 的 URL/target/rel 正确且远端存在，已实际点击；IAB 没有提供外部窗口句柄，因此没有宣称核验外部浏览器页面。其他未确认入口继续隐藏。

截图为原始浏览器 JPEG，未拼接或替换页面内容；保存前核对主题与布局，并逐张总览复核。证据包含桌面/手机三页双主题、320px、平板、搜索空结果、完整卡片、两层后备及公开入口：

| 场景             | 证据                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页桌面深/浅    | [深色](../evidence/P4-home-desktop-dark.jpg)、[浅色](../evidence/P4-home-desktop-light.jpg)                                                                     |
| 首页手机深/浅    | [深色](../evidence/P4-home-mobile-dark.jpg)、[浅色](../evidence/P4-home-mobile-light.jpg)                                                                       |
| 项目桌面深/浅    | [深色](../evidence/P4-projects-desktop-dark.jpg)、[浅色](../evidence/P4-projects-desktop-light.jpg)、[完整卡片](../evidence/P4-projects-desktop-dark-cards.jpg) |
| 项目手机深/浅    | [深色](../evidence/P4-projects-mobile-dark.jpg)、[浅色](../evidence/P4-projects-mobile-light.jpg)、[搜索](../evidence/P4-projects-mobile-search.jpg)            |
| 窄屏/平板/空结果 | [320px](../evidence/P4-projects-320-light.jpg)、[768px](../evidence/P4-projects-tablet-light.jpg)、[无结果](../evidence/P4-projects-search-empty.jpg)           |
| 关于桌面深/浅    | [深色](../evidence/P4-about-desktop-dark.jpg)、[浅色](../evidence/P4-about-desktop-light.jpg)、[公开入口](../evidence/P4-about-public-entry-dark.jpg)           |
| 关于手机深/浅    | [深色](../evidence/P4-about-mobile-dark.jpg)、[浅色](../evidence/P4-about-mobile-light.jpg)                                                                     |
| 图片故障         | [占位后备](../evidence/P4-cover-fallback-image.jpg)、[文字后备](../evidence/P4-cover-fallback-text.jpg)                                                         |

## 6. 工程与 Docker 验证

| 检查                           | 实际结果与证据                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 单元测试                       | `npm test`，4 项：组合筛选、排序、查询异常/边界、SEO origin；通过                                                                                                              |
| ESLint / Prettier / TypeScript | `npm run check` 通过；[日志](../evidence/P4-code-checks.txt)                                                                                                                   |
| 生产 build / 静态 generate     | 通过，默认 generate 9 个预渲染产物；[日志](../evidence/P4-build-check.txt)                                                                                                     |
| 从 lockfile 安装               | Docker 多阶段 npm ci + prepare + generate 通过；无宿主依赖复用                                                                                                                 |
| HTTP 默认域名                  | 五种页面路径、22 资源、独立 SEO、health/404、重定向、压缩/缓存/安全头；[报告](../evidence/P4-http-smoke-domainless.txt)                                                        |
| HTTP 配置 origin               | `p4-seo-check` / 3104，本机 origin 分支全部通过；[报告](../evidence/P4-http-smoke-origin-configured.txt)                                                                       |
| Compose / Bash                 | 最终 Compose config 与四个脚本分别 bash -n 全通过；[日志](../evidence/P4-config-check.txt)                                                                                     |
| 运行限制                       | nginx 用户，healthy，readonly=true，ALL cap drop，no-new-privileges，日志轮转，回环 3103；实际验证无 Node、根目录写入拒绝、/tmp 可写；[报告](../evidence/P4-runtime-check.txt) |
| 一键正常路径                   | 独立副本、独立 Compose 项目和部署状态：deploy P3 → update P4 → rollback P3 → rollback P4 → 重复 deploy 均成功；旧标签更新按预期拒绝                                            |
| 构建失败注入                   | 副本 Dockerfile 故意构建失败，退出非零，旧 `p4-reviewed` 容器保持 healthy                                                                                                      |
| 健康失败注入                   | 仅测试镜像 HEALTHCHECK 故意失败，update 返回非零，自动恢复 `p4-reviewed` healthy，current 未改写                                                                               |
| P0 原件                        | 三份 SHA256 与 P1/P3 一致，未编辑                                                                                                                                              |

部署全过程日志为 [P4-deployment-check.txt](../evidence/P4-deployment-check.txt)。故障只注入 `.cache/p4-deploy` 副本并恢复，未改正式 Dockerfile、未读取/覆盖用户真实环境文件或主目录部署记录。单副本可能短暂停机，不承诺零停机；Docker 故障、磁盘满或旧版也不健康时恢复仍可能失败。

没有生产连接、生产反代/TLS/DNS、真实 Linux 服务器或备份介质恢复测试；没有全局 prune、删卷或操作其他项目容器。验收后仅清理本次命名的隔离容器/网络与临时副本，保留镜像；开发预览为 `http://127.0.0.1:3100/projects`。

## 7. 安全审计与遗留

`npm audit --json` 实际返回 7 个 high 条目，**审计未通过**，同源于 node-forge 1.4.0 的 RSA PKCS#1 v1.5 验签告警 GHSA-86w9-cpqp-85rv。依赖链为 Nuxt 4.6.2 → @nuxt/nitro-server 4.6.2 → Nitro 2.13.5 → listhen 1.10.1 → node-forge 1.4.0。

2026-10-26 重新核查官方 GitHub Advisory API（公告更新于 2026-10-01）及 npm 注册表：受影响 `<=1.4.0`，first_patched_version 为空，npm 最新仍为 1.4.0。审计建议退回 Nuxt 4.1.3，未执行 force、Nuxt 降级或未经验证的 override。原始 [审计](../evidence/P4-npm-audit.json) 和 [官方公告摘录](../evidence/P4-advisory-check.json) 可复核。

提交前也逐项查询了 Nuxt、@nuxt/nitro-server、Nitro、listhen 和 node-forge 的官方 npm 最新版本，均与当前安装版本相同，未发现可绕开该依赖链的兼容新发布。见 [注册表核对](../evidence/P4-registry-versions.json)。

本站未调用 RSA 验签功能，最终静态镜像实际无 Node 运行时，生产运行暴露面有限；开发/构建依赖风险仍保留。开发服务只绑定回环，不引入不可信签名/证书构建输入；发布前及每周维护重查兼容修复，更新后按相同流程复验。未完成基础镜像 OS 层 CVE 扫描，npm audit 不代表完整供应链审计。Windows 中文路径 Nitro external dependency 警告仍在，build/generate 成功；Linux 镜像构建没有该警告。

## 8. 上线前待补与 P5 建议

1. Blog/Nav/ERP 真实封面、逐项确认的技术栈和状态、官网/源码；ERP 必须可公开且脱敏，未开放的入口继续隐藏。
2. 详细个人介绍、公开联系、可选简历、最终品牌素材；不使用 Git 邮箱推断公开联系方式。
3. 正式 HTTPS origin，到齐后新标签重建并复验 canonical/OG/sitemap/robots；目前不声称正式 SEO 发布完备。
4. 取得独立生产授权后确认服务器、反代网络、端口、TLS、备份与回滚标签，先评审具体发布方案，再执行 P5；不将 P4 本机验证视为生产授权。
5. 真实素材接入后复测性能，补真实设备、Firefox/Safari、读屏和系统减少动效；真实域名有访问数据后补核心网页指标，尤其 INP。
6. 发布前重新审计并评估尚未修复的构建风险、基础镜像 CVE 与 digest 固定策略。保留旧镜像/环境/状态，做真实拓扑健康与回滚验收。

## 9. Git 交付

本阶段代码、配置、文档与证据一起正常提交到既有 main，并推送 origin/main。提交前不会自引用尚不存在的 SHA；实际提交 SHA、推送与远端核验结果在提交后通过独立文档记录补入本节，最终回复同时报告。当前以 Git 历史和远端状态为准，不伪造成功记录。

关联：[P0](../../XiaoWork_Homepage_V1_Design_Spec.md)、[P1](P1-delivery.md)、[P2](P2-delivery.md)、[P3](P3-delivery.md)、[进度](../PROGRESS.md)、[运行说明](../../README.md)、[发布检查](../RELEASE-CHECKLIST.md)。
