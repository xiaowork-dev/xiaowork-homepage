# XiaoWork Homepage V1.0 — P3 项目列表、关于页与 SEO 交付

- 日期：2026-10-25（按本次环境日期，Asia/Shanghai）；版本：`1.0.0-p3`；分支：`main`。
- 状态：**P3 功能工程与本机验证完成，等待用户页面验收；真实项目素材与个人资料按用户安排后续接入。**
- 前置：用户已验收 P2 首页截图和交付文档，正式授权进入 P3；随后明确“后面再提供，其他站也还在修复和开发”。
- 本阶段未连接、修改或部署生产服务器，没有新增依赖、数据库、后台或项目详情路由。

## 1. 基线检查与范围

已阅读 P0 设计规范、P0/P1/P2 交付与进度，重新查看确认的效果图，并核对代码、Git、GitHub main 和本机环境。开始时工作区干净，远端与本地均为 `e26e67d551ceeeea350e139d35148f880f44bf80`，使用既有的用户授权提交身份。

P2 首页布局、颜色、渐变、网格、字体层级、圆角、卡片和动效保持原样；首页页面文件仅改用共用 SEO。新增页面沿用现有设计令牌、Hero 和项目卡片。共用卡片增加图片失败回退、准确外链标签与显式待确认状态，未重新设计首页。

三份 P0 原件未修改，SHA256 与前阶段一致：

| 原件       | SHA256                                                             |
| ---------- | ------------------------------------------------------------------ |
| 设计规范   | `73E494A8E352F449AF07CC273BEA8CB526A5717D5C5A0E0ECFE51F49D43D5DC0` |
| P0 交付    | `12B9C75F6C75814F52B4433B4AB87B2D8771BF0E5EA20C1B74EB375789A62FBE` |
| 确认效果图 | `1B9DF0476F26922CC4478DD7931622ADA913FC479D111E66AF09134B6C4CAD24` |

## 2. 已完成功能

### 项目列表与配置

- `/projects` 展示全部项目，支持全部、网站、应用与工具、开源与学习分类；分类计数和结果由同一 TS 配置自动生成。
- 筛选有选中反馈、`aria-pressed`、键盘操作和结果数量播报；空分类提供说明与恢复全部按钮。修复了空状态按钮消失导致焦点丢失的问题，恢复后聚焦“全部项目”。
- 复用 16:10 封面、项目名称、简介、状态、技术栈、官网/源码入口及响应式卡片。未配置的外链隐藏，全部缺省时显示不可点击的“入口待确认”。
- `featured` 与 `order` 继续控制首页精选及排序；项目列表包含普通和精选项目，新增配置无需改页面组件。当前三个项目均仍为精选，没有虚构第四个项目来填充列表。
- 新增显式 `unconfirmed` 状态，显示“资料待确认”；不再把示例 `planning` 当作真实状态。封面类型和项目状态独立管理，原 `isPlaceholder` 字段保留兼容。

### 封面与真实资料

- `app/data/project-covers.ts` 逐项管理封面路径、alt 与类型；Blog/Nav/ERP 分别拥有独立资源目录。
- 当前封面是 P2 已验收占位图的原样副本，明确标注 PLACEHOLDER 与真实截图待补充；旧路径保留兼容。
- 图片加载失败会回退到通用占位图，并显示准确的替代文本；正常图片加载已实测，失败分支未进行浏览器故障注入。
- 没有访问或截取本机 ERP 业务页面，也没有把其他网络图片伪装成真实项目截图。

### 关于页

- `/about` 包含品牌说明、开发者身份与已确认的介绍、技术方向分组、项目开发原则、公开 GitHub 源码入口。
- 所有段落、技术分组、公开联系与可选简历集中在 `app/data/about.ts`；未确认的个人经历段落为空并显示待补提示。
- 技术标签来自 P2 已确认的展示方向，不推断三个项目采用相同技术，也不填写熟练度评分。开发原则基于本项目已确认的简洁、体验与维护要求。
- 没有虚构工作、企业、学历、获奖、开发年限或联系邮箱。Git 提交邮箱没有被当作公开联系方式；简历未配置则不显示入口。

### SEO 与分享

- 三页独立标题、描述、Open Graph 标题/描述/类型/站点名/语言与 Twitter card；SSR、静态 HTML 和客户端路由切换均验证。
- 本地品牌分享图为 `public/images/social/xiaowork-share.png`，1200×630，自有文字排版，不作为项目截图。
- 新增可选构建配置 `NUXT_PUBLIC_SITE_URL`，校验 origin 格式，拒绝非 HTTPS 公网地址、路径、查询、片段和凭据；仅 HTTP loopback 可用于本机调试。
- 正式域名未确认时不输出 canonical、`og:url` 或绝对分享图 URL；robots 可访问但不声明 sitemap，`/sitemap.xml` 返回 404。
- 设置已确认的 origin 并重新生成后，自动输出三页 canonical、绝对分享图 URL、三页 sitemap 与 robots 的 Sitemap 声明。已用本机 origin 独立构建并实际验证，没有编造公网域名。
- 沿用语义化标题、图片 alt、主内容跳转、可见焦点、移动菜单与减少动效规则，没有引入 SEO 或动画大型依赖。

