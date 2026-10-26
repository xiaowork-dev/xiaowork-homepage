# Docker 部署、升级与回滚

## 适用范围与前提

本方案用于 Nuxt 静态生成站点。最终容器为 Nginx，不包含数据库、用户上传目录或服务端 Node 运行时。当前生产目标为已确认的 SSH 别名 `xiaowork-main`，使用已有 **1Panel + OpenResty**，主站 `https://xiaoworks.com`，不配置 www。用户已允许内部部署与明确占位内容，尚未接受上游 high 风险；本站公网路由与 DNS 继续保持未放行。实际执行结果见 [最新进度](PROGRESS.md)。

Linux 主机需 Docker Engine、Docker Compose 插件（当前回环模式需支持 `up --wait`，建议 2.20+）、Bash、可访问镜像仓库与 npm 注册表的网络，以及足够的构建内存。Git 版本发布入口另需 Git。目标只读巡检已识别 Debian 12、已有 OpenResty host 网络及当时未占用的 3100；实际执行前仍要复核端口和资源。构建在容器内完成，宿主不需要安装 Node/npm。源码必须包含 `package-lock.json`。不要覆盖既有反向代理、80/443 端口或其他服务。

所有命令在项目目录执行；部署脚本自身也能从其他目录定位项目。Windows 开发可使用 Git Bash 运行脚本；生产以 Linux Bash 为准。Docker Desktop 须运行 Linux 容器。

## 首次部署

```bash
cp .env.example .env
# 编辑未跟踪的 .env：
# BIND_ADDRESS=127.0.0.1
# HTTP_PORT=3100
# NUXT_PUBLIC_SITE_URL=https://xiaoworks.com
# REVIEWED_SHA 必须来自本次已验收版本，不自动跟随最新 main。
XIAOWORK_COMPOSE_FILE=compose.yaml bash release.sh deploy "$REVIEWED_SHA"
docker compose --env-file .env ps
curl --fail http://127.0.0.1:3100/health.json
```

省略复制步骤时脚本会自动创建默认 `.env`，不会覆盖已有配置；正式 origin 不会自动从文档填入，必须在运行前设置。`release.sh` 选择精确已审 SHA，再调用 `deploy.sh` 检查 Docker、Compose、构建和健康。重复使用相同标签会检查并复用原镜像；需要构建新源码或新 origin 时使用新标签。以上是执行说明，不表示已经执行生产部署。

| 配置项                 | 默认值            | 说明                                                                                |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `BIND_ADDRESS`         | `127.0.0.1`       | 绑定宿主回环地址                                                                    |
| `HTTP_PORT`            | `3100`            | 宿主服务端口，部署前检查是否占用                                                    |
| `IMAGE_TAG`            | `p5a-local`       | 手动 Compose 的镜像标签，脚本参数优先                                               |
| `NUXT_PUBLIC_SITE_URL` | 空                | 生产设为 `https://xiaoworks.com`；构建时生成 SEO 与 sitemap，不能仅在容器运行时修改 |
| `XIAOWORK_ENV_FILE`    | 项目根目录 `.env` | 可选脚本环境变量，指定外部配置的绝对路径                                            |

无需填写秘密或正式域名即可本地验证。版本标签只能含 Docker 支持的字母、数字、点、下划线与连字符。省略首次部署标签时，优先使用当前 Git 短 SHA；无提交则为 `p1-local`。正式发布应显式提供唯一版本号。

生产构建参数 `NUXT_PUBLIC_SITE_URL` 固定使用已确认的 `https://xiaoworks.com`，无 www。仓库模板仍留空，方便本地验证；空值时网页省略绝对 canonical / 分享 URL，robots 不声明 sitemap，`/sitemap.xml` 为 404。`deploy.sh` / `update.sh` 经 Compose build args 传入 Nuxt 静态生成，自动输出三个页面的 canonical / 分享信息与 sitemap。修改域名需要使用**新的镜像标签并重新构建**；复用旧标签、只重启或仅修改容器环境不会改变静态 SEO。回滚时也会恢复旧镜像里构建的域名配置。不要在公共站点使用调试域名或 localhost origin。

## 一键更新

1. 保留旧镜像、`.env` 和 `.deploy/`，把经过验证的新版本源码准备到项目目录。优先用 `bash release.sh update <已验收完整40位SHA>` 获取确认仓库 main 中的精确提交并调用更新；不把任意最新 main 当作已验证版本。手动使用 update.sh 时自行准备已验收源码。
2. 执行一条更新命令：

