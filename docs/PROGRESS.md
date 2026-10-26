# XiaoWork Homepage V1.0 项目进度

> 最后更新：2026-10-26（Asia/Shanghai）  
> 当前阶段：P5-B 方案改为 1Panel OpenResty；生产目标只读巡检及正式 origin 本机构建验证完成，首次内部部署镜像构建成功但配置权限导致健康失败，已停止本站容器，权限修复已通过 0600 输入隔离回归，待新 SHA 重试。**公网发布未放行**。

## 阶段状态

| 阶段          | 状态                                                     | 交付                                                                                                        |
| ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0～P2        | 需求、工程与首页视觉已验收，原件保留                     | [P0](../XiaoWork_Homepage_P0_Delivery.md)、[P1](deliveries/P1-delivery.md)、[P2](deliveries/P2-delivery.md) |
| P3            | 项目、关于及 SEO 已验收                                  | [P3](deliveries/P3-delivery.md)                                                                             |
| P4            | 交互、响应式、性能和发布机制已验收                       | [P4](deliveries/P4-delivery.md)                                                                             |
| P5-A          | 用户确认基本通过工程验收                                 | [P5-A](deliveries/P5A-delivery.md)                                                                          |
| P5-B 预检     | 本机预检已完成；旧 NPM 拓扑已由用户后续指令替换          | [历史预检](deliveries/P5B-preflight.md)                                                                     |
| P5-B 方案调整 | 目标已确认、只读巡检完成，默认 OpenResty host + 回环上游 | [新方案](deliveries/P5-openresty-plan.md)                                                                   |
| P5-B 内部部署 | 首发权限问题已修复并隔离验证，待新 SHA 重试              | [权限修复](deliveries/P5-permission-fix.md)                                                                 |
| P5-B 公网发布 | 受阻：用户未接受未修复的 high 风险                       | [发布门槛](P5-RELEASE-CHECKLIST.md)                                                                         |

## 本轮已完成

- 用户确认 SSH 别名 `xiaowork-main` 是德国主力 VPS，授权本站独立部署；既有主机校验成功。原始 SSH、主机信息及其他服务清单仅保存在忽略的本机私有记录。
- Debian 12 / x86_64，4 CPU，约 20 GiB 内存；Docker 29.9.1 / Compose 5.6.0，1Panel 服务正常；OpenResty 为 host 网络。3100 端口和本站独立路径/Compose 项目无冲突。已保存 15 个既有容器与 8 份代理配置哈希基线；未修改这些资源。
- 用户将全部网站默认反代调整为 **1Panel OpenResty**。沿用 `compose.yaml`，仅 `127.0.0.1:3100 -> 8080`，不接入 NPM 网络。现有 deploy/update/rollback 与模式记忆兼容，不改已验收应用代码。
- 正式 origin 已确认 `https://xiaoworks.com`，不用 www。用户允许首版保留明确占位内容；Blog/Nav/ERP 的真实截图、栈、状态和网址仍未确认，没有虚构外链。
- 本机以基线 `bc3f11c3fe084fcfe8313a901a972643dafe0fe3` 和正式 origin 重建静态镜像，prepare/generate 实际执行成功；正式 canonical、OG、sitemap、robots、22 资源、缓存/安全头及三页 HTTP 冒烟通过。npm ci 层命中缓存，不冒称本轮无缓存安装。
- 本机实际浏览器：1440 深色首页、390 浅色关于页无横向溢出，分类、搜索、排序、重置、主题刷新、内链和移动菜单通过。范围与截图见 [本机证据](evidence/P5-production-local-browser.json)；不冒称服务器或公网验收。
- 本轮审计仍 **7 high / 0 critical**，同一 node-forge GHSA 链，官方尚未列兼容修复。用户明确暂不接受风险，仅推进内部部署。最终静态 Nginx 不运行 Node，不能因此把依赖标为已修复。
- 公共 DNS 检查：根域 A/AAAA 无回答，本机公网域名不能解析；未修改 Cloudflare、证书、现有站点或域名路由，Full (strict) 的账户实际设置未核验。

## 已验收工程能力保留

Nuxt 4 静态站、配置化内容、深浅主题、URL 搜索/分类/排序与返回恢复、320～1440 响应式、独立封面及失败后备、语义/焦点/减少动效规则保留。P5-A 曾通过四项单测、ESLint/Prettier/TS、生产 build/generate、隔离部署/更新/回滚及失败恢复、30 组浏览器检查。历史 Lighthouse 首页手机 98、桌面100、项目手机99、关于手机98；这些不是本轮正式域名性能结果。原始设计资料未改。

## 下一步与阻塞

1. 提交并推送新方案，用核验后的完整 SHA 部署独立内部预览，设置正式 origin，保留非 root/只读/健康检查/日志轮转。
2. 验证 OpenResty host 内回环可达、SSH 隧道 HTTP/浏览器，以及其他服务基线；不新增公网路由或 DNS。
3. 安全修复或用户明确接受剩余 high 风险后，方可继续本站专属 OpenResty、根域证书、Cloudflare 橙云/Full (strict) 与防源站绕过方案，不能修改整机 80/443 白名单影响其他站点。
4. 真实项目/个人资料和可选简历后补；上线后复测真实素材、公开链路 Lighthouse/INP，OS 镜像 CVE、Safari/Firefox/真实设备和完整读屏仍未覆盖。

## Git 与私有运维记录

- 沿用已授权身份、`main` / `origin/main`；本轮起始 SHA `bc3f11c3fe084fcfe8313a901a972643dafe0fe3` 已与 GitHub 核对一致。不强推、不改写历史。
- 本次代码配置注释、方案文档和本机证据一并提交；当前提交自身 SHA/推送结果以最终回复和远端查询为准。
- `.cache/p5-production-private/` 只作本机私有运维记录，禁止推送。未保存或输出私钥/密码/API Token；不修改无关网站、容器、DNS、证书、SSH或防火墙，不做全局清理。