## 3. 已接入与待补资料

| 对象          | 本次实际接入                                 | 尚需本人补充                                                    |
| ------------- | -------------------------------------------- | --------------------------------------------------------------- |
| XiaoWork Blog | 已确认名称、展示定位、网站分类；独立封面配置 | 真实截图、逐项确认的技术栈/状态、官网与源码地址                 |
| XiaoWork Nav  | 已确认名称、展示定位、网站分类；独立封面配置 | 同上                                                            |
| XiaoWork ERP  | 已确认名称、展示定位、应用分类；独立封面配置 | 确认可公开且无敏感信息的演示截图、技术栈/状态、是否提供公开入口 |
| XiaoWork 品牌 | P2 已确认标题、介绍与六项技术展示方向        | 最终 Logo 和更详细的个人介绍（如需替换）                        |
| GitHub        | 用户已创建、已验证的本站仓库链接             | 其他项目源码、个人主页等需单独确认                              |
| 联系与简历    | 配置机制已完成                               | 本人确认的公开联系信息、可选公开简历                            |
| 正式域名      | 构建配置、静态输出与验证机制已完成           | 正式 HTTPS origin，确认后重新构建                               |

三个项目目前没有真实截图、真实技术栈、逐项确认的状态或项目外链接入，不能将本阶段报告解读为真实资料已齐全。没有可用假链接；待补资料不阻塞页面与配置工程交付。

## 4. 主要修改文件

| 文件                                                                   | 用途                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| `app/pages/projects.vue`                                               | 全部项目、分类、计数、空状态与焦点恢复            |
| `app/pages/about.vue`、`app/data/about.ts`                             | 配置化关于页与真实内容边界                        |
| `app/data/projects.ts`、`app/types/project.ts`                         | 显式待确认状态、独立封面类型、配置排序/精选       |
| `app/data/project-covers.ts`、`public/images/projects/{blog,nav,erp}/` | 各项目独立资源与封面注册                          |
| `app/components/ProjectCard.vue`                                       | 图片回退、状态与准确外链标签                      |
| `app/assets/css/main.css`                                              | 仅追加项目/关于页样式，保留 P2 令牌和首页样式     |
| `shared/seo.ts`、`app/composables/useSiteSeo.ts`                       | 集中页面元信息与可选 origin                       |
| `app/pages/index.vue`、`nuxt.config.ts`                                | 共用 SEO、构建配置与预渲染路由                    |
| `server/routes/robots.txt.ts`、`server/routes/sitemap.xml.ts`          | 可静态生成的爬虫配置                              |
| `public/images/social/xiaowork-share.png`                              | 自有品牌分享图                                    |
| `Dockerfile`、`compose.yaml`、`.env.example`                           | origin build arg、默认 p3 标签；运行架构不变      |
| `scripts/smoke.mjs`                                                    | HTTP、每页 SEO、两种域名配置、robots/sitemap 验证 |
| `README.md`、`docs/CONTENT.md`、`docs/DEPLOYMENT.md`                   | 运行、内容接入与构建域名说明                      |
| `docs/PROGRESS.md`、本文件、`docs/evidence/P3-*`                       | 进度、交付与真实证据                              |
| `package.json`、`package-lock.json`                                    | 只更新项目版本为 p3，依赖树不变                   |

## 5. 浏览器、响应式与视觉验收

使用本机 in-app browser 检查真实 Nginx 静态容器；最终镜像为 `xiaowork-homepage:p3-verified`，独立 Compose 项目 `xiaowork-homepage-p3-preview`，仅绑定 `127.0.0.1:3102`。截图没有拼接、替换内容或伪装真实封面。

项目与关于页各测试以下七档宽度、深浅主题各一次，共 28 条测量；首页额外测试 390/1440 两主题共 4 条，共 **32 条**。均满足滚动宽等于内容宽、关键容器在视口内、每页一个 h1；项目卡片无矩形交叠。详见 [完整响应式测量](../evidence/P3-responsive-results.json)。

