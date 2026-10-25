# XiaoWork Homepage V1.0

XiaoWork 个人品牌与开发者作品展示站。当前已完成 **P2 首页视觉与响应式布局**，待人工视觉验收；项目列表完整功能、关于内容与 SEO 属于 P3。

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
- `/projects`：全部示例项目；分类筛选在 P3 实现。
- `/about`：关于页骨架，未编造个人履历或联系方式。
- 响应式导航、深色/浅色切换、本地偏好持久化、键盘焦点和减少动效支持。
- `/health.json`：用于静态容器健康检查。

首次访问固定采用已确认的深紫设计；用户切换后通过 `xiaowork-theme` 保存。HTML 头部同步加载本地 `theme-init.js`，在页面绘制前恢复偏好。存储不可用时主题仍能在当前页面切换。

## 技术与目录

Nuxt 4 + Vue 3 + TypeScript + Tailwind CSS 4，采用静态数据与预渲染，不引入数据库或后台。直接依赖使用精确版本，完整依赖树由 `package-lock.json` 固定；TypeScript 采用 Nuxt 本版本自身使用的 6.0.3 基线。

```text
app/
  app.vue                 # Nuxt 页面入口
  assets/css/main.css     # 深浅色设计令牌与通用样式
  components/             # 导航、页脚、主题按钮、标签、项目卡片
  composables/useTheme.ts # 主题状态与持久化
  data/projects.ts        # 项目配置与展示排序
  data/site.ts            # Hero 文案、技术方向与已确认的本站 GitHub 地址
  layouts/default.vue     # 共用页面布局
  pages/                  # /、/projects、/about
  types/project.ts        # 项目类型与受约束的状态/分类
public/                   # 本地图片、favicon、主题初始化、健康检查
deploy/                   # Nginx 配置及脚本公共逻辑
docs/                     # 进度、阶段交付、部署说明
```

新增项目时，在 `app/data/projects.ts` 添加符合 `Project` 类型的对象，并把封面放到 `public/images/projects/`。按 `order` 排序，`featured` 控制首页展示，首页最多六项。`demoUrl` 和 `repositoryUrl` 缺省时不渲染外链；正式地址使用 HTTPS。

Blog、Nav、ERP 均为 **待确认的示例资料**；真实技术栈、状态、截图和地址尚未确认。封面明确标记 PLACEHOLDER / 真实项目截图待补充；配置内 `planning` 仅为样例枚举，界面显示“资料待确认”，不表示项目实际状态。缺少技术栈时显示“技术栈待确认”，没有访问地址时仅显示不可交互的“入口待确认”。确认后补齐字段并移除 `isPlaceholder`。首页与页脚 GitHub 指向已确认的本站代码仓库，并非三个项目的源码地址。

## Docker

容器通过 Node 多阶段构建生成静态文件，最终由非 root Nginx 提供服务；生产运行无需 Node。Linux 主机仅需 Docker Engine 与 Compose 插件，具体要求、升级和回滚见 [部署指南](docs/DEPLOYMENT.md)。

```bash
bash deploy.sh v1.0.0-p2
# 准备新版本源码后，使用新且唯一的版本标签
bash update.sh v1.0.0-p3
bash rollback.sh v1.0.0-p2
```

默认仅绑定 `127.0.0.1:3100`，首次执行自动从 `.env.example` 创建 `.env`。开发服务与容器不要同时使用同一端口。本阶段未连接生产服务器。

## 开发与交付约定

- [原始设计规范](XiaoWork_Homepage_V1_Design_Spec.md)、[P0 交付](XiaoWork_Homepage_P0_Delivery.md) 和原始 PNG 保留原样。
- [项目最新进度](docs/PROGRESS.md)、[P1 交付](docs/deliveries/P1-delivery.md) 与 [P2 交付及截图索引](docs/deliveries/P2-delivery.md) 记录实际完成与验证范围。
- P2 已完成首页视觉、双主题和响应式；P3 完善项目筛选、关于资料及 SEO；P4 完成部署场景验收；P5 最终验收。
- Git 使用 `main`，远端为 `xiaowork-dev/xiaowork-homepage`。提交身份已按用户提供的信息配置在本仓库，每个验证通过的阶段自动提交并推送，不强推。不要把 `.env`、密钥、依赖或构建产物提交到 Git。
- 正式域名、各项目地址、真实截图与联系方式待确认；完整 Open Graph、sitemap 等在 P3 接入。

## 已知依赖问题

2026-10-25 的 `npm audit` 报告 7 个 high 级依赖条目，根因相同：Nuxt → Nitro → listhen → node-forge 的 `GHSA-86w9-cpqp-85rv`。核查时 node-forge 最新版本为 1.4.0，公告没有修复版；未执行会降级 Nuxt 的 `npm audit fix --force`。本项目未使用其 RSA 签名验证功能，最终静态 Nginx 镜像不包含 Node 依赖；构建/开发依赖仍需跟踪上游修复。此项不代表安全审计通过。
