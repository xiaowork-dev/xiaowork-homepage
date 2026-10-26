# P5 生产部署方案：1Panel + OpenResty

日期：2026-10-26。用户已确认目标 SSH 别名 `xiaowork-main`，正式主站 `https://xiaoworks.com`，无 www；生产反代统一使用已有 **1Panel + OpenResty**。本稿同步方案及发布边界，不代表已执行服务器内部部署或公网开放；实际状态见 [项目进度](PROGRESS.md) 和最终生产交付。

## 当前拓扑

访客 → Cloudflare（HTTPS）→ 已有 1Panel/OpenResty（host 网络，HTTPS）→ `http://127.0.0.1:3100` → Homepage 静态 Nginx `8080`。

应用选用 `compose.yaml`，显式配置 `BIND_ADDRESS=127.0.0.1`、`HTTP_PORT=3100`，使用项目独立默认 Docker 网络，不加入 NPM 共享网络。保留非 root、只读、tmpfs、健康检查、限权和日志轮转。`compose.proxy.yaml` 仅保留历史兼容能力，不是当前生产方案；不重装、接管或修改已有 NPM。

OpenResty 已确认使用 host 网络，可访问宿主回环服务。回环绑定不会把 3100 暴露为公网应用端口；最终仍须实测 IPv4/IPv6、Docker 实际绑定和源站 80/443 的 Host/SNI 直连，不以回环绑定代替 Cloudflare 防绕过验收。

## 已确认与未放行

| 项目         | 当前事实与要求                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标         | `xiaowork-main`，只读识别 Debian 12 和已有 OpenResty host 网络；敏感地址、登录信息和实际备份路径仅本地记录                                                       |
| 冲突检查     | 本轮只读检查时 3100 空闲、计划专用目录及同名 Compose 项目不存在、根域无现有代理配置；操作前复核，不能将历史结果当永久保证                                        |
| 域名         | `https://xiaoworks.com`，不配置 www；本轮公共 A/AAAA 查询无 Answer，未修改 DNS                                                                                   |
| 内容         | 用户允许首版保留明确占位；Blog/Nav/ERP 不改成真实状态、不补假链接、截图或技术栈                                                                                  |
| 安全         | npm audit 仍为 7 high，未发现兼容修复；用户暂不接受剩余风险，安全验收未通过                                                                                      |
| 当前范围     | 可准备并执行已授权的服务器内部回环部署和预览；不新增公网 vhost、不修改 DNS、不判定正式上线                                                                       |
| 正式构建验证 | 本机已以预检源码 `bc3f11c3fe084fcfe8313a901a972643dafe0fe3`、正式 origin 重建并通过 HTTP/SEO 及部分实际浏览器检查；不是服务器已部署版本，最终选定的完整 SHA 另记 |

## 构建 origin 与 HTTPS

生产部署的未跟踪 `.env` 必须设置：

```dotenv
BIND_ADDRESS=127.0.0.1
HTTP_PORT=3100
NUXT_PUBLIC_SITE_URL=https://xiaoworks.com
```

`PROXY_NETWORK` 和 `PROXY_SERVICE_ALIAS` 在当前模式不使用，保持空值。仓库 `.env.example` 的 origin 继续为空，仅在注释提示正式值；不将私钥、密码或 Token 写入仓库。

origin 是构建时参数：必须以新唯一标签构建，不能复用空值或 localhost 镜像，也不能只重启容器。验收三页 canonical、`og:url`、分享图片绝对 URL、三项 sitemap 与 robots。旧镜像回滚也会恢复其原 SEO origin。

公网放行后才配置本站 OpenResty vhost 和匹配根域的有效证书，Cloudflare 目标为橙云与 **Full (strict)**。不使用 Flexible；通配符 `*.xiaoworks.com` 不能自动作为根域证书通过依据。先核对已有 Cloudflare 重定向/缓存规则，HTTP 只向唯一 HTTPS 主站收敛，不配置 www。不得改变可能影响其他子域的全局 TLS/缓存设置。

## 内部部署步骤

1. 复核存量容器/端口、资源、专用目录归属与同名 Compose 项目；保留只读基线，不安装宿主 Node/npm，不修改无关服务。
2. 在已确认的独立目录从正式 GitHub 仓库获取代码。选定**完整、已审查且已推送的 SHA**，不自动跟随最新 main。
3. 配置上述 `.env`，确认 build origin、回环绑定和当前模式；保留配置与已有版本备份。
4. 首次执行以下入口，已有本项目实例改用 `update`：

