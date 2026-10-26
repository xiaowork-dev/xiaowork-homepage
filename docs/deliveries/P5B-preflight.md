# XiaoWork Homepage V1.0 — P5-B 部署预检

- 日期：2026-10-26（Asia/Shanghai）。范围仅为本机、公开 GitHub/官方资料和本机隔离 Docker；**未连接生产服务器，未执行正式部署**。
- 前置：用户确认 P5-A 基本通过工程验收。本次允许部署预检，未授权 SSH 登录、生产容器、NPM、Cloudflare、DNS、证书或防火墙变更。
- 结论：**本机工程及发布工具已具备，正式部署放行条件尚未齐备。完成本报告后停止，不自动进入生产操作。**

## 1. 基线与核对范围

已阅读 [P5-A 交付](P5A-delivery.md)、[部署计划](../P5-DEPLOYMENT-PLAN.md)、[发布清单](../P5-RELEASE-CHECKLIST.md)、[正式资料](../P5-CONTENT-CHECKLIST.md)、[部署说明](../DEPLOYMENT.md) 和 [项目进度](../PROGRESS.md)，复核源码、Compose、Nginx 及五份 Bash 文件。保留已验收视觉、Nuxt 静态架构、主题、交互及部署机制，无应用代码、依赖或生产配置变更。

起始 Git 工作区干净，分支 `main`，身份沿用用户已配置的仓库级身份。`git ls-remote --heads origin main` 实查远端与本机均为：

```text
bde8113e469e5517a7b0b081ab8c08694c2227ad
feat: complete P5-A release preparation
```

远端为已确认的 `xiaowork-dev/xiaowork-homepage`；公开仓库 HEAD 请求 HTTP 200。上述为本轮起始源码基线，不代表本轮文档提交或已部署版本。本轮最终提交 SHA、推送结果在交付回复中记录，不在待提交文件自引用自身 SHA。不强推、不改写历史。

## 2. 本机 SSH 配置核对

- 已阅读本机 `server-ssh` 技能及别名枚举脚本，检查用户级 OpenSSH 配置；发现 **2 个显式 Host 别名**，均配置目标、用户、端口、IdentityFile 和 `IdentitiesOnly yes`，对应密钥路径存在。
- 当前配置没有 Include、Match、ProxyCommand 或 ProxyJump 指令。用户尚未指定本网站使用哪个 Host，不能从名字猜测生产目标。
- 技能的枚举脚本被本机未签名脚本执行策略阻止，改用只读配置解析得到以上结果；没有修改执行策略，也没有读取私钥内容。
- **没有执行 ssh、ssh -G、连接探测、远程命令或主机指纹接受。** 文件存在不证明认证成功、服务器在线、Docker 权限或部署适配。
- 公开仓库不复制 SSH 原始配置、主机地址、登录用户、密钥路径或凭据。后续由用户指定已配置别名即可，无需提交私钥、密码或 API Key。

## 3. 内容与 SEO 状态

| 项目                         | 当前核对结果                                                              | 正式发布前要求                                                          |
| ---------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 品牌与介绍                   | XiaoWork / Developer & Creator，保留已验收展示文案                        | 确认现有文案与公开范围可作为首版发布                                    |
| 本站 GitHub                  | 配置与远端一致，公开 HTTP 200                                             | 可保留；不作为其他三个项目的源码地址                                    |
| Blog / Nav / ERP             | 均无官网/源码地址，`techStack=[]`、`status=unconfirmed`、明确占位封面     | 提供真实资料，或明确允许首版保留待确认展示/决定暂不展示                 |
| 项目截图                     | 三项均为各自独立的 placeholder.svg                                        | 可公开真实截图待补；ERP 必须获得脱敏演示截图授权                        |
| 个人资料                     | 详细个人介绍为空；联系方式只含本站 GitHub，简历隐藏                       | 确认当前公开范围；履历、额外联系和简历可后补，不推断 Git 邮箱           |
| 公网 origin                  | 正式域名未提供，`NUXT_PUBLIC_SITE_URL` 为空                               | 必须确认正式 HTTPS origin 与主域/别名                                   |
| 页面与分享                   | 三页独立 title/description、OG 文本；本地自有 1200×630 分享图             | 域名确定后重新生成绝对分享图地址及 `og:url`                             |
| canonical / sitemap / robots | 未伪造 canonical；robots 无 Sitemap 声明，sitemap 404，当前 HTTP 实测一致 | 正式 origin 构建后必须复验三页 canonical、三项 sitemap、robots 与分享图 |

