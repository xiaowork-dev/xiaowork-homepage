# XiaoWork Homepage

V1.1 在 `feat/v1.1-admin-p6a` 独立分支开发。中文 Vue 后台复用真实 Go/SQLite API。P6-E 已验证本地预览/发布/内容恢复、全新空卷一致性备份恢复、媒体容量和镜像硬化，并补充真实容器故障验收。完整生产门槛仍未通过，正式发布保持关闭，仅能显式开启独立 localhost HTTPS 测试。保留 V1.0 视觉与静态架构，未连接或修改生产。

- [P6-C 交付](docs/deliveries/P6C-delivery.md)、[当前进度](docs/PROGRESS.md)、[后台操作说明](docs/V1.1-ADMIN-USAGE.md)
- [P6-D 交付与验收边界](docs/deliveries/P6D-delivery.md)、[本地发布与恢复](docs/V1.1-PUBLISH-OPERATIONS.md)、[故障矩阵](docs/P6D-FAULT-TESTS.md)
- [架构](docs/architecture/V1.1-ARCHITECTURE.md)、[数据库](docs/architecture/V1.1-DATABASE.md)、[API 安全设计](docs/architecture/V1.1-API-SECURITY.md)、[发布设计](docs/architecture/V1.1-PUBLISHING.md)
- [实际 API 使用说明与 P6-C 接口](docs/V1.1-API-USAGE.md)、[迁移](docs/V1.1-DATA-MIGRATIONS.md)、[图片](docs/V1.1-MEDIA.md)、[安全验收](docs/P6B-SECURITY-TESTS.md)
- [P6-E 交付与剩余门槛](docs/deliveries/P6E-delivery.md)、[真实故障矩阵](docs/P6E-FAULT-TESTS.md)、[备份恢复](docs/V1.1-BACKUP-RESTORE.md)
- [V1.1 正式拓扑方案](docs/V1.1-PRODUCTION-PLAN.md)、[独立更新与代码回退](docs/V1.1-RELEASE-OPERATIONS.md)、[安全验收清单](docs/V1.1-SECURITY-ACCEPTANCE.md)、[生产发布清单](docs/V1.1-PRODUCTION-CHECKLIST.md)

## V1.1 隔离开发环境

```bash
docker compose -f compose.admin-dev.yaml up -d --build --wait --wait-timeout 120
docker compose -f compose.admin-dev.yaml exec -it api /homepage-api init-admin
docker compose -f compose.admin-dev.yaml exec -T api /homepage-api import-v1
```

初始化命令通过真实 TTY 隐藏读取自选密码，不接受密码参数、环境变量、管道或默认密码。HTTP 前台入口 `http://127.0.0.1:3210`，后台入口为可信本地 HTTPS `https://localhost:3443/admin/`，API 为同源 `/api/admin/v1`。先信任本项目公开开发 CA，再通过浏览器登录；HTTP 不能创建会话。认证、CSRF 和登录限速真实运行，写入携带表单原始 `If-Match` 版本；409 会保留输入并要求明确核对。公开站 origin 固定为 `https://xiaoworks.com`，不会由表单修改。

只有 gateway 绑定本机回环端口。API、SQLite、上传、session secret 和本地 TLS 使用独立隔离网络/持久卷，不复用生产数据。启动前检查端口和 control 网段冲突；先导出公开开发 CA，客户端显式信任后执行 HTTPS 验收，不能关闭证书校验。完整步骤、模块网络问题和保留卷重建见 [开发说明](docs/V1.1-DEVELOPMENT.md)。停止使用 `docker compose -f compose.admin-dev.yaml down`，不要添加 `-v`。不要使用 V1.0 的发布脚本部署本分支。

独立后台源码在 `admin/`，不引入大型 UI 框架。使用 `npm --prefix admin ci` 安装；`npm run admin:check`、`npm run admin:test`、`npm run admin:build` 执行规范、类型、测试与构建，`npm --prefix admin run format:check` 检查格式。真实 HTTPS 浏览器测试使用 `npm run admin:e2e`，需先准备专用测试镜像，详见 [开发说明](docs/V1.1-DEVELOPMENT.md)。所有验收账号和数据仅存在独立本地测试卷，不能用于生产。

