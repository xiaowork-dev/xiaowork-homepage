# P6-B：后台 API、管理员认证与数据持久化交付

日期：2026-10-26（Asia/Shanghai）。状态：**本阶段 API、认证、草稿持久化与隔离 Docker 验证已完成；管理 UI、静态发布、预览和内容恢复尚未实现。**

## 1. 范围、基线与兼容性

本轮沿用 P6-A 已验收架构及 `feat/v1.1-admin-p6a` 分支，开发基线为 `e6205c074191a2a1ea021234cf7ae26cc70fbd7a`。已复核架构、数据库、API 安全、发布机制、开发环境说明及既有 Go/SQLite/Compose 骨架，没有重新设计前台或切换 SSR。

V1.0 的 `app/public/shared/server`、Nuxt 配置、正式 Dockerfile/Compose 和 `release.sh/deploy.sh/update.sh/rollback.sh` 与基线一致，已用 Git diff 核对。本轮没有连接生产服务器、合并 main、操作 OpenResty/Cloudflare 或修改公开网站。main 基线为 `14f9b1fba6504b1367aad6165a0b72c37e495927`；服务器历史版本仅引用既有交付，不冒充本轮重新核验。

## 2. 真实实现的能力

| 模块       | 已实现行为                                                                                                                                               | 对接说明                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 管理员     | TTY 隐藏输入初始化/离线重置；无默认密码、注册、密码参数或环境变量入口；Argon2id                                                                          | [开发环境](../V1.1-DEVELOPMENT.md)          |
| 认证       | login challenge、登录、Session 查询、退出、再认证、修改密码；SQLite 服务端会话；改密撤销全部旧会话                                                       | [API 认证](../V1.1-API-USAGE.md#3-认证流程) |
| 防护       | Secure/HttpOnly/Strict/Path=/ 的 Host Cookie；精确 HTTPS Origin、CSRF、单次 nonce、登录限速、KDF 容量限制、idle/absolute 到期；敏感响应 no-store/noindex | [安全测试](../P6B-SECURITY-TESTS.md)        |
| 草稿工作区 | workspace/dashboard、全局 revision、强 If-Match、完整变更历史及审计同事务；并发冲突 409、缺版本 428；创建项目幂等键                                      | [API 契约](../V1.1-API-USAGE.md#2-通用契约) |
| 项目与分类 | 项目新增/列表/单项/编辑/归档/恢复/排序；分类 CRUD/排序及引用保护；名称、介绍、技术栈、状态、链接、封面、精选和隐藏配置                                   | [内容接口](../V1.1-API-USAGE.md)            |
| 品牌与设置 | 完整个人资料、技术方向/标签、社交/联系/简历、站点展示、页脚和默认/逐页 SEO 草稿；普通表单不能改域名或部署配置                                            | [内容接口](../V1.1-API-USAGE.md)            |
| 图片       | PNG/JPEG/WebP 内容校验、限长限尺寸、解码重编码、元数据剔除、私有持久化、受保护读取、确认记录、三类引用保护及软删除                                       | [媒体说明](../V1.1-MEDIA.md)                |
| 迁移       | schema 1→2 追加升级、全部历史 checksum 核验；V1.0 白名单导出/显式导入，provenance 登记，重复不覆盖编辑                                                   | [迁移说明](../V1.1-DATA-MIGRATIONS.md)      |

Argon2id 使用 64 MiB、3 次迭代、并行度 1、随机 16 字节 salt 和 32 字节输出，固定成本校验；密码不写日志。Session 仅持久化 token/CSRF 哈希，空闲期限 30 分钟、绝对期限 12 小时；仅轮询会话不会延长空闲时间。事务实际写入前重新确认会话，避免鉴权后改密或退出的竞态。

普通 JSON 限制 256 KiB、认证 8 KiB，拒绝未知/大小写别名/重复键/尾随 JSON/非法 query 与越界字段；参数化 SQL 和单事务维护内容、引用、revision、历史、审计。URL 校验拒绝危险协议、私网与数字 IP 别名等输入，不自动访问远端网站，也不将格式通过等同于真实上线验证。

所有后台修改只进入私有草稿。`/publish-jobs`、`/preview-jobs`、`/rollback-jobs`、相关 jobs/releases/previews 路径经鉴权后返回 `503 WORKER_UNAVAILABLE`，不生成假成功任务。dashboard 的公开项目数为 null、`activeVerified=false`，不从草稿数量伪造发布统计。

## 3. 数据导入与持久化

- `001_initial.sql` 保持原字节，SHA-256 为 `b8d130f9b634ce14415cda2ecb20e7111ac145af29ac9a359bd538d3d3f5db2f`；仅追加 `002_content_history.sql`。全部已应用迁移连续性/checksum 校验，拒绝未知版本、缺口和漂移，不自动降级或删除重建。
- 外键、WAL、synchronous FULL、busy timeout 生效，多表写入使用事务；schema-1 测试及本地旧卷升级后数据保留。原 API 停止后先保存忽略目录中的一致备份，没有清空卷。
- 种子来源为开发基线完整 SHA，核对 12 份 Git 原文/资源；manifest SHA-256 为 `16b09f83320a4e19eb768dc05c773aa49480a019d982e70b79f155e0367dc45a`，payload SHA-256 为 `841fbca75e7cc57ee5ea7a087c24da16e608f51ca49940859e563a92914487ca`。
- 导入 Blog/Nav/ERP 的原 ID、顺序 1/2/3、精选、三分类、占位封面及品牌资料；空链接、空技术栈和 `unconfirmed` 保留，不新增虚构履历。已有导入记录重复返回原 provenance，不覆盖编辑；非空工作区首次导入拒绝并完整回滚。
- Docker 保留命名卷重建 API/gateway 后，原 Session、revision、编辑草稿和图片 SHA 实测保持，重复导入 `AlreadyImported=true`。这验证容器更新持久化，不等同于完整灾难恢复。

## 4. 本地隔离环境与主要修改文件

沿用 Compose 项目 `xiaowork-homepage-v11-dev`、独立 DB/uploads 卷；新增 session secrets、本地 CA、TLS leaf 独立卷。API 无宿主端口，仅 gateway 回环 `127.0.0.1:3210/3443`；可信管理 Origin 为 `https://localhost:3443`。私有 control 网络 `192.168.247.0/28` 内，gateway `.2`、API `.3`、init `.4`，API 仅信任 `.2/32` 代理。

API/gateway 使用 UID 10001、只读根、drop ALL、no-new-privileges、临时目录及日志轮转；CA 私钥仅 init 可见，常驻 API 仅挂只读 Session secret，gateway 仅挂只读 leaf。未挂载 Docker socket、SSH、GitHub 凭据或生产路径。HTTP 管理请求为 426，`/admin/` 为明确的 503 阶段说明。

| 文件/目录                                                               | 主要变化                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `backend/cmd/homepage-api/main.go`                                      | 安全 CLI、显式初始化/导入/本地 TLS；服务配置           |
| `backend/internal/authn/`、`httpapi/auth*.go`                           | 密码、秘密、认证、Session、CSRF、限速及测试            |
| `backend/internal/contentdata/`、`httpapi/content*.go`                  | 类型化内容、校验、事务 CRUD/历史/导入及 HTTP 测试      |
| `backend/internal/mediautils/`、`httpapi/media*.go`                     | 图片净化、私有存储、引用管理及 HTTP/文件攻击测试       |
| `backend/internal/devtls/`、`httpapi/common*.go`、`server*.go`          | 专用 CA、严格 JSON/错误/版本契约、代理信任及服务器安全 |
| `backend/internal/store/`、`backend/migrations/002_content_history.sql` | 追加迁移、全部 checksum 核验、数据库/引用约束验证      |
| `backend/seed/v1.json`、`scripts/export-admin-seed.mjs`                 | V1.0 完整性导出与一次性草稿导入                        |
| `backend/go.mod/go.sum`、`backend/Dockerfile`                           | 锁定密码/TTY/WebP 依赖、非 root 运行与种子打包         |
| `compose.admin-dev.yaml`、`deploy/admin-dev/`                           | 可信本地 HTTPS、精确代理和持久卷隔离                   |
| `scripts/admin-api-smoke.mjs`、`admin-dev-smoke.mjs`                    | 真实 Docker PTY 初始化、TLS/认证/持久化与降级保护验收  |
| `README.md`、`docs/PROGRESS.md`、`docs/V1.1-*.md`、本交付/安全/证据     | 实际操作、范围、结果、风险和 P6-C 接口交接             |

## 5. 实际执行的验证

| 检查              | 实际结果                                                                                                                  | 证据与边界                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Go 全包           | 最终 Linux `go test -count=1 -v ./...`：48 个顶层测试、0 失败、0 跳过；224 条 HTTP/HTTPS 预期与实际记录，另有并发保存汇总 | [完整日志](../evidence/P6B-go-tests.txt)；包括 POSIX 权限和 symlink 分支                                                |
| Go 静态/模块      | `go vet ./...`、`go mod tidy`、`go mod verify` 通过                                                                       | Linux 测试与 vet 在 network=none 的隔离容器执行；模块下载单独进行                                                       |
| 真实认证 HTTPS    | 专用 CA 信任链/主机名验证开启，正确登录 200，错误密码 401，限速 429，CSRF/nonce 403，退出/过期/改密后 401                 | [认证证据](../evidence/P6B-auth-http.txt)、[15 项安全对照](../P6B-SECURITY-TESTS.md)；时间用例使用可控服务端时钟        |
| TLS 与 CLI        | 不信任本地 CA 时验证失败；显式信任后登录成功；真实 Docker 分配 TTY 隐藏输入初始化，非 TTY 初始化拒绝                      | 无 `-k`、关闭验证或降级 Cookie；随机测试密码不输出/保存                                                                 |
| 内容与媒体 HTTP   | 项目/分类/资料/设置、归档/恢复/排序、幂等、并发 revision、SQL/XSS/URL 输入、恶意上传及三类引用保护通过                    | 请求/预期/实际记录见 Go 日志与安全表；不是完整渗透测试                                                                  |
| Docker 构建/健康  | API 镜像构建成功；API/frontend/gateway healthy，api-init 退出 0                                                           | [脱敏容器状态](../evidence/P6B-docker.json)                                                                             |
| Docker 数据持久化 | 保留卷重建镜像/容器后原 Session/workspace/media 200，数据/hash/导入幂等保持                                               | [持久化日志](../evidence/P6B-docker-persistence.txt)；无数据库删除或卷清理                                              |
| HTTP 降级保护     | 管理 API 426、无 Cookie；UI 阶段路径 503/no-store/noindex                                                                 | [网关冒烟](../evidence/P6B-http-guard.txt)                                                                              |
| 前台规范与单测    | `npm run check`（ESLint、Prettier、TypeScript）、`npm test`（4/4）通过                                                    | 最终文档格式化后的完整 check 已通过；未改 V1.0 代码                                                                     |
| 前台产物          | `npm run build`、`npm run generate` 退出 0，静态生成 10 条路由                                                            | 本地真实构建，非推测                                                                                                    |
| 前台 HTTP 回归    | 首页/项目/关于/路径变体、SEO、robots/sitemap、22 个资源、health/404 通过                                                  | [前台冒烟](../evidence/P6B-frontend-smoke.txt)；沿用原隔离前台镜像                                                      |
| 依赖安全          | npm 7 high / 0 critical；Go symbol 0、imported package 0、required module 1                                               | [Go 扫描](../evidence/P6B-govulncheck.txt)、[安全风险记录](../P6B-SECURITY-TESTS.md#依赖风险未将未修复问题标记为已修复) |

实际 API 镜像为 `xiaowork-homepage-api:p6b-dev`，image ID 为 `sha256:a0b36942bc8c11d53841d4f1da652155badd93b07bf1faa79606ab9aab23fc80`。容器、端口、安全属性和各卷边界见 Docker 证据；开发标签不作为生产发布版本。

本轮曾出现两类真实失败并修正：Linux fixture 误用受 umask 影响的宽权限临时根，改为独立 0700 上传目录后从最终源码重建全包复验，生产权限校验未放宽；官方 Go 模块代理在本机网络返回错误域名证书，首次构建失败，随后使用既有 P6-A HTTPS 代理参数构建成功，TLS 与 Go checksum 校验均未关闭，仓库默认代理未改。

## 6. 安全风险与未完成项

1. **npm 高危未修复**：`node-forge@1.4.0` 的 GHSA-86w9-cpqp-85rv 沿构建链产生 7 个 high 条目；本轮查询仍无确认兼容修复。未使用 force、破坏性降级或未经审查 override。静态 Nginx 和 Go API 不运行 Node，但开发/构建风险仍在，用户未接受公网风险的决定继续有效。
2. **Go 模块级记录保留**：GO-2026-5932 指向停止维护且无修复的 `x/crypto/openpgp`。当前代码使用 Argon2、不导入 openpgp，扫描无可达符号或受影响导入包；不能说整个模块风险清零。
3. **图片局限**：AVIF/GIF/SVG 上传、远端截图抓取、物理 GC 均未实现。真实 EXIF/GPS 样本全集、25M 像素峰值与 DoS 压测未完成；事务失败可能保留孤儿 blob，保守保留并留待审查式 GC。需后续磁盘配额/告警。
4. **尚无管理 UI**：未声称完成浏览器后台、键盘、多标签 UI 或后台 CSP 页面验收。并发冲突以真实 HTTPS 客户端验证；本阶段未重跑 V1.0 完整视觉矩阵/Lighthouse。
5. **尚无静态发布链**：快照构建、私有预览、worker、激活指针、任务对账、历史版本恢复和发布故障恢复仍属 P6-D。草稿不改变前台 HTML、hydration 或 SEO。
6. **恢复与上线准备**：容器持久化不是备份恢复；完整 SQLite/媒体恢复、跨版本升级回滚、镜像 CVE、资源峰值和生产预检留 P6-E。V1.0 脚本不能直接升级此分支或回退 schema2。

## 7. 下一阶段与交接

P6-C 依次接入：challenge/login/session → 登录/退出/改密 → dashboard → 项目/分类 CRUD/归档/排序 → 图片上传/私有预览/确认 → profile/settings。完整字段、头部、响应、限制见 [API 使用及 P6-C 清单](../V1.1-API-USAGE.md#7-尚未实现与-p6-c-对接清单)。

UI 需正确处理 401/403/409/413/415/422/428/429，冲突时保留未保存输入，不自动覆盖；拖拽排序同时提供键盘操作，私有 contentUrl 不作为永久公开地址。发布/预览/恢复继续禁用并说明 P6-D。

敏感运行资料仅在忽略目录与本地 Docker 卷：不提交数据库、上传图、密码、Cookie、CSRF、秘密或私钥。不合并 main、不强推、不部署生产。

## 8. 已完成的 Git 提交与推送

- 分支：`feat/v1.1-admin-p6a`。
- P6-B 实现、说明、交付及脱敏证据同次提交：`ae05c1fe7e76e84cbaa0171ccbef8da7bd06656b`（`feat: implement P6-B secure admin APIs and draft persistence`）。
- `git push origin feat/v1.1-admin-p6a` 实际退出 0；随后 `git ls-remote --heads origin feat/v1.1-admin-p6a main` 核实功能分支指向该完整 SHA，main 仍为 `14f9b1fba6504b1367aad6165a0b72c37e495927`。
- 推送后工作区干净。以上是已发生事实；本段为随后纯文档登记，不将它自身的提交 SHA 写入同一文件。最终文档提交及再次推送结果在最终回复报告。
