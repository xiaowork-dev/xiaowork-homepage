# XiaoWork Homepage V1.0 — P1 项目初始化交付

- 时间：2026-10-25 21:30（Asia/Shanghai，UTC+08:00）
- 阶段：P1；版本：`1.0.0-p1`
- 开发分支：`main`，本地仓库已初始化；提交身份与远程仓库尚未配置。
- 完成状态：**P1 工程搭建已完成**；安全审计存在已知上游告警，尚未进入生产发布验收。

## 1. 目标与验收范围

依据 P0 设计规范和已确认效果图，建立可安装、检查、构建、生成静态页面和本地运行的 Nuxt 4 工程。建立页面路由、基础组件、双主题、项目数据模型以及可执行的 Docker 部署基础；不执行生产连接或部署，不把 P2–P5 的最终视觉、完整内容和上线验收计入本阶段成果。

## 2. P0 阅读与决策

已完整阅读原始设计规范、P0 交付记录并查看 PNG。原始三份资料均未编辑，文件 SHA256 与初始化前一致。

- 效果图中的他人姓名、React/Next.js 标签、履历与项目仅作为布局参考，不能当作 XiaoWork 事实。采用 Nuxt/Vue 技术方案和明确的示例资料，保留深紫背景、暖白文字、大圆角、细边框和图片卡片的设计方向。
- 设计规范允许首次访问跟随系统，也要求保留默认深紫观感；P1 选择固定深紫默认并记忆手动切换，未加入系统主题模式。这属于规范允许范围内的明确实现选择。
- P0 的“未授权不初始化”门槛已由本次 P1 开发指令解除；没有收到生产部署授权，因此所有容器操作仅在本机隔离测试项目内进行。
- 沿用 P0 推荐的静态输出 + Nginx，不引入数据库、CMS、后台、认证、动画库或图标库。
- GitHub 地址、正式域名、个人资料与项目入口未提供，采用占位内容；不将资料缺失转化为伪造链接或经历。

## 3. 已完成内容

1. 检查 Windows PowerShell、Node/npm、Git、Docker CLI/Compose 与本机端口；确认目录无现有代码、无适用 `AGENTS.md`、无 Git 远端。
2. 在原资料所在 `xiaowork-homepage-v1/` 初始化 Nuxt 4 工程和 Git `main`；保留原始文件位置与字节内容。
3. 使用 Nuxt 4.6.2、Vue 3.5.44、TypeScript 6.0.3、Tailwind CSS 4.3.3；直接依赖精确锁定，并生成 `package-lock.json`。TypeScript 版本对齐本版 Nuxt 自身的开发基线。
4. 配置严格 TypeScript、Nuxt ESLint flat config、Prettier、EditorConfig、Node 版本、npm engines、VS Code 建议与 Git 忽略规则。
5. 建立 `/`、`/projects`、`/about`、共享布局、导航、页脚、主题按钮、技术标签和项目卡片组件。
6. 集中维护深浅色设计令牌，支持主题按钮、localStorage 持久化和头部同步恢复；存储不可用时保留当前会话切换能力。
7. 建立项目分类、状态、排序、精选、封面及可选外链的类型和配置；Blog、Nav、ERP 为有明确标记的示例资料，不暴露 ERP 后台或伪造访问入口。
8. 建立移动菜单、单/双/三列布局基础、跳转主内容、焦点样式、图片替代文本及减少动效支持。
9. 提供多阶段 Dockerfile、非 root Nginx、Compose、只读文件系统、健康检查、回环端口、部署/更新/回滚脚本及操作说明。
10. 新增可复用 HTTP 冒烟脚本，覆盖直达路由、重定向、静态资源、健康接口与未知路由 404。

## 4. 主要新增文件