## V1.1 运维与验收边界

V1.1 使用六个受审镜像、schema3 和独立 `.v11-deploy/` 状态；新脚本为 `scripts/v11-deploy.sh`、`v11-update.sh`、`v11-rollback.sh`，不会使用 V1.0 的 `.env/.deploy`。运行前需要已验收完整 Git SHA、六个实际镜像 ID、空闲回环端口/私网及备份位置。命令和参数见上方运维说明。正式 OpenResty 拓扑只提供回环网关，不公开 API/Worker；生产发布开关仍被服务端禁止。

备份通过停止本站写入者、SQLite `VACUUM INTO`、schema/引用/逐文件哈希校验形成独立 bundle。实际在全新卷中恢复后重新登录，草稿、图片、历史、公开三页和 SEO 保留；旧 Session 失效。备份含密码哈希和会话材料，禁止进入 Git 或公开目录，应另行加密离线保管。内容恢复、代码镜像回退与数据库灾难恢复是不同操作。

上传限制为原图10 MiB、multipart11 MiB、8192单边/2500万像素、重编码派生图16 MiB；单快照媒体总量256 MiB。发布页显示图片/数据库/发布目录容量；余量少于512 MiB或2%、无法核实余量时拒绝新任务，少于1 GiB或10%警告。没有自动物理GC或总磁盘配额，历史成功资源继续保留。

本轮十二项真实故障安全行为通过，恢复成功保留旧诊断的问题另有源码修复、真实Nuxt故障复跑及单API候选审计。生命周期实测为**同源码、同schema的镜像替换和代码镜像回退**；不同功能源码版本升级、跨schema迁移及后继完整六角色镜像验收未完成。崩溃留下额外 `current.next.*` 链接时，维护备份保守拒绝，仍需人工核对修复。完整证据与限制以P6-E交付为准，当前不能正式上线。

## V1.0 当前状态

XiaoWork 个人品牌与开发者作品展示站。P2～P4 已通过用户阶段验收，P5-A 基本通过工程验收；P5-B 已完成本机部署预检。当前生产方案已按用户要求改为已有 **1Panel + OpenResty**，目标 SSH 别名为 `xiaowork-main`，正式主站为 `https://xiaoworks.com`，不配置 www。用户允许首版保留明确占位内容；上游 7 high 风险尚未获接受，当前只放行内部部署和预览，公网路由与 DNS 尚未放行。方案说明见 [OpenResty 调整记录](docs/deliveries/P5-openresty-plan.md)，内部部署已完成，服务器容器 healthy，正式 origin 的 HTTP/SEO、30 组响应式与隧道浏览器验收通过；公网仍未发布。详见 [实际生产交付](docs/deliveries/P5-production-delivery.md) 和 [最新进度](docs/PROGRESS.md)。

## 本地运行

要求 Node.js **24.x（至少 24.15.0）**、npm **11.x**；本阶段使用 Node 24.22.1 / npm 11.19.1。

```bash
cd xiaowork-homepage-v1
npm ci
npm run dev
```

打开 `http://127.0.0.1:3100`。如果终端已经位于项目根目录，省略 `cd`。端口冲突时可执行 `npm run dev -- --port 3101`。

| 命令                                     | 用途                                              |
| ---------------------------------------- | ------------------------------------------------- |
| `npm run dev`                            | 本地开发与热更新，默认仅绑定回环地址              |
| `npm run check`                          | ESLint（零警告）、Prettier、TypeScript 检查       |
| `npm test`                               | 搜索/分类组合、排序、查询边界与 SEO origin 测试   |
| `npm run smoke -- http://127.0.0.1:3100` | 服务启动后检查路由、资源、重定向、健康接口和 404  |
| `npm run lint:fix`                       | 自动修复可修复的代码问题                          |
| `npm run format`                         | 格式化工程文件；原始 P0 资料已排除                |
| `npm run build`                          | Nuxt 生产构建，用于检查框架构建能力               |
| `npm run generate`                       | 预渲染网站到 `.output/public`，正式容器采用此产物 |
| `npm run preview -- --port 3100`         | 生成或构建后启动本地预览                          |