扫描应用/共享/服务端配置未发现调试输出、TODO/FIXME 或新增未知公网入口；本机 HTTP 冒烟检查无 `href="#"` 假按钮。真实项目外链为空，因此没有冒称外部项目网站已访问或可用。有限的已跟踪文本秘密模式扫描无命中，敏感扩展名/环境文件扫描仅有 `.env.example`；这不是完整秘密审计。

正式域名是**构建时**配置。不能只改运行中容器环境或重启；必须生成新发布版本、使用新唯一标签重建。当前无域名预检镜像不是可直接上线的域名成品。

## 4. 已具备的发布机制及边界

| 文件                 | 本轮复核结果                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release.sh`         | 只接受 deploy/update 与完整 40 位 SHA；确认仓库、main、干净专用 checkout，fetch main 后验证可快进到精确已审 SHA，传递源码标签；不会自动认定最新 main 已验收 |
| `deploy.sh`          | 配置检查、先构建后启动、等待健康；旧标签复用时核对构建 origin/声明的 SHA；首次失败返回非零，**不提供 update 同等的自动旧版恢复**                            |
| `update.sh`          | 新且唯一标签；构建失败不替换旧容器；新版本健康失败尝试恢复旧镜像，失败仍返回非零；成功前不改 current                                                        |
| `rollback.sh`        | 只使用保留的本地镜像，不重新构建旧版；显式标签或 previous 状态；健康后记录版本                                                                              |
| `deploy/common.sh`   | 保留 `.env` / `.deploy`，成功后记录 Compose 模式；拒绝无意切换代理/回环模式                                                                                 |
| Dockerfile / Nginx   | Node 多阶段静态构建，最终 nginx 用户运行，无 Node；8080 内部 HTTP、静态健康检查、缓存/压缩/安全头                                                           |
| `compose.proxy.yaml` | Compose 2.24.4+，外部网络/唯一别名必填；移除宿主映射，继承只读、tmpfs、限权和日志轮转                                                                       |
| `compose.yaml`       | 默认回环 127.0.0.1:3100；不作为同机容器 NPM 的推荐生产入口                                                                                                  |

镜像标签由短 SHA 构造，完整源码 SHA 写入 OCI 标签；同源码不同 origin 不能覆盖旧标签，需要新的唯一配置版本标签并另记对应关系。基础镜像锁版本，未在 Dockerfile 固定 digest；本轮构建日志记录实际解析的 digest。固定 Compose 项目名 `xiaowork-homepage` 及共享网络内自动别名 `web` 必须进行冲突检查；NPM 上游只用确认的唯一别名，不用泛化的 `web`。

更新不是零停机。旧镜像不可用、Docker 故障或磁盘满都可能阻止恢复；镜像回滚不回退源码 checkout、NPM、DNS、证书或 Cloudflare 配置。已有实例必须用 update，不能把 deploy 当作更新失败自动恢复入口。

## 5. 本轮实际测试与历史证据

本轮环境：Windows 本机 Docker Desktop Linux Engine 29.8.2，Compose 5.6.0。操作前验证 Docker endpoint 为本机 named pipe；不是远程 Docker。初次沙箱内 DNS、Docker 管道和 Git Bash 受限，取得相应本机检查权限后重跑成功，未将初次失败计为通过。

| 检查                           | 本轮结果及证据                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub 版本与公开入口          | 实际查询一致；P5-A 完整 SHA 如上，公开入口 HTTP 200                                                                                                                                                                          |
| 五份 Bash 语法                 | 分别执行 `bash -n` 全通过；[日志](../evidence/P5B-preflight-script-check.txt)；没有执行生产发布脚本                                                                                                                          |
| 现有单测                       | 四项全部通过；[日志](../evidence/P5B-preflight-tests.txt)                                                                                                                                                                    |
| Compose 解析                   | 回环默认、代理无发布端口、外部网络/别名及权限限制符合预期；[解析结果](../evidence/P5B-preflight-compose.json)                                                                                                                |
| Docker 生产镜像                | `docker build --pull` 通过；标签 `p5b-preflight-bde8113`，完整基线 revision、空 origin；[构建日志](../evidence/P5B-preflight-docker-build.txt)。npm ci / prepare / generate 层命中缓存，**不是本轮无缓存独立安装或重新生成** |
| 健康与运行约束                 | healthy，nginx UID101、只读根、可写 /tmp、cap drop ALL、no-new-privileges、无 Node；[运行记录](../evidence/P5B-preflight-runtime.json)                                                                                       |
| HTTP / 无域名 SEO              | 三页五种路径、22 资源、robots、域名空时 sitemap、health/404、gzip/缓存/安全头通过；[日志](../evidence/P5B-preflight-http-smoke.txt)。使用独立回环随机端口，未占用 3100                                                       |
| 实际代理 Compose               | 在独立项目/外部测试网络真实启动，healthy，无任何宿主端口映射；json-file 10MB×3，独立别名与权限生效；[记录](../evidence/P5B-preflight-proxy-runtime.json)                                                                     |
| 资源清理                       | 两个本轮测试容器、专用网络及本轮新增镜像标签已清理；[记录](../evidence/P5B-preflight-cleanup.txt)。未执行全局清理或操作其他项目容器                                                                                          |
| 仓库安全                       | 有限模式扫描无命中，仅跟踪环境模板；[记录](../evidence/P5B-preflight-repository-safety.json)                                                                                                                                 |
| ESLint / Prettier / TypeScript | `npm run check` 全通过，ESLint 零警告；[日志](../evidence/P5B-preflight-code-checks.txt)                                                                                                                                     |

**本轮未重跑的历史验收**：P5-A 已完成独立 npm 安装/生产 build/generate、部署→更新→回滚和故障恢复、共享网络反代 HTTP、30 组响应式/双主题浏览器检查及六份 Lighthouse。证据仍见 [P5-A](P5A-delivery.md)，没有把这些历史记录冒称本轮重测。本轮未重新操作浏览器、NPM 或 Cloudflare，也未做目标 Linux 主机、OS 镜像 CVE、备份介质恢复或公网 TLS 测试。

### Lighthouse 遗留复核

保留 P5-A 2026-10-26 实测：[性能汇总](../evidence/P5A-performance-summary.json)。首页手机三次均 98，LCP 中位 2035.54ms、CLS 0、TBT 46.5ms；桌面 100，项目手机 99、关于手机 98。全部生成 JS/CSS 267,172B，逐文件 gzip 98,327B。源码未变，不把历史分数标作本轮测量或新增优化。

仍有网络依赖树、部分 forced reflow、关于页同步主题脚本提示与 bfcache 检查内部错误。未用真实封面/公网链路、未测真实用户 INP/CrUX，TBT 不等于 INP；浅色独立 Lighthouse、真实设备、Firefox/Safari、完整读屏与系统减少动态效果仿真未覆盖。真实素材/域名到齐后复测，发布后再收集真实访问指标。

## 6. 安全审计：未通过

2026-10-26 本轮重新执行 `npm audit --json`，退出码 **1**，**7 high、0 critical**。七个依赖条目来自同一 `GHSA-86w9-cpqp-85rv`，不是七个独立漏洞。安装链：

```text
nuxt 4.6.2 → @nuxt/nitro-server 4.6.2
→ nitropack 2.13.5 → listhen 1.10.1 → node-forge 1.4.0
```

GitHub 官方公告仍为 RSA PKCS#1 v1.5 验签问题、CVSS 7.5、影响 `<=1.4.0`、`first_patched_version=null`；上述五项 npm latest 与安装版本相同。本轮未发现兼容修复，未执行 force、Nuxt 降级或依赖覆盖。证据：[审计](../evidence/P5B-preflight-npm-audit.json)、[公告](../evidence/P5B-preflight-advisory.json)、[官方版本](../evidence/P5B-preflight-registry.json)。

Nuxt 虽属 package dependencies，在本项目只用于开发/静态构建；最终 Nginx 容器实测无 Node，公开静态 HTTP 不直接执行该链，未发现本站 RSA 验签业务。**这只缩小生产运行攻击面，不代表依赖已修复或构建安全审计通过。** 继续隔离构建、限制不可信证书/签名输入、保持开发服务回环、固定 lockfile；发布前再次复查兼容修复。无修复时必须由用户明确决定是否接受剩余风险，否则延期。

OS 镜像 CVE 与真实源站访问控制尚未验证；不能把应用 npm 报告代替镜像/主机审计。

## 7. 正式部署必须确认的信息

| 类别       | 必须确认                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 目标与授权 | 从现有两个 SSH Host 中指定一个；部署绝对路径、操作用户/Docker 权限、明确允许的登录和生产操作范围、变更窗口与停止条件           |
| 主机       | OS/架构、Docker/Compose、磁盘/内存、构建出口网络；目录是否专用、是否已有同名 Compose 项目/本站实例                             |
| 域名       | 正式 HTTPS origin，根域/www/其他别名和唯一规范入口；不从同品牌其他站推断                                                       |
| 端口       | 现有 80/443 与 NPM 管理入口归属、防火墙/IPv4/IPv6；应用只用容器 8080，不另开公网应用端口，不占现有 3100                        |
| NPM        | 所在主机/容器，是否与应用同机；现有共享 Docker 网络名、唯一服务别名、同域 Proxy Host 是否已存在、原上游与备份方式              |
| Cloudflare | 对应 zone 与待新增/修改记录的当前值、记录类型/目标、代理状态、现有跳转/缓存/访问规则；不覆盖未知记录                           |
| HTTPS      | Cloudflare 到 NPM 的 Full (strict)，NPM 源站证书覆盖域名/有效期/签发与续期方式；HTTP→HTTPS、别名跳转和 HSTS 范围               |
| 防绕过     | 是仅要求应用端口无公开映射，还是所有公网访问必须经 Cloudflare；按本次要求优先按后者制定源站限制与验收，不能以 DNS 代理状态代替 |
| 发布与恢复 | 内容放行、high 风险处置、已验收完整 SHA；旧镜像/配置/源码及 NPM/DNS 备份位置、回退负责人、备份恢复条件                         |

**应用端口与源站 IP 是两个独立验收项。** 本机已确认代理 Compose 不映射宿主端口；真实服务器仍需检查 Docker 端口、网络路由模式、IPv6 和防火墙。即使应用无端口映射，访客仍可能用源站 IP 的 80/443 并携带正确 Host/SNI 直接进入 NPM。Cloudflare 橙云、Full (strict)、关闭默认站点或只拒绝裸 IP 均不能单独证明这种访问已被阻止。

授权后需核对源站是否已有 Cloudflare 来源限制或适用的 Authenticated Origin Pulls/mTLS，按本站/既有服务边界设计防护；同时验证正常 Cloudflare 访问与直接源站 Host/SNI 请求。不得为本站擅自对共用服务器 80/443 加全局白名单或覆盖 NPM 全局配置，这可能切断其他 DNS-only 网站、证书验证或管理访问。不能保证不影响其他服务时，应另行评审隔离入口方案，不能带着未验证的绕过路径宣称已安全上线。

## 8. 获得后续授权后的推荐步骤（本轮未执行）

1. 收齐上表的非秘密信息和资料/风险决定。先获得明确的目标 SSH 只读巡检授权，复用已有别名，检查主机、存量容器/端口/网络、NPM 拓扑与备份条件；不自动接受未知主机指纹。
2. 将实际情况整理成本站的具体变更清单，再确认生产执行范围/窗口。保留其他站点基线；如已有同域 Proxy Host/DNS 记录，先核对与备份，不直接覆盖。
3. 在专用目录准备精确已验收 SHA；配置项目外秘密管理下的 `.env`、正式 origin、现有共享网络和唯一别名。源代码 checkout 必须允许快进到所选 SHA，不在更新的 main 上强制 reset 到旧版。
4. 正式域名/素材构建后复验 SEO/HTTP/浏览器与必要性能/安全检查，选定新的唯一发布标签。保留旧镜像和 `.env`、`.deploy`、Git SHA、相关 NPM/DNS 原配置的项目外备份；首发没有旧本站版本时，明确失败撤销路径。
5. 明确授权生产变更后才使用 `compose.proxy.yaml` 和 `release.sh deploy <完整已审SHA>`；已有本站版本用 `release.sh update`。确认应用 healthy、权限限制和**无宿主映射**，不修改其他容器/网络。
6. 仅为本站配置 NPM `http://<唯一别名>:8080`、匹配的源站证书与域名路由；授权范围内准备 Cloudflare 记录、Full (strict)、收敛到唯一 HTTPS origin 的跳转。单独落实已审核的源站防绕过措施。
7. 检查经 Cloudflare 的公网 HTTPS、证书、HTTP/别名跳转、三页及 404/资源、SEO/sitemap/robots/分享图、缓存/日志、双主题/移动端，以及直接源站 Host/SNI 与应用端口的拒绝结果；复查其他站点无回归。
8. 任一关键检查失败即停止，已有版本用保留镜像 `rollback.sh <旧标签>` 恢复；首次上线撤销仅本站新建容器/路由/记录并依备份还原。应用回滚不代替 NPM/DNS/证书单独恢复。记录真实版本与结果后交付，不自动清理旧镜像。

