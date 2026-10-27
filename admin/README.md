# XiaoWork V1.1 管理界面（P6-C）

独立 Vue 3 + TypeScript + Vite 应用，构建基路径为 `/admin/`。管理路由、会话和 API 客户端不加入访客 Nuxt bundle。

当前接入真实 Go API：登录与改密、工作区概览、项目与分类管理、完整排序、图片上传与私有预览、品牌资料、网站与 SEO 草稿。预览、发布及历史恢复仍为 P6-D 禁用功能；本地编辑不会改变 V1.0 静态前台或生产服务。

## 本地构建与检查

要求 Node.js 24、npm 11；精确版本约束以 `package.json` 和锁文件为准。在 `admin/` 目录执行：

```bash
npm ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

产物为 `admin/dist/`，不包含源码映射。仓库根目录也提供 `npm run admin:check`、`npm run admin:test`、`npm run admin:build`。这些命令是操作方法，具体运行结果以阶段交付记录为准。

## 实际管理入口

从仓库根目录启动隔离 Compose，按[本地环境说明](../docs/V1.1-DEVELOPMENT.md)完成专用公开 CA 信任、TTY 管理员初始化及一次性内容导入：

```bash
docker compose -f compose.admin-dev.yaml config --quiet
docker compose -f compose.admin-dev.yaml up -d --build --wait --wait-timeout 120
docker compose -f compose.admin-dev.yaml exec -it api /homepage-api init-admin
docker compose -f compose.admin-dev.yaml exec -T api /homepage-api import-v1
```

使用已正确验证证书的浏览器访问 `https://localhost:3443/admin/`。已有管理员时不要重新初始化；不存在默认密码。只能信任本项目的公开 CA 证书，不导出或提交 CA 私钥，不关闭 TLS 验证。测试端口或认证 origin 如有调整，以对应 Compose 配置为准。

`npm run dev` 仅启动 `127.0.0.1:3211` 的 Vite 界面开发服务，没有配置认证 API 代理。它不能代替同源可信 HTTPS 网关进行真实登录验收。隔离 E2E 环境也可能占用 3211，启动前检查端口，勿停止其他任务的容器。

管理网关只映射宿主回环端口，API 没有宿主端口；不要将本地 Compose 直接用于生产。更改界面后重新构建本项目 gateway，保留数据库、素材和秘密卷；不要使用 `down -v` 或全局清理。

## 使用与维护

- [中文管理操作说明](../docs/V1.1-ADMIN-USAGE.md)：项目、素材替换、版本冲突和未保存保护。
- [真实 API 契约](../docs/V1.1-API-USAGE.md)：revision、幂等、认证和图片限制。
- [独立开发环境](../docs/V1.1-DEVELOPMENT.md)：HTTPS、账户、数据卷及初始化。
- [架构与边界](../docs/architecture/V1.1-ARCHITECTURE.md)：草稿、公开前台和后续 worker 隔离。

仅主题偏好保存在浏览器本地存储。会话 Cookie 为 Secure/HttpOnly，CSRF 只在内存；不要把密码、Cookie、测试会话文件、数据库、上传卷或密钥放入提交、截图与交付日志。
