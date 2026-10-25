# XiaoWork Homepage V1.0

XiaoWork 个人品牌与开发者作品展示站。P2 首页已通过用户验收；P3 提供项目分类、配置化关于页与基础 SEO。真实项目素材与个人资料按用户安排后续提供，当前保留明确占位。

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
| `npm run smoke -- http://127.0.0.1:3100` | 服务启动后检查路由、资源、重定向、健康接口和 404  |
| `npm run lint:fix`                       | 自动修复可修复的代码问题                          |
| `npm run format`                         | 格式化工程文件；原始 P0 资料已排除                |
| `npm run build`                          | Nuxt 生产构建，用于检查框架构建能力               |
| `npm run generate`                       | 预渲染网站到 `.output/public`，正式容器采用此产物 |
| `npm run preview -- --port 3100`         | 生成或构建后启动本地预览                          |

## 当前可用功能

- `/`：紫色渐变与网格 Hero、品牌介绍、技术标签、GitHub 源码入口与精选项目卡片。
- 首页项目布局：手机单列、768–1199px 双列、1200px 起三列；暖白浅色与紫黑深色主题。
- `/projects`：所有项目、分类计数与筛选、空状态；沿用首页的单/双/三列卡片与双主题。
- `/about`：品牌与开发者介绍、技术方向、项目开发原则与已确认的 GitHub 本站源码入口；个人履历、其他联系方式和可选简历由配置补充。
- 响应式导航、深色/浅色切换、本地偏好持久化、键盘焦点和减少动效支持。
- `/health.json`：用于静态容器健康检查。
- 每页独立标题、描述、Open Graph / Twitter 元信息；`/robots.txt`。确认域名后生成 canonical、绝对分享图地址和 `/sitemap.xml`。

首次访问固定采用已确认的深紫设计；用户切换后通过 `xiaowork-theme` 保存。HTML 头部同步加载本地 `theme-init.js`，在页面绘制前恢复偏好。存储不可用时主题仍能在当前页面切换。

## 技术与目录

Nuxt 4 + Vue 3 + TypeScript + Tailwind CSS 4，采用静态数据与预渲染，不引入数据库或后台。直接依赖使用精确版本，完整依赖树由 `package-lock.json` 固定；TypeScript 采用 Nuxt 本版本自身使用的 6.0.3 基线。

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

新增项目时，在 `app/data/projects.ts` 添加符合 `Project` 类型的对象，并把封面放到 `public/images/projects/<slug>/`。按 `order` 排序，`featured` 控制首页展示，首页最多六项。分类计数与筛选自动更新，无需修改页面组件。`demoUrl` 和 `repositoryUrl` 缺省时不渲染外链；只有确认可用的 HTTPS 地址才可以填写。详见 [内容配置指南](docs/CONTENT.md)。

Blog、Nav、ERP 的项目名称与展示定位已接入；真实技术栈、具体状态、截图和地址尚未确认。用户明确这些站点仍在修复或开发，素材后续提供。封面沿用明确标注 PLACEHOLDER 的资源；状态采用 `unconfirmed`，显示“资料待确认”。技术栈为空时显示“技术栈待确认”，没有地址时显示不可交互的“入口待确认”。封面类型、项目状态、精选标记各自独立，不能由是否有截图推断是否上线。首页、页脚和关于页 GitHub 均指向已确认的本站代码仓库，并非其他项目源码或个人联系方式。Git 提交邮箱不会自动公开到关于页。

## 域名与 SEO

正式域名未确认，`NUXT_PUBLIC_SITE_URL` 默认留空：页面已有独立描述和分享标题，但不输出 canonical、`og:url` 或绝对分享图地址；robots 不声明 sitemap，`/sitemap.xml` 返回 404，避免发布虚构域名。

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
bash deploy.sh v1.0.0-p3
# 准备新版本源码后，使用新且唯一的版本标签
bash update.sh <新的唯一版本标签>
bash rollback.sh v1.0.0-p3
```

默认仅绑定 `127.0.0.1:3100`，首次执行自动从 `.env.example` 创建 `.env`。开发服务与容器不要同时使用同一端口。本阶段未连接生产服务器。

## 开发与交付约定

- [原始设计规范](XiaoWork_Homepage_V1_Design_Spec.md)、[P0 交付](XiaoWork_Homepage_P0_Delivery.md) 和原始 PNG 保留原样。
- [项目最新进度](docs/PROGRESS.md)、[P1 交付](docs/deliveries/P1-delivery.md)、[P2 交付及截图](docs/deliveries/P2-delivery.md) 与 [P3 交付](docs/deliveries/P3-delivery.md) 记录实际完成与验证范围。
- P2 首页已验收；P3 完成项目筛选、关于页与 SEO 工程，真实资料待补；P4 深入验收部署、更新与故障恢复；P5 最终验收。
- Git 使用 `main`，远端为 `xiaowork-dev/xiaowork-homepage`。提交身份已按用户提供的信息配置在本仓库，每个验证通过的阶段自动提交并推送，不强推。不要把 `.env`、密钥、依赖或构建产物提交到 Git。
- 正式域名、各项目地址、真实截图与联系方式待确认；接入时仅需修改内容配置和构建环境，无需新增后台。

## 已知依赖问题

2026-10-25 P3 重新执行 `npm audit --json`，仍报告 7 个 high 级依赖条目，根因相同：Nuxt → Nitro → listhen → node-forge 的 `GHSA-86w9-cpqp-85rv`。审计仍提议退回 Nuxt 4.1.3；未执行强制修复、降级或传递依赖覆盖。本项目未使用其 RSA 签名验证功能，最终静态 Nginx 镜像不包含 Node 依赖；构建/开发依赖告警仍需跟踪上游兼容修复。此项不代表安全审计通过，原始报告保存在 `docs/evidence/P3-npm-audit.json`。