```bash
# REVIEWED_SHA 必须先设为交付记录中的完整40位已验收提交。
XIAOWORK_COMPOSE_FILE=compose.yaml bash release.sh deploy "$REVIEWED_SHA"
docker compose --env-file .env -f compose.yaml ps
curl --fail http://127.0.0.1:3100/health.json
curl --fail http://127.0.0.1:3100/projects/
curl --fail http://127.0.0.1:3100/about/
```

5. 检查容器 healthy、实际端口只绑定回环、非 root/只读/限权/日志轮转、镜像完整 revision 和正式 origin 标签。OpenResty host 可达性只验证内部链路，不新建公网路由。
6. 对回环产物进行 HTTP/SEO、实际浏览器和必要性能检查。将真实结果写入生产交付，仍保持公网门槛关闭。

`release.sh` 要求确认仓库、main、干净 checkout、目标在 fetched main 历史且可从 HEAD 快进；精确快进后调用现有 deploy/update，标签为 `git-<SHA前12位>`。它不替代版本人工验收，不强制 reset，不覆盖 `.env`。

同源码不同 origin 不能覆盖已有标签。改变构建配置时用新的已验证提交/唯一标签；人工使用 `update.sh <新唯一标签>` 时另记源码 SHA 和配置对应关系。

## 脚本兼容与模式保护

`release.sh`、`deploy.sh`、`update.sh`、`rollback.sh`、`deploy/common.sh` 均可沿用，无需源码重构。首次部署显式指定 `compose.yaml`；成功后 `.deploy/compose-file` 记忆该模式，更新和回滚沿用。已有 `compose.proxy.yaml` 记录时会拒绝模式切换；必须先备份、计划迁移与恢复，不能删除记录规避检查。

首次 `deploy` 健康失败返回非零，没有旧版本自动恢复保证；已有实例使用 `update`。构建失败不替换旧容器，新版健康失败尝试恢复旧镜像。单副本更新不承诺零停机，Docker 故障、磁盘满或旧镜像不健康时恢复也可能失败。

## 公网放行后的独立步骤

在兼容安全修复复验或用户明确接受记录中的剩余 high 风险之前，不执行本节。

1. 备份本站相关 OpenResty/1Panel vhost、证书引用及 Cloudflare 现有记录；确认同域记录用途，发现未知业务即停止。
2. 只配置本站 `xiaoworks.com` 上游 `http://127.0.0.1:3100` 和根域有效证书，不改无关站点及 NPM。
3. 仅处理确认归属于本站的根域 DNS/代理配置，验证 Full (strict)、公网 HTTPS 与 HTTP 跳转，避免循环。
4. 核验应用 3100 无公网入口，以及源站 IP + 正确 Host/SNI 的直接回源路径。优先采用仅本站生效且与现有链路兼容的限制；不改整机 80/443 防火墙白名单。不能安全限制时记录风险，不宣称防绕过通过。
5. 复测公网三页、404/资源/health、SEO/分享图/sitemap/robots、主题/搜索/排序/手机、Lighthouse、缓存与日志；前后检查其他站点无回归。

## 更新、回滚与停止条件

```bash
bash release.sh update "<下一已验收完整SHA>"
bash rollback.sh
# 或：bash rollback.sh git-<保留旧SHA的前12位>
```

保留 `.env`、`.deploy`、Git 完整 SHA、旧镜像及本站相关 OpenResty/Cloudflare 配置的项目外备份。回滚使用本地已有镜像，不以当前源码重建旧版；它不回退源码 checkout，也不自动撤销 vhost、证书、DNS 或 Cloudflare 变更。

首次部署没有旧本站版本时，失败只停止或撤销本站新增资源；不触碰其他项目。其他站异常、TLS/DNS 冲突、健康失败、敏感内容公开或无法判断业务影响时立即停止后续变更，按备份做最小范围恢复。禁止全局 prune、`down -v`、全局网络清理和删其他容器腾空间。

关联：[发布清单](P5-RELEASE-CHECKLIST.md)、[部署指南](DEPLOYMENT.md)、[方案调整交付](deliveries/P5-openresty-plan.md)。