| 文件/目录                                                                        | 用途                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `package.json`、`package-lock.json`、`.npmrc`、`.nvmrc`                          | 依赖、版本、开发与检查命令                                 |
| `nuxt.config.ts`、`tsconfig.json`、`eslint.config.mjs`                           | Nuxt、Tailwind Vite、预渲染、严格类型与 lint               |
| `.prettierrc.json`、`.prettierignore`、`.editorconfig`、`.vscode/`               | 格式规范、编辑器建议、原资料格式化排除                     |
| `.gitignore`、`.gitattributes`                                                   | 忽略环境文件与产物；Bash LF 行尾；P0 原件不做 Git 文本转换 |
| `app/app.vue`、`app/layouts/default.vue`                                         | 页面入口和共用布局                                         |
| `app/pages/`、`app/components/`                                                  | 三条基础路由及可复用 UI                                    |
| `app/assets/css/main.css`                                                        | 颜色、主题、圆角、布局及基础可访问性样式                   |
| `app/composables/useTheme.ts`、`public/theme-init.js`                            | 主题状态、持久化及首次绘制前恢复                           |
| `app/types/project.ts`、`app/data/projects.ts`                                   | 静态项目模型、示例、排序与精选                             |
| `public/images/projects/placeholder.svg`、`public/favicon.svg`                   | 自有代码生成的明确占位资源                                 |
| `public/health.json`、`scripts/smoke.mjs`                                        | 服务健康与 HTTP 集成冒烟检查                               |
| `Dockerfile`、`compose.yaml`、`.dockerignore`、`.env.example`                    | 静态构建与容器运行基础                                     |
| `deploy/nginx.conf`、`deploy/common.sh`、`deploy.sh`、`update.sh`、`rollback.sh` | Nginx、依赖检查、健康等待、版本记录与恢复                  |
| `README.md`、`docs/DEPLOYMENT.md`、`docs/PROGRESS.md`、本文件                    | 运行、升级、回滚和阶段交接                                 |
| `docs/evidence/P1-home-*.jpg`                                                    | 桌面深浅主题及手机布局验证截图；不是最终视觉验收图         |

## 5. 验证证据

| 检查             | 实际执行方式                                                                             | 结果与范围                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 安装与锁定       | `npm install --no-fund --fetch-retries=1 --fetch-timeout=30000`                          | 通过；Nuxt prepare 成功，安装 771 个包                                                      |
| 从 lockfile 安装 | Docker 中 `npm ci --ignore-scripts --no-audit --no-fund`，随后显式 `npm run postinstall` | 通过；Linux 容器可独立构建，不依赖 Windows 的 node_modules                                  |
| 代码规范         | `npm run check`                                                                          | 通过；ESLint 零警告、Prettier、TypeScript 均成功                                            |
| 常规生产构建     | `npm run build`                                                                          | 通过；初次沙箱写 `.output/server/node_modules` 遇到 EPERM，获准权限后重试成功               |
| 静态生成         | `npm run generate`                                                                       | 通过；三条业务路由与 payload、200/404 输出，共 8 个预渲染产物路由                           |
| Compose          | `docker compose --env-file .env.example config --quiet`                                  | 通过                                                                                        |
| Bash 语法        | Git Bash `-n deploy.sh update.sh rollback.sh deploy/common.sh`                           | 通过；Git Bash 需获准本机权限                                                               |
| 镜像构建         | `docker build --tag xiaowork-homepage:p1-verify .` 及更新过程构建                        | 通过；Node 24.22.1-alpine → Nginx 1.30.6-alpine                                             |
| 本地部署         | `COMPOSE_PROJECT_NAME=xiaowork-homepage-p1-check bash deploy.sh p1-verify`               | 通过；回环 3100 端口，容器 health=healthy                                                   |
| 本地更新         | 同测试项目 `bash update.sh p1-verify-update`，修复后 `bash update.sh p1-verify-final`    | 通过；新镜像构建并健康运行，旧镜像保留                                                      |
| 标签防误覆盖     | 再次 `bash update.sh p1-verify-update`                                                   | 按预期拒绝，退出码 1；未执行替换                                                            |
| 本地回滚与重跑   | `bash rollback.sh p1-verify`，再次 `bash deploy.sh p1-verify`                            | 通过；恢复旧镜像且健康，重复部署复用镜像                                                    |
| 运行隔离         | `docker inspect`                                                                         | 用户为 nginx，health=healthy，ReadonlyRootfs=true                                           |
| HTTP 集成冒烟    | `npm run smoke`，针对最终测试容器                                                        | 通过；`/`、项目/关于的有/无尾斜杠共 5 种路径，14 个资源，health.json 和未知路由 404         |
| 容器重定向       | 手动禁止跟随跳转检查 `/projects`、`/about`                                               | 通过；修复前跳到内部 8080，修复后分别返回相对 `/projects/`、`/about/`，不改变公网协议与端口 |
| 浏览器           | 本机 in-app browser，1440×1000 与 390×844 视口                                           | 通过基础检查；桌面三列、手机单列，scrollWidth=clientWidth；移动菜单跳转后收起               |
| 主题             | 默认深色 → 点击浅色 → 刷新 → 切回深色                                                    | 通过；浅色持久化；控制台未发现 warning/error                                                |
| 开发启动         | `npm run dev`                                                                            | 通过；仅绑定 `127.0.0.1:3100`，保留开发预览                                                 |
| 原始资料         | `Get-FileHash -Algorithm SHA256`，前后比对                                               | 三份原件完全一致，见下表                                                                    |
| npm 安全审计     | `npm audit --json`，核查官方公告与注册表                                                 | **未通过**；同一上游漏洞传播为 7 个 high 条目，见遗留项                                     |