```bash
bash update.sh <新的唯一版本标签>
```

脚本先检查配置并构建新镜像；构建失败不会替换运行容器。启动后等待健康检查，失败时自动尝试恢复上一镜像，并返回非零状态。恢复也失败会输出明确错误，需要查看日志。更新期间单副本可能有短暂停机，不承诺零停机。

成功版本记录到 `.deploy/current`，上一版本写到 `.deploy/previous`。该目录与 `.env` 均不进入 Git。脚本拒绝覆盖已存在的新版本镜像标签；若手动删除镜像，相关回滚能力也会消失。不要并发执行部署脚本。

## 回滚与备份

```bash
# 回到上一成功版本
bash rollback.sh
# 或明确指定保留的旧镜像
bash rollback.sh v1.0.0-p1
```

回滚只使用本地已有镜像，`--no-build` 禁止用当前源码重建旧版本，健康检查通过后才记录状态。也可绕过状态记录手动恢复：

```bash
IMAGE_TAG=v1.0.0-p1 docker compose --env-file .env up -d --no-build --wait web
```

手动恢复后应再运行同标签的 `rollback.sh`，同步部署状态。Compose 普通命令不会自动读取 `.deploy/current`，它们读取 `.env` 中的标签；重建/重启时务必明确设置正确的 `IMAGE_TAG`。

站点没有数据库，无数据迁移。建议在项目外备份 `.env`、`.deploy/` 和对应 Git 源码版本；需要离线恢复时保存镜像：

```bash
docker image save xiaowork-homepage:v1.0.0-p1 -o /path/outside-project/xiaowork-v1.0.0-p1.tar
docker image load -i /path/outside-project/xiaowork-v1.0.0-p1.tar
```

备份目录由操作者按实际环境选择。旧镜像未保留时，仅有源码不足以保证离线回滚；可按旧源码与 lockfile重新构建，但基础镜像/注册表仍需网络。当前基础镜像锁到版本标签，尚未锁镜像 digest，不承诺位级复现。

## 反向代理与 HTTPS

- 当前采用 `compose.yaml`，显式绑定 `127.0.0.1:3100 → 容器 8080`，应用使用项目独立默认 Docker 网络。不要设置 `0.0.0.0`、公网 IP 或 IPv6 通配地址，不加入 NPM 网络。
- 已有 1Panel 管理的 OpenResty 使用 host 网络，与宿主共用网络命名空间，因而可将本站上游设为 `http://127.0.0.1:3100`。不新装或接管反代，不占用额外公网 80/443。
- 本站 OpenResty vhost、证书、HTTPS 跳转和 Cloudflare 记录须待风险放行后单独验收；目前不新增公网路由、修改 DNS 或切换 TLS。最终目标是根域 `xiaoworks.com` 的 Cloudflare 橙云与 Full (strict)，有效证书必须覆盖根域，不配置 www。
- 回环端口限制不等于禁止通过源站 80/443 携带正确 Host/SNI 直连。正式开放前需设计只影响本站的访问控制并实际验证；不为本站修改整机 80/443 白名单，不修改其他站点或无关 NPM 配置。
- `compose.proxy.yaml` 仅保留历史兼容能力（Compose 2.24.4+），不作为当前生产模式。未来换拓扑须重新检查访问控制；已有模式迁移须计划、备份与验证，不可删状态文件绕过保护。

## 日志、健康与停止

```bash
docker compose --env-file .env logs --tail 100 web
docker compose --env-file .env ps
curl --fail http://127.0.0.1:3100/health.json
curl --fail http://127.0.0.1:3100/projects/
docker compose --env-file .env stop web
```

镜像与 Compose 采用非 root、只读根文件系统、临时 `/tmp`、移除 Linux capabilities、`no-new-privileges`。健康检查请求真实静态文件，返回成功才认定就绪。404 返回实际 404，不把所有未知路径伪装成首页。日志输出到 stdout/stderr，Compose 的 json-file 驱动按每文件 10 MB、最多 3 个文件轮转；实际磁盘占用还受 Docker 日志元数据影响。