## 当前可用功能

- `/`：紫色渐变与网格 Hero、品牌介绍、技术标签、GitHub 源码入口与精选项目卡片。
- 首页项目布局：手机单列、768–1199px 双列、1200px 起三列；暖白浅色与紫黑深色主题。
- `/projects`：所有项目、分类计数、关键词搜索、推荐/精选/名称排序、空状态与重置；筛选条件保存到 URL，支持刷新、分享和浏览器返回。搜索按 Enter 或按钮提交。
- `/about`：品牌与开发者介绍、技术方向、项目开发原则与已确认的 GitHub 本站源码入口；个人履历、其他联系方式和可选简历由配置补充。
- 响应式导航、深色/浅色切换、本地偏好持久化、键盘焦点和减少动效支持。
- `/health.json`：用于静态容器健康检查。
- 每页独立标题、描述、Open Graph / Twitter 元信息；`/robots.txt`。确认域名后生成 canonical、绝对分享图地址和 `/sitemap.xml`。

首次访问固定采用已确认的深紫设计；用户切换后通过 `xiaowork-theme` 保存。HTML 头部同步加载本地 `theme-init.js`，在页面绘制前恢复偏好。存储不可用时主题仍能在当前页面切换。

## 技术与目录

V1.0 使用 Nuxt 4 + Vue 3 + TypeScript + Tailwind CSS 4。V1.1 草稿仍与访客隔离；显式启用的本地发布通过不可变快照重新生成全站 HTML、客户端数据、SEO 和版本资源，无快照构建继续读取原 TS 配置。直接依赖使用精确版本，完整依赖树由 `package-lock.json` 固定；TypeScript 采用 Nuxt 本版本自身使用的 6.0.3 基线。

```text
app/
  app.vue                 # Nuxt 页面入口
  assets/css/main.css     # 深浅色设计令牌与通用样式
  components/             # 导航、页脚、主题按钮、标签、项目卡片
  composables/            # 主题状态、持久化与每页 SEO
  data/projects.ts        # 项目配置与展示排序
  data/project-covers.ts  # 各项目独立封面注册表
  data/site.ts            # Hero 文案、技术方向与已确认的本站 GitHub 地址
  data/about.ts           # 关于介绍、技术方向、开发原则、公开联系与可选简历
  layouts/default.vue     # 共用页面布局
  pages/                  # /、/projects、/about
  types/project.ts        # 项目类型与受约束的状态/分类
shared/seo.ts             # 页面元信息与正式域名校验
server/routes/            # robots / sitemap，生成时输出为静态文件
public/                   # 独立项目封面、品牌分享图、主题初始化、健康检查
deploy/                   # Nginx 配置及脚本公共逻辑
docs/                     # 进度、阶段交付、部署说明
```

新增项目时，在 `app/data/projects.ts` 添加符合 `Project` 类型的对象，并把封面放到 `public/images/projects/<slug>/`。按 `order` 排序，`featured` 控制首页展示，首页最多六项。分类计数与筛选自动更新，无需修改页面组件。封面支持可选 AVIF/WebP 变体、固定比例、懒加载与两层失败后备。`demoUrl` 和 `repositoryUrl` 缺省时不渲染外链；只有确认可用的 HTTPS 地址才可以填写。详见 [内容配置指南](docs/CONTENT.md) 与 [封面替换步骤](public/images/projects/README.md)。

Blog、Nav、ERP 的项目名称与展示定位已接入；真实技术栈、具体状态、截图和地址尚未确认。用户明确这些站点仍在修复或开发，素材后续提供。封面沿用明确标注 PLACEHOLDER 的资源；状态采用 `unconfirmed`，显示“资料待确认”。技术栈为空时显示“技术栈待确认”，没有地址时显示不可交互的“入口待确认”。封面类型、项目状态、精选标记各自独立，不能由是否有截图推断是否上线。首页、页脚和关于页 GitHub 均指向已确认的本站代码仓库，并非其他项目源码或个人联系方式。Git 提交邮箱不会自动公开到关于页。

## 域名与 SEO

