# Docker 部署、升级与回滚

## 适用范围与前提

本方案用于 Nuxt 静态生成站点。最终容器为 Nginx，不包含数据库、用户上传目录或服务端 Node 运行时。P1 提供部署基础与本地验证，生产连接和部署需另行授权。

Linux 主机需 Docker Engine、Docker Compose 插件（支持 `up --wait`，建议 2.20+）、Bash、可访问镜像仓库与 npm 注册表的网络，以及足够的构建内存。构建在容器内完成，宿主不需要安装 Node/npm。源码必须包含 `package-lock.json`。不要覆盖既有反向代理、80/443 端口或其他服务。

所有命令在项目目录执行；部署脚本自身也能从其他目录定位项目。Windows 开发可使用 Git Bash 运行脚本；生产以 Linux Bash 为准。Docker Desktop 须运行 Linux 容器。

## 首次部署

```bash
cp .env.example .env
# 根据实际环境编辑 .env
bash deploy.sh v1.0.0-p1
docker compose --env-file .env ps
curl --fail http://127.0.0.1:3100/health.json
```

省略复制步骤时脚本会自动创建默认 `.env`，不会覆盖已有配置。`deploy.sh` 检查 Docker、Compose 和配置，然后构建并等待健康检查通过；重复使用相同标签会复用原镜像。需要构建新源码时使用新标签。

| 配置项                 | 默认值            | 说明                                                                         |
| ---------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `BIND_ADDRESS`         | `127.0.0.1`       | 绑定宿主回环地址                                                             |
| `HTTP_PORT`            | `3100`            | 宿主服务端口，部署前检查是否占用                                             |
| `IMAGE_TAG`            | `p3-local`        | 手动 Compose 的镜像标签，脚本参数优先                                        |
| `NUXT_PUBLIC_SITE_URL` | 空                | 已确认的正式 HTTPS origin；构建时生成 SEO 与 sitemap，不能仅在容器运行时修改 |
| `XIAOWORK_ENV_FILE`    | 项目根目录 `.env` | 可选脚本环境变量，指定外部配置的绝对路径                                     |

无需填写秘密或正式域名即可本地验证。版本标签只能含 Docker 支持的字母、数字、点、下划线与连字符。省略首次部署标签时，优先使用当前 Git 短 SHA；无提交则为 `p1-local`。正式发布应显式提供唯一版本号。

P3 增加可选的构建参数 `NUXT_PUBLIC_SITE_URL`。域名未确认时留空，网页省略绝对 canonical / 分享 URL，robots 不声明 sitemap，`/sitemap.xml` 为 404。确认后在 `.env` 填入真实 HTTPS origin（无子路径、查询或凭据）；`deploy.sh` / `update.sh` 经 Compose build args 传入 Nuxt 静态生成，自动输出三个页面的 canonical / 分享信息与 sitemap。修改域名需要使用**新的镜像标签并重新构建**；复用旧标签、只重启或仅修改容器环境不会改变静态 SEO。回滚时也会恢复旧镜像里构建的域名配置。不要在公共站点使用调试域名或 localhost origin。

## 一键更新

1. 保留旧镜像、`.env` 和 `.deploy/`，把经过验证的新版本源码准备到项目目录。若已建立 GitHub 流程，可先执行 `git pull --ff-only`；脚本不会自行切分支或覆盖工作区。
2. 执行一条更新命令：

```bash
bash update.sh v1.0.0-p2
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

- 默认 `127.0.0.1:3100 → 容器 8080`，适合同机宿主 Nginx。不会占用 80/443。
- 如果 Nginx Proxy Manager 运行在容器里，它的 `127.0.0.1` 指向自己。应按实际拓扑将两个服务加入同一外部 Docker 网络，并通过 `web:8080` 转发，再移除不需要的宿主端口映射；该变更属于部署环境配置，P1 不预设网络名。
- 反代在另一台机器时不能直接访问回环地址，需要按真实私网拓扑设置绑定地址、访问控制、TLS 与 DNS，不能直接套用共网方案。
- 正式域名与证书配置待部署授权后确定；本项目不安装或接管已有 NPM、不修改防火墙或 SSH。

## 日志、健康与停止

```bash
docker compose --env-file .env logs --tail 100 web
docker compose --env-file .env ps
curl --fail http://127.0.0.1:3100/health.json
curl --fail http://127.0.0.1:3100/projects/
docker compose --env-file .env stop web
```

镜像与 Compose 采用非 root、只读根文件系统、临时 `/tmp`、移除 Linux capabilities、`no-new-privileges`。健康检查请求真实静态文件，返回成功才认定就绪。404 返回实际 404，不把所有未知路径伪装成首页。`/_nuxt/` 哈希资源长期缓存，页面与主题初始化脚本不长期缓存。

部署脚本不执行 `down -v`、prune、删除镜像、改防火墙等操作。健康检查只验证站点服务可读，浏览器功能和视觉仍需独立验收。