容器检查完成后执行 `docker compose --env-file .env -p xiaowork-homepage-p1-check down` 清理本次测试容器和网络，未删除任何卷、既有容器或服务；测试 `.deploy/current`、`previous` 已清理。未连接服务器。

| 原始文件                                    | SHA256                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `XiaoWork_Homepage_V1_Design_Spec.md`       | `73E494A8E352F449AF07CC273BEA8CB526A5717D5C5A0E0ECFE51F49D43D5DC0` |
| `XiaoWork_Homepage_P0_Delivery.md`          | `12B9C75F6C75814F52B4433B4AB87B2D8771BF0E5EA20C1B74EB375789A62FBE` |
| `XiaoWork_Homepage_V1_Visual_Reference.png` | `1B9DF0476F26922CC4478DD7931622ADA913FC479D111E66AF09134B6C4CAD24` |

## 6. 部署与数据影响

- 默认回环 `127.0.0.1:3100 → 8080`，不占 80/443；`.env.example` 无秘密，真实 `.env` 不纳入 Git。
- 没有数据库或上传数据，无迁移。回滚依赖旧镜像、配置及版本状态；脚本不做 prune 或破坏性清理。
- 宿主仅需 Docker/Compose/Bash，构建依赖在 Node 构建阶段安装，最终镜像无 Node 包。
- 同机容器反代需要按真实环境配置共享网络，不能把 NPM 容器的 localhost 当成宿主；详见部署指南。
- 单副本更新可能短暂停机。更新失败后的自动恢复逻辑已实现，但尚未做故障注入演练；不同 Linux、实际反代/TLS、跨主机网络与恢复失败场景归 P4/P5 验收。
- 基础镜像固定到版本标签，未锁定 digest；不承诺位级可复现构建。

## 7. 遗留问题与边界

1. **Git 身份与 GitHub 未配置**：`git var GIT_AUTHOR_IDENT` 报身份缺失，`git remote -v` 为空。没有猜测邮箱、冒用身份或创建远程仓库，因此当前没有提交 SHA，也没有 GitHub 推送。身份和远端建立后，按要求自动提交经过验证的代码及交付文档并推送。
2. **上游安全告警**：`GHSA-86w9-cpqp-85rv` 影响 node-forge ≤1.4.0，2026-10-25 查询的最新版本为 1.4.0，公告 `first_patched_version=null`。依赖路径为 Nuxt → Nitro → listhen → node-forge；npm 将同一问题列为 7 个 high 级依赖条目。没有执行会退回旧 Nuxt 的强制自动修复。本项目未使用 RSA 验签功能，静态 Nginx 运行镜像不含该依赖，但开发/构建依赖的告警仍存在，后续需追踪并重跑检查。
3. **Windows 构建警告**：中文路径下 Nitro 对 URL 编码的 `cache-driver.mjs` 解析发出 external dependency 警告；构建和预渲染均成功，Linux Docker 构建未出现该警告。P1 不修改 node_modules 或为纯静态站引入专用补丁，后续升级 Nuxt/Nitro 时复查。
4. **真实内容未接入**：品牌标识、精确文案、项目真实技术栈/状态/截图/地址、GitHub、域名、联系与简历待确认；示例不代表真实项目情况。
5. **未做最终验收**：P1 的图片为占位 SVG，首页与参考图仅建立风格基线；没有承诺像素级还原、性能评分、完整 SEO 或生产就绪。

## 8. P2 计划与完成标准

1. 依据原图校准首页 Hero、背景渐变/网格、字体层级、胶囊、按钮、边框圆角和间距，保留 XiaoWork 内容边界。
2. 完成精选项目区域、卡片图文比例、hover/focus 与页脚视觉；资料未确认时继续明确占位。
3. 校准深浅双主题对比度和状态，完成桌面、平板、手机断点检查，确保无横向溢出并尊重减少动效。
4. 产出与参考图的截图对照和差异说明，重跑 check / build / generate / smoke，生成 P2 交付并更新进度；GitHub 建立后自动提交推送。

## 9. 关联资料

- [项目进度](../PROGRESS.md)
- [运行说明](../../README.md)
- [部署、升级与回滚](../DEPLOYMENT.md)
- [P0 设计规范](../../XiaoWork_Homepage_V1_Design_Spec.md)
- [P0 交付记录](../../XiaoWork_Homepage_P0_Delivery.md)
- [P1 桌面深色截图](../evidence/P1-home-desktop.jpg)、[浅色截图](../evidence/P1-home-light.jpg)、[手机截图](../evidence/P1-home-mobile.jpg)