## 9. 可能影响现有服务的风险与停止条件

- 同名 Compose 项目、既有目录或共享别名冲突可能替换错误容器或把 NPM 指向其他站；必须先识别，未明确即停止。
- 构建消耗 CPU/内存/磁盘/出口，单副本替换存在短时不可用；资源不足或无法保留旧镜像时延期，不删其他项目腾空间。
- 误用公网绑定、开放应用端口、修改 NPM 全局规则或整机防火墙会改变其他站点暴露面；不执行这些未经审核的变更。
- 同域 DNS/Proxy Host 覆盖、证书不匹配、Flexible/重复跳转、过度 HTML 缓存可能造成错误站点、循环或旧内容；先备份后仅改本站并分层验证。
- 禁止 `docker system prune`、全局镜像清理、`down -v`、重建/接管现有 NPM 或修改无关记录。生产备份里可能含秘密，必须项目外保存且不进入公开证据。

## 10. 交付与停止状态

本轮新增本报告与 `docs/evidence/P5B-preflight-*` 实测证据，更新进度、README、部署计划及发布门槛；未改动应用、原始设计资料、依赖或发布脚本。

目前可进入**资料补齐与另行授权后的目标环境只读巡检**，不具备立即正式部署的完整放行条件。缺少目标服务器选择、正式域名/NPM/Cloudflare信息、内容范围确认、安全风险决定和真实源站防绕过验收。报告交付后停止，不发起 SSH 或生产部署。

官方参考已作公开只读可达性核对（不代表生产配置通过）：[Compose 合并](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)、[NPM 网络](https://nginxproxymanager.com/advanced-config/)、[Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)、[保护源站](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)、[Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)。