| 视口宽度 | 内容宽/滚动宽 | 项目列数 | 深浅主题 |
| -------- | ------------- | -------- | -------- |
| 320      | 305 / 305     | 1        | 通过     |
| 390      | 375 / 375     | 1        | 通过     |
| 768      | 753 / 753     | 2        | 通过     |
| 900      | 885 / 885     | 2        | 通过     |
| 1199     | 1184 / 1184   | 2        | 通过     |
| 1200     | 1185 / 1185   | 3        | 通过     |
| 1440     | 1425 / 1425   | 3        | 通过     |

截图保留浏览器实际输出尺寸；视口设置包含滚动条等浏览器占用，因此 JPEG 画布尺寸与设置值可能不同，没有对图片缩放以冒充更大视口。

| 场景            | 截图                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 项目页桌面深/浅 | [深色](../evidence/P3-projects-desktop-dark.jpg)、[浅色](../evidence/P3-projects-desktop-light.jpg)                                                                |
| 空分类与平板    | [空分类](../evidence/P3-projects-empty-desktop-dark.jpg)、[900px 浅色双列](../evidence/P3-projects-tablet-light.jpg)                                               |
| 项目页手机深/浅 | [深色](../evidence/P3-projects-mobile-dark.jpg)、[浅色](../evidence/P3-projects-mobile-light.jpg)、[滚动卡片](../evidence/P3-projects-mobile-dark-cards.jpg)       |
| 关于页桌面深/浅 | [深色](../evidence/P3-about-desktop-dark.jpg)、[浅色](../evidence/P3-about-desktop-light.jpg)、[开发原则与公开入口](../evidence/P3-about-desktop-dark-contact.jpg) |
| 关于页手机深/浅 | [深色](../evidence/P3-about-mobile-dark.jpg)、[浅色](../evidence/P3-about-mobile-light.jpg)                                                                        |
| 首页回归深/浅   | [深色](../evidence/P3-home-regression-desktop-dark.jpg)、[浅色](../evidence/P3-home-regression-desktop-light.jpg)                                                  |

实际交互结果：网站筛选仅 Blog/Nav，应用仅 ERP，开源 0 项有空状态；恢复全部 3 项且键盘焦点回到筛选按钮，焦点 outline 为 solid。移动菜单 Enter 打开、Escape 关闭并恢复焦点，导航跳转自动收起；首页“探索项目”、主导航和页脚内部路由正常。浅色与深色分别切换后刷新仍保留，观察无明显错误主题闪烁，未进行逐帧闪烁测量。

三页客户端 SEO 随路由更新；项目页没有未经确认的可点击外链，首页/关于页的外链只有带安全属性的本站 GitHub。浏览器控制台 warn/error 为空。见 [交互、SEO 与控制台记录](../evidence/P3-browser-checks.json)。

视觉对照：保留已验收首页及原图的紫黑/暖白体系、网格渐变、低对比细边框、大圆角、图片比例、卡片间距和克制动效；新页面使用相同语言。关于页采用双栏介绍与技术方向、三块开发原则，手机自然堆叠。真实项目截图仍缺失，不能认定最终真实内容视觉已经完成；也不宣称逐像素一致。

## 6. 构建、检查与部署验证

| 检查              | 实际执行                                                                                                   | 结果                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 规范与类型        | `npm run check`                                                                                            | ESLint 零警告、Prettier、TypeScript 均通过                                                   |
| 生产构建          | `npm run build`                                                                                            | 最终版本通过；沙箱创建 Nitro 输出依赖目录遇 EPERM 后，以所需本机权限重跑成功                 |
| 静态生成          | `npm run generate`                                                                                         | 最终版本通过；默认无域名 9 个预渲染路由/产物                                                 |
| 独立安装与镜像    | `docker build --tag xiaowork-homepage:p3-reviewed .`；后续 `update.sh p3-verified`                         | 通过 npm ci / prepare / generate；最终非 root Nginx 镜像正常                                 |
| Compose 与 Bash   | `docker compose --env-file .env.example ... config --quiet`；四个脚本分别 `bash -n`                        | 通过                                                                                         |
| 无域名 HTTP / SEO | `npm run smoke -- http://127.0.0.1:3102`                                                                   | 5 种页面路径、20 个资源、health/404、重定向 origin、独立 SEO、robots 与 sitemap=404 全通过   |
| 配置 origin 分支  | 通过 build arg `http://127.0.0.1:3103` 构建 `p3-seo-check`；隔离 3103 容器运行相同 smoke 并传入预期 origin | 通过；canonical/分享图绝对地址、robots 声明、sitemap 三页链接均验证；静态生成 10 个路由/产物 |
| origin 校验       | Node 实际调用 normalizeSiteUrl，包含空值、HTTPS、loopback 与 7 类错误输入                                  | 通过；校验测试字符串没有写入站点配置或产物                                                   |
| 一键流程          | 同一隔离项目 deploy → update → rollback → 恢复新版 → 重复 deploy → 拒绝已有标签                            | 全部按预期，最后 health=healthy，当前镜像 p3-verified                                        |
| 容器边界          | docker inspect                                                                                             | 用户 nginx，ReadonlyRootfs=true，health=healthy，端口仅回环                                  |
| 原件完整性        | 三份 SHA256 核验                                                                                           | 与 P0/P1/P2 一致                                                                             |

