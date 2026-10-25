# XiaoWork Homepage V1.0 — P2 首页视觉与响应式交付

- 日期：2026-10-25（Asia/Shanghai）；版本：`1.0.0-p2`；分支：`main`。
- 状态：**P2 首页开发与本机工程验收完成，待用户视觉验收**。
- 范围：首页、共享展示组件与样式；保留 P1 工程、主题机制、数据类型和 Docker 静态部署方案。没有连接或部署生产服务器。

## 1. 需求、设计与工程基线

已阅读原始 P0 设计规范、P0 交付记录、确认的 PNG 和 P1 交付文档，并检查 Git、代码、运行端口及 Docker 容器。原始三份文件未修改，SHA256 与 P1 记录一致。

效果图中的他人姓名、履历、性能数字、React/Next.js 和真实项目截图不属于 XiaoWork 的资料。保留其渐变、网格、标题层级、圆角、低对比边框、信息栏和三列卡片构图，使用 XiaoWork 内容及用户指定的 Java / Spring Boot / Vue / Nuxt / MySQL / Docker 标签。按 P0 规范补充图中裁切范围外的导航与页脚；浅色和移动版依据同一视觉语言独立适配。

未重构 Nuxt、TypeScript、Tailwind、预渲染、主题恢复脚本、项目类型、Nginx 或一键脚本。没有新增依赖，lockfile 仅更新项目版本号。

## 2. 完成功能

1. Hero：深紫渐变、细网格、大圆角、细边框、暖白到粉紫标题、方向胶囊、两段介绍、探索项目、GitHub 与六项技术标签。
2. Hero 底部三块信息栏：全栈开发、项目与实践、持续创造；不填写未经确认的经历、地点或成绩。
3. 精选 Blog、Nav、ERP：16:10 封面、标题、介绍、状态、技术标签与入口区域，由原项目模型驱动。
4. 三张自有 SVG 占位封面均标注 `PLACEHOLDER` 和“真实项目截图待补充”。真实技术栈、状态和 URL 缺省时展示“待确认”，不伪造外链。
5. 本站 GitHub 源码入口使用用户创建并验证可推送的仓库；三个项目各自的演示和源码入口继续禁用。
6. 暖白、浅紫、柔和边框的浅色主题；沿用头部同步恢复与 localStorage 记忆。未增加动画或图标依赖。
7. 桌面三列、平板两列、手机单列；手机标题、胶囊、信息栏、导航和间距重新排布。
8. 卡片上浮 4px、封面缩放 1.02、按钮反馈、可见键盘焦点、移动菜单 Enter / Escape 与焦点恢复；减少动效时取消位移和缩放。
9. README 更新运行、数据、阶段及 Git 工作流；Compose 和 `.env.example` 默认标签同步至 `p2-local`，部署指南同步默认值。

## 3. 主要修改文件

| 文件                                                          | 内容                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `app/pages/index.vue`                                         | Hero、信息栏、精选布局与入口                             |
| `app/assets/css/main.css`                                     | 双主题令牌、主页组件样式、明确的响应式断点、动效和对比度 |
| `app/data/site.ts`                                            | 品牌文案、方向、技术标签与本站 GitHub 配置               |
| `app/data/projects.ts`                                        | 示例介绍与三张占位封面路径；保留原模型                   |
| `app/components/AppIcon.vue`                                  | 小型本地 SVG 图标集合                                    |
| `app/components/ProjectCard.vue`、`TechTag.vue`               | 卡片层级、状态、技术栈与禁用入口                         |
| `app/components/SiteHeader.vue`、`SiteFooter.vue`             | 导航、菜单、当前路由样式与页脚                           |
| `app/pages/projects.vue`                                      | 共享卡片使用 h2，保留项目页骨架                          |
| `public/images/projects/*-placeholder.svg`                    | Blog / Nav / ERP 明确占位封面                            |
| `package.json`、`package-lock.json`                           | 版本 `1.0.0-p2`；依赖不变                                |
| `compose.yaml`、`.env.example`、`docs/DEPLOYMENT.md`          | 默认镜像标签同步；部署逻辑不变                           |
| `README.md`、`docs/PROGRESS.md`、本文件、`docs/evidence/P2-*` | 运行说明、阶段交接、真实截图和审计证据                   |

## 4. 视觉对照与修正

对照原图及实际浏览器截图，校准紫黑底色、Hero 左亮右暗渐变、32px 网格、暖白/粉紫标题、胶囊、半透明信息栏、卡片间距、图片比例、边框与柔和阴影。