正式主站已确认为 `https://xiaoworks.com`，不使用 www。生产部署 `.env` 必须填写 `NUXT_PUBLIC_SITE_URL=https://xiaoworks.com`，并重新构建镜像。仓库 `.env.example` 继续保留空值作为安全的本地默认值；空值模式不输出 canonical、`og:url` 或绝对分享图地址，robots 不声明 sitemap，`/sitemap.xml` 返回 404。

确认域名后，在本地 `.env` 或构建环境填写 `NUXT_PUBLIC_SITE_URL`（HTTPS 的完整 origin，无路径、查询、账号或密码）。然后重新执行 `npm run generate`，或用新版本标签构建 Docker 镜像。Docker Compose 会把它作为 build arg 传入；静态 Nginx 容器启动时修改环境变量不会改写已生成网页。同机调试允许 HTTP 的 localhost / 127.0.0.1 / [::1] origin。

`shared/seo.ts` 集中维护三个页面的标题、描述与路径；分享图为本地自有品牌图 `public/images/social/xiaowork-share.png`（1200×630），不作为项目截图。配置域名后，sitemap 包含三个页面，robots 自动声明其位置。

```bash
# 无域名模式的 HTTP + SEO 验证
npm run smoke -- http://127.0.0.1:3100
# 配置域名的产物：第三个参数传入该产物的实际构建 origin
npm run smoke -- <本地服务地址> <构建时配置的正式origin>
```

## Docker

容器通过 Node 多阶段构建生成静态文件，最终由非 root Nginx 提供服务；生产运行无需 Node。Linux 主机仅需 Docker Engine 与 Compose 插件，具体要求、升级和回滚见 [部署指南](docs/DEPLOYMENT.md)。

```bash
bash deploy.sh v1.0.0-p5a
# 准备新版本源码后，使用新且唯一的版本标签
bash update.sh <新的唯一版本标签>
bash rollback.sh v1.0.0-p5a
```

当前生产采用 `compose.yaml`，显式配置 `BIND_ADDRESS=127.0.0.1`、`HTTP_PORT=3100`，映射到容器 `8080`。首次执行自动从 `.env.example` 创建 `.env`；执行前必须填写正式 origin。开发服务与容器不要同时使用同一端口。

已有 OpenResty 使用 host 网络，可通过 `http://127.0.0.1:3100` 访问 Homepage。应用使用 Compose 的独立默认网络，不加入 NPM 共享网络，不将 3100 绑定到公网。`compose.proxy.yaml` 保留历史兼容能力，不作为当前生产方案；已有代理模式实例若要迁移，必须先备份并制定显式迁移计划，不能删除 `.deploy/compose-file` 绕过保护。

`bash release.sh <deploy|update> <已验收完整40位SHA>` 从确认的 GitHub main 获取精确提交，校验干净工作区、来源与快进关系，再调用现有部署脚本。不会判断任意 main 提交是否已验收，也不自动部署最新 main。标签和镜像记录源码/构建域名，复用镜像时拒绝不匹配配置。操作步骤与生产信息需求见 [P5 部署方案](docs/P5-DEPLOYMENT-PLAN.md)。

## 开发与交付约定

- [原始设计规范](XiaoWork_Homepage_V1_Design_Spec.md)、[P0 交付](XiaoWork_Homepage_P0_Delivery.md) 和原始 PNG 保留原样。
- [项目最新进度](docs/PROGRESS.md)、[P1 交付](docs/deliveries/P1-delivery.md)、[P2 交付及截图](docs/deliveries/P2-delivery.md) 与 [P3 交付](docs/deliveries/P3-delivery.md) 记录实际完成与验证范围。
- P2～P4 已验收；[P4 交付](docs/deliveries/P4-delivery.md)、[P5-A 交付](docs/deliveries/P5A-delivery.md) 和 [P5-B 部署预检](docs/deliveries/P5B-preflight.md) 保留各阶段的历史范围，不代表本次生产验收。[上线资料](docs/P5-CONTENT-CHECKLIST.md)、[部署方案](docs/P5-DEPLOYMENT-PLAN.md) 和 [发布门槛](docs/P5-RELEASE-CHECKLIST.md) 已同步当前 OpenResty 方案。
- 公网发布仍须解决或明确接受上游 high 风险，并完成本站 OpenResty/TLS、Cloudflare、源站 IP+Host/SNI 防绕过与其他站点回归检查；内部部署成功不等于公网已放行。
- V1.0 发布使用 `main`，V1.1 先使用独立功能分支，测试后再按正常合并流程进入 main；远端为 `xiaowork-dev/xiaowork-homepage`。每个验证通过的阶段自动提交并推送，不强推。不要把 `.env`、密钥、数据库、上传、备份、依赖或构建产物提交到 Git。
- 正式域名已确认；各项目地址、真实截图与更多联系方式仍待补，用户允许首版明确占位。V1.0 仍通过配置及重新构建更新内容；V1.1 后台与发布机制按 P6-B～P6-E 分步实现。

