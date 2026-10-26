# P5 方案调整：1Panel + OpenResty

- 日期：2026-10-26（Asia/Shanghai）。
- 状态：**方案和文档准备已完成；服务器内部部署、公网路由与 DNS 未在本记录中执行或验收。** 最终执行事实由后续生产交付记录说明。
- 范围：按用户最新确认调整生产方案，保留应用视觉、依赖、Dockerfile、Compose 和部署脚本，不重装反代，不更改无关服务。

## 用户确认与只读基线

用户确认主力服务器 SSH 别名为 `xiaowork-main`，生产反代使用已有 1Panel + OpenResty，不使用 NPM；正式主站为 `https://xiaoworks.com`，无需 www。允许首版保留明确占位，真实项目资料后续补充；暂不接受未解决的上游 7 high 风险，因此当前只执行内部部署和预览，不新增公网入口或修改 DNS。

本轮只读巡检已识别 Debian 12、OpenResty host 网络，当时 3100 空闲、专用部署目录和同名 Compose 项目不存在，根域无已有代理配置。记录仅使用 SSH 别名，不把服务器 IP、密钥、登录信息、敏感备份路径或无关站点写入仓库。公共根域 A/AAAA 查询当时无 Answer，未改 DNS。

## 调整后的方案

正式拓扑准备为 Cloudflare → 1Panel/OpenResty host 网络 → `127.0.0.1:3100` → Homepage 容器 `8080`。采用现有 `compose.yaml`，显式绑定 `127.0.0.1` 和 `3100`，使用项目独立默认 Docker 网络，不加入 NPM 网络。OpenResty 与宿主共用网络命名空间，因此可访问该回环上游。

保留非 root、只读、tmpfs、cap drop、no-new-privileges、健康检查和日志轮转。`compose.proxy.yaml` 仅作为历史兼容文件保留，不是当前生产方案。回环绑定不等于 Cloudflare 防绕过；正式公开前仍需检查源站 IP + Host/SNI 直连与 IPv4/IPv6，不修改整机 80/443 白名单。

生产未跟踪 `.env` 必须设置 `NUXT_PUBLIC_SITE_URL=https://xiaoworks.com`，以新唯一标签重建。模板保留空值作为安全本地默认，仅修改注释。不能复用此前 localhost 或空 origin 镜像。

## 现有脚本兼容性检查

本步实际读取五份 Bash 源码并逐项核对，无需修改脚本：

| 文件               | 源码复核结论                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `release.sh`       | 继续使用确认仓库、main、干净 checkout、完整 40 位已审 SHA 和快进验证；不自动跟随最新 main                         |
| `deploy.sh`        | 经公共逻辑选 `compose.yaml`，检查配置、构建、等待健康；复用标签核对 build origin/声明 SHA；首发失败不保证旧版恢复 |
| `update.sh`        | 使用记录模式，新唯一标签先构建；构建失败保留旧容器，健康失败尝试恢复旧镜像并返回非零                              |
| `rollback.sh`      | 使用已有镜像和记录模式，不用当前源码重建旧版；需要保留旧镜像                                                      |
| `deploy/common.sh` | 默认回环模式；成功后 `.deploy/compose-file` 记忆 `compose.yaml`，后续更新/回滚沿用；显式换模式会拒绝              |

首次部署显式使用 `XIAOWORK_COMPOSE_FILE=compose.yaml bash release.sh deploy "$REVIEWED_SHA"`。若发现已有代理模式实例，先保留配置/镜像并制定迁移与恢复计划，不删除模式记录绕过保护。单副本不承诺零停机，回滚不自动撤销源码 checkout、OpenResty、证书或 DNS。

## 本步验证与边界

- 已完成当前文档、模板注释与源码事实对照；ESLint、Prettier、TypeScript 与四项单测全部通过。五个 Bash 文件语法检查和本机 Compose 解析通过，实际映射为 127.0.0.1:3100 -> 8080。首次格式检查发现新证据 JSON/文档样式问题，格式化后完整复查通过。
- 本轮主任务已用预检源码 `bc3f11c3fe084fcfe8313a901a972643dafe0fe3` 和正式 origin 在本机重建，三页/22 资源/SEO/sitemap HTTP 冒烟通过；实际浏览器覆盖桌面首页、分类/名称倒序/Nav 搜索、主题刷新与手机浅色关于/菜单。该结果不代表服务器已部署，也不替代后续完整公网验收。
- 本步没有调用 SSH/Docker、操作 NPM/Cloudflare、修改脚本/Compose 或提交 Git；主任务后续以审核后的完整 SHA 执行内部部署并记录真实结果。
- npm audit 实查仍为 7 high、0 critical；官方 `GHSA-86w9-cpqp-85rv` 影响 node-forge `<=1.4.0`，尚无 patched 版本，相关 npm latest 与安装版本一致。最终静态 Nginx 不包含 Node，但构建风险未消除，用户尚未接受，不能将安全验收标通过。

## 修改文件

`README.md`、`docs/DEPLOYMENT.md`、`docs/P5-DEPLOYMENT-PLAN.md`、`docs/P5-RELEASE-CHECKLIST.md`、`docs/P5-CONTENT-CHECKLIST.md`、`docs/RELEASE-CHECKLIST.md`、`.env.example` 注释及本记录。历史 P0～P5-A、P5-B 预检保留原样；最新进度与最终生产交付由主任务同步。

## 后续与发布门槛

先审核并正常提交文档版本，使用完整已审 SHA 执行独立目录内部回环部署；验证健康、端口、正式 origin SEO 和其他服务基线。公网继续关闭，等待兼容安全修复复验或用户明确接受剩余风险，再核对本站 OpenResty/证书/Cloudflare 备份与入口限制，获放行后执行公网验收。

关联：[当前部署方案](../P5-DEPLOYMENT-PLAN.md)、[发布门槛](../P5-RELEASE-CHECKLIST.md)、[资料范围](../P5-CONTENT-CHECKLIST.md)、[历史部署预检](P5B-preflight.md)。