浏览器验收中修正了两个真实问题：断点样式顺序使桌面误用双列，改为显式媒体查询；320px 下 body 的最小宽度与滚动条共同造成横向滚动，移除最小宽度限制。另提高 Hero 信息栏小字与技术标签的文字对比度。

保留差异与局限：

- 文字、标题长度、项目介绍与信息栏内容采用 XiaoWork 资料，因此不逐字复制原图；手机标题允许自然换行。
- 原图没有完整导航/页脚，按 P0 信息架构补齐；最大内容宽度 1640px，桌面留有页面边距。
- 原图三张真实产品截图被明确占位 SVG 替代，不能认定真实内容还原完成。
- 原图只提供深色桌面效果；浅色、平板及手机为同风格适配，尚待用户人工视觉确认。
- 使用系统字体栈，没有原图精确字体文件；不宣称逐像素一致或自动图像相似度评分。

截图来自本机最终 Nginx 静态容器 `http://127.0.0.1:3102/`，镜像 `xiaowork-homepage:p2-reviewed`。桌面分别记录首屏和滚动后的完整项目区，保留原始浏览器截图，未拼图或替换页面内容。

| 视口                | 实际证据                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面 1440×1000 深色 | [首屏](../evidence/P2-home-desktop-dark.jpg)、[项目区](../evidence/P2-home-desktop-dark-projects.jpg)                                                     |
| 桌面 1440×1000 浅色 | [首屏](../evidence/P2-home-desktop-light.jpg)、[项目区](../evidence/P2-home-desktop-light-projects.jpg)                                                   |
| 平板 900×1200       | [深色](../evidence/P2-home-tablet-dark.jpg)、[浅色](../evidence/P2-home-tablet-light.jpg)                                                                 |
| 手机 390×844        | [深色首屏](../evidence/P2-home-mobile-dark.jpg)、[项目区](../evidence/P2-home-mobile-dark-projects.jpg)、[浅色首屏](../evidence/P2-home-mobile-light.jpg) |

## 5. 响应式、主题与交互验证

在本机 in-app browser 的同一最终静态页面检查以下视口，深浅主题分别执行；以 DOM 实测列数、元素边界、卡片矩形重叠和 `scrollWidth === clientWidth` 核验，均通过。[完整数据](../evidence/P2-responsive-results.json)

| 视口      | 列数 | 内容宽 / 滚动宽 | 两主题结果         |
| --------- | ---- | --------------- | ------------------ |
| 320×740   | 1    | 305 / 305       | 无横向溢出、无重叠 |
| 390×844   | 1    | 375 / 375       | 无横向溢出、无重叠 |
| 768×1024  | 2    | 753 / 753       | 无横向溢出、无重叠 |
| 900×1200  | 2    | 885 / 885       | 无横向溢出、无重叠 |
| 1199×900  | 2    | 1184 / 1184     | 无横向溢出、无重叠 |
| 1200×900  | 3    | 1185 / 1185     | 无横向溢出、无重叠 |
| 1440×1000 | 3    | 1425 / 1425     | 无横向溢出、无重叠 |

视口宽度包含浏览器滚动条，内容宽度扣除了滚动条；截图为浏览器实际导出的页面区域。

- 深色首次进入、切换浅色、刷新保留浅色、切回深色均通过。头部存在同步 `theme-init.js`；观察刷新没有明显错误页面主题闪烁，未进行逐帧闪烁测量。
- 手机菜单可用 Enter 打开，Escape 关闭并把焦点还给菜单按钮；点击项目后跳转并自动收起，返回首页正常。
- Tab 可访问 Hero 按钮与 GitHub，焦点为 2px 实线；Enter 激活探索项目成功。
- 实测悬停卡片变换 `translateY(-4px)`、图片缩放 `1.02`；无大型动画依赖。
- 已检查发布 CSS 的 `prefers-reduced-motion: reduce` 规则：取消位移/缩放并缩短过渡。**未切换操作系统偏好进行运行时仿真**，不把规则检查写成系统级实测。
- 三张封面加载正常；三个未确认入口均无可点击外链。两处本站 GitHub 外链均为确认仓库，带 `noopener noreferrer`。
- 浏览器控制台 warn/error 查询为空；未进行完整读屏、Safari/Firefox、真实移动设备或性能评分验收。

## 6. 构建、检查、安全及部署验证