证据：[默认 HTTP](../evidence/P3-http-smoke-domainless.txt)、[配置 origin HTTP](../evidence/P3-http-smoke-origin-configured.txt)、[origin 校验](../evidence/P3-seo-config-check.txt)、[一键流程日志](../evidence/P3-deployment-check.txt)。

开发中修复了共享 SEO 模块的构建导入路径问题，使用 Nuxt 的 `#shared` 别名后生产与静态构建成功。保留 Windows 中文路径下既有的 Nitro cache-driver external 警告，未修改 node_modules；Linux Docker 构建没有此警告。审计 JSON 仅做格式化，不更改审计数据。

一键脚本逻辑未重构；本次只增加 origin 的 Docker 构建参数和说明。静态站点改域名必须新标签重建，运行时环境变量不能改写旧镜像。回滚恢复对应镜像原有的域名设置。**没有进行启动失败注入、真实反代/TLS、生产 Linux 主机、真实手机、Safari/Firefox、完整读屏、系统减少动效仿真或性能评分**；这些不计入通过项。

本次验收结束已删除两个隔离测试容器和网络、核对并清理本次创建的临时部署记录/环境文件，保留镜像。未使用 down -v 或 prune，未改动其他服务。原有 `http://127.0.0.1:3100/projects` 开发预览已实际打开，保留给人工验收。

## 7. 安全审计与遗留风险

重新执行 `npm audit --json`，**退出码 1，仍为 7 个 high 依赖条目；安全审计未通过**。它们同源于 node-forge 的 `GHSA-86w9-cpqp-85rv`（RSA PKCS#1 v1.5 签名验证），路径为 Nuxt → Nitro → listhen → node-forge，并非 7 个独立漏洞。详见 [P3 审计报告](../evidence/P3-npm-audit.json)。

审计仍给出回退 Nuxt 4.1.3 的方案；没有执行 force、框架降级或未经兼容验证的传递依赖覆盖。本站不调用该 RSA 签名验证能力，最终静态 Nginx 镜像不包含 Node 依赖，但开发/构建依赖仍受此上游风险影响，需继续跟踪兼容修复。本阶段未做 OS 镜像 CVE 扫描，不将 npm 审计当作完整供应链审计。

## 8. Git 交付

P3 的代码、配置、文档、14 张真实截图和审计证据已一并提交并推送既有 `origin/main`：

- 实现提交：`422685c2d2eae2375a23392619fc17783d68de40`，`feat: complete P3 projects, about and SEO`。
- `git push origin main` 成功，从 P2 文档基线 `e26e67d` 正常前进至 `422685c`。
- 随后 `git ls-remote origin refs/heads/main` 返回相同完整 SHA；当时 `git status --short --branch` 为干净、与上游同步。
- 本节通过随后独立的文档提交补记真实核验结果，不自引用该文档提交自身的 SHA；最新文档提交以 Git 历史和最终回复为准。未强推或改写 P1/P2 历史。

提交前已审核暂存范围和凭据模式，未纳入真实环境文件、缓存、临时部署记录、依赖或构建产物。逐张复核截图，已重拍浏览器连续切换尺寸时出现旧画面的那张桌面图；最终交付使用正确的三列桌面深色截图。

## 9. P4 建议范围

1. 深入验收更新失败时自动恢复、构建失败不替换、错误环境配置与日志排障，保留当前唯一标签与健康等待机制。
2. 基于实际授权的拓扑设计反代、HTTPS、DNS 和网络；先做本机或隔离环境验证，生产连接仍需单独授权。
3. 验证旧镜像/源码/环境与部署记录备份和恢复，明确静态域名配置随镜像回滚的影响。
4. 跟踪并处理兼容的上游安全修复；必要时补镜像扫描。最终跨浏览器、真实设备、性能和人工视觉验收留给 P5。
5. 用户资料到齐后按 [内容配置指南](../CONTENT.md) 接入真实截图、入口、状态和个人信息，再独立验证提交；这不要求引入数据库或 CMS。

相关：[P0 规范](../../XiaoWork_Homepage_V1_Design_Spec.md)、[P1 交付](P1-delivery.md)、[P2 交付](P2-delivery.md)、[最新进度](../PROGRESS.md)、[README](../../README.md)、[部署指南](../DEPLOYMENT.md)。