P4 开启 HTML/CSS/JS/JSON/SVG/XML 的 gzip（小于 1024 字节不压缩），并发送 `Vary: Accept-Encoding`。`/_nuxt/` 哈希资源缓存一年且 immutable，`/images/` 缓存一天；页面、payload 和主题初始化脚本使用 no-cache 重新验证。替换封面/分享图使用新文件名，避免一天内缓存旧图。`security-headers.conf` 在带缓存头的 location 中显式引入，确保 nosniff、Referrer-Policy、禁止 iframe 嵌入和敏感设备权限限制不因 Nginx add_header 继承规则失效。

内部部署后使用 `npm run smoke -- http://127.0.0.1:3100 https://xiaoworks.com --static-headers`，同时检查正式 origin 产物及 Nginx 缓存、安全头和 HTML 压缩。该命令需要在可访问对应回环服务且已安装检查工具的环境运行；也可通过已有只读安全转发从本地验证，不向公网暴露端口。反代应保留相关头；TLS/HSTS、CDN、公网 Lighthouse 和实际浏览器由公网放行后另行验收，内部 HTTP 通过不等于 HTTPS 已上线。

部署脚本不执行 `down -v`、prune、删除镜像、改防火墙等操作。健康检查只验证站点服务可读，浏览器功能和视觉仍需独立验收。

## 本地隔离验收与故障恢复

验收使用独立源码副本、独立 `COMPOSE_PROJECT_NAME`、独立 `.env` 和 `.deploy`，选择空闲回环端口。不要在真实部署目录注入故障。建议按 deploy → update → rollback → 重复 deploy 验证，保存实际标签和健康结果，再在副本中测试构建失败及健康检查失败。失败时检查脚本退出码、运行镜像和 `.deploy/current` 三者，不能只看“恢复”日志。

回滚依赖旧镜像存在且环境仍兼容。构建失败应保留旧容器；新容器不健康时 update.sh 尝试恢复旧镜像并返回非零。配置错误发生在替换前；旧镜像本身也不健康、磁盘满或 Docker 不可用时自动恢复可能失败，必须人工排障。不宣称单副本无停机或涵盖所有故障。

P4 的实际脚本验收结果和范围见 [交付文档](deliveries/P4-delivery.md)。正式发布前执行 [上线检查](RELEASE-CHECKLIST.md)，确认真实域名/内容、可接受的依赖风险及独立生产授权。

## P5-A 发布入口与配置保护

详细生产方案见 [P5 部署准备](P5-DEPLOYMENT-PLAN.md)，资料和授权门槛见 [P5 发布清单](P5-RELEASE-CHECKLIST.md)，本次调整见 [OpenResty 方案](deliveries/P5-openresty-plan.md)。P5-A 未连接生产的结论仅适用于历史阶段。

`release.sh <deploy|update> <完整SHA>` 校验仓库身份、main、干净工作区、远端 main 包含目标提交及当前 HEAD 可快进到目标；fetch 后精确快进并执行已有脚本，标签为 `git-<SHA前12位>`。不自动选择“最新”、不 reset、不覆盖环境文件，也不替代人工验收。首次 clone 即处于较新 main、目标 SHA 较旧时会拒绝；请选择最终已验收提交，或在新专用 checkout 里明确准备目标版本，不能强制回退现有部署目录。

构建镜像保存 `org.opencontainers.image.revision` 和 `io.xiaowork.site-url`；手动无 Git 发布的本地构建 revision 可为空，不伪造来源。deploy 复用镜像时检查 origin，且 release 入口会核对 SHA，防止静态产物域名/来源错配。P4 历史镜像未含这些标签，可能拒绝用 deploy 重复复用；恢复旧镜像仍用 rollback.sh，不重建或覆盖它。

成功后 `.deploy/compose-file` 记录 `compose.yaml` 或 `compose.proxy.yaml`；后续三种脚本自动沿用。当前首次部署显式选择 `compose.yaml`；后续保持该记录。显式指定不同模式会拒绝；不要随意删除记录绕过检查。首次部署中途失败尚无成功记录时，重试仍须显式选择原模式。普通 Docker Compose 命令不读该记录，人工检查当前模式应使用 `docker compose --env-file .env -f compose.yaml ps`，重启/恢复还须明确正确的 `IMAGE_TAG`。

P5-A 共网和失败恢复的本机实测结果见 [P5-A 交付](deliveries/P5A-delivery.md)，不作为本次 OpenResty 生产验收。本次只读脚本兼容性检查确认无须更改脚本即可选用回环模式；尚需实际内部部署健康检查及最终公网 TLS/DNS/防绕过验收。基础镜像目前锁版本标签，尚未锁 digest；OS CVE 状态须在最终交付独立记录。