| 检查            | 实际命令/方式                                                                                                                                 | 结果                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 代码检查        | `npm run check`                                                                                                                               | ESLint 零警告、Prettier、TypeScript 通过                                     |
| 生产构建        | `npm run build`                                                                                                                               | 通过                                                                         |
| 静态生成        | `npm run generate`                                                                                                                            | 通过；8 个预渲染路由/产物                                                    |
| Docker 独立构建 | `docker build --tag xiaowork-homepage:p2-reviewed .`                                                                                          | 通过；npm ci + prepare + generate；未新增依赖                                |
| Compose         | `docker compose --env-file .env.example -p xiaowork-homepage-p2-preview config --quiet`；指定验收标签与 3102 端口后 `up -d --no-build --wait` | 通过，healthy                                                                |
| 运行权限        | `docker inspect`                                                                                                                              | nginx 用户，ReadonlyRootfs=true                                              |
| HTTP 冒烟       | `npm run smoke -- http://127.0.0.1:3102`                                                                                                      | 通过；5 种页面路径、18 个本地资源、health 与未知路径 404，重定向保留访问端口 |
| 安全审计        | `npm audit --json`                                                                                                                            | **仍有 7 个 high 条目，退出码 1**；见下文                                    |
| 原始资料        | SHA256 前后比对                                                                                                                               | 三份原件与 P1 完全一致                                                       |

Windows 中文路径下 Nitro 的 `cache-driver.mjs` external dependency 警告仍存在，但 build/generate 成功；Linux Docker 构建未出现该警告。首次沙箱访问 npm / localhost / Docker 被网络或管道权限限制，获得所需本机执行权限后重试得到上述实际结果；没有将受限失败写为测试通过。

[本次 npm 审计原始结果](../evidence/P2-npm-audit.json) 与 P1 同源：Nuxt → Nitro → listhen → node-forge 的 `GHSA-86w9-cpqp-85rv`，并非 7 个独立漏洞。npm 提议回退 Nuxt 4.1.3；本阶段未强制修复、覆盖传递依赖或大规模降级。最终 Nginx 静态镜像没有 Node 运行依赖，但开发/构建依赖告警仍需追踪，**安全审计没有通过**。

Dockerfile、Nginx、一键部署/更新/回滚脚本保持 P1 已验证逻辑。Git Bash 分别对 `deploy.sh`、`update.sh`、`rollback.sh`、`deploy/common.sh` 执行 `bash -n`，四项语法检查通过。此次验证静态镜像构建、Compose 替换与健康、HTTP；没有重复声称已执行 P2 一键回滚或故障注入测试。P1 已有成功部署/更新/回滚证据，生产拓扑与失败恢复验收仍属 P4。

## 7. Git 提交与推送

本机静态验收结束后已清理 `xiaowork-homepage-p2-preview` 测试容器和网络，保留镜像与既有 3100 开发预览；没有删除卷或改动其他容器。

- 用户已创建 `xiaowork-dev/xiaowork-homepage` 并提供提交姓名/邮箱；只配置本仓库 Git 身份。
- P1 完整工程和交付记录已单独提交并推送 `origin/main`：`eead14e81078bfd87b37cff6f8e5e4ec7254dcf6`，已用 `git ls-remote` 核对。
- P2 实现提交的 SHA 与远端核验会在实现提交推送成功后，以独立文档提交补记于此，避免伪造尚未产生的 SHA。
- 后续经过验证的阶段继续正常提交推送，不强推或改写远端历史。

## 8. 遗留问题与 P3 建议

1. 接入真实项目截图、各项目技术栈、真实状态和确认的访问/源码地址；ERP 是否开放演示需明确，不暴露后台或敏感数据。
2. 确认最终品牌文案、Logo、个人介绍、联系信息及正式域名；目前文案为可维护的初稿。
3. P3 完成项目列表分类/筛选、关于我完整内容、站点描述与 Open Graph、sitemap 等 SEO；项目详情页按后续确认范围实施，目前没有创建详情路由。
4. 跟踪上游安全修复并在可兼容更新后复验，继续保留精确依赖锁定。
5. P4 补充更新失败恢复、反代/TLS、真实 Linux 部署等场景；P5 做跨浏览器、真实设备、性能与最终人工视觉验收。未经授权不连接生产。

相关资料：[P0 设计](../../XiaoWork_Homepage_V1_Design_Spec.md)、[原始效果图](../../XiaoWork_Homepage_V1_Visual_Reference.png)、[P1 交付](P1-delivery.md)、[最新进度](../PROGRESS.md)、[运行说明](../../README.md)、[部署与回滚](../DEPLOYMENT.md)。