## 已知依赖问题

历史生产基线：2026-10-26 的 P5 审计报告 7 个 high 依赖条目，根因是 Nuxt → Nitro → listhen → node-forge 1.4.0 的 `GHSA-86w9-cpqp-85rv`；当时未发现兼容修复，未强制升级或降级 Nuxt。证据保留于 `docs/evidence/P5-production-npm-audit.json`、`P5-production-advisory.json` 和 `P5-production-registry.json`。生产旧镜像没有在 P6-D 更新，本轮没有连接服务器重查；用户尚未接受的生产安全风险与公网发布门槛仍有效。

当前 V1.1 本地分支：保留 P6-D 的 node-forge 1.4.1 兼容修复，官方 npm gitHead、版本 tag 和 lock integrity 已重新核对。2026-10-28 P6-E 根审计为 **7 low / 0 high / 0 critical**，来自 deepmerge 4.3.1 构建链；admin 为0。未采用强制不兼容升级。node-forge 旧公告仍未登记 first_patched_version，影响范围为 <=1.4.0，不能将当前审计结果等同完整安全认证。[npm审计](docs/evidence/P6E-npm-audit.json)、[来源](docs/evidence/P6E-node-forge-source.json)。

Go 源码扫描为 symbol0/imported0/module1：未导入的 openpgp 存在 `GO-2026-5932` 模块级告警，尚无修复版本。去符号二进制扫描精度不足，保留其保守告警，不伪装为零风险。冻结be5c六角色基线及后继单API候选扫描均无high/critical/medium；Worker仍有deepmerge low，musl的工具告警与Alpine官方修复状态存在差异，API/维护镜像有openpgp未定级模块告警。[完整安全结论](docs/V1.1-SECURITY-ACCEPTANCE.md)。固定依赖、离线Worker和权限限制缩小攻击面，不能替代正式环境安全验收。

## 性能复测

使用独立静态容器，在本机 Chrome 上运行 `npm exec --yes --package=lighthouse@13.5.0 -- lighthouse <本地URL> --chrome-flags="--headless=new --disable-extensions" --output=json --output-path=<报告路径>`。默认手机、模拟网络/CPU；桌面增加 `--preset=desktop`。每组建议三次，避免与构建同时运行。不要对开发热更新服务评分。P4 原始报告与中位数比较在 `docs/evidence/P4-*`，可运行 `node scripts/performance-summary.mjs` 重新汇总现存报告和生成资源体积。

Lighthouse 的 TBT 不能替代真实用户 INP。域名和真实访问数据尚缺时，INP/CrUX 为上线后待测。系统字体没有远程字体请求；主题恢复脚本保留同步加载以避免错误主题闪烁。静态容器提供 gzip、哈希资源一年缓存、图片一天缓存和页面重新验证，部署与缓存失效规则见部署指南。

P6-E 对实际发布静态页使用 Lighthouse13.6.0复测：首页手机三次performance92/98/95，中位95，LCP中位1.12秒、CLS0、TBT中位195毫秒；项目页91、关于页93，首页桌面100。六次accessibility/best-practices/SEO均100。数据来自本机模拟限速和合成验收内容，没有可比的P6-D基线，也未测真实用户INP。[原始报告与限制](docs/evidence/P6E-performance-summary.json)。
