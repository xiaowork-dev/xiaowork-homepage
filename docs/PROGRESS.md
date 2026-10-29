# XiaoWork Homepage 项目进度

> 最后更新：2026-10-29（Asia/Shanghai）
> 当前阶段：**P6-E 部分完成。统一817发行组正常链、十二故障、跨源码升级回退和备份恢复通过；残留链接真实只读SQLite修复门槛失败，正式发布保持关闭。**

最新记录：[P6-E交付](deliveries/P6E-delivery.md)、[最终发行身份](P6E-FINAL-RELEASE.md)、[真实故障矩阵](P6E-FAULT-TESTS.md)、[跨源码验收](P6E-CROSS-SOURCE-ACCEPTANCE.md)。本页是最新结论；旧基线报告保留作历史，不将旧组证据扩大到最终组。

本轮仅收尾 SQLite 严格只读阻塞。已实施原文件只读取证与完整 WAL 私有副本方案、错误分类、所有源卷写入容器检查和失败留锁；新源码冻结与统一六角色真实 RO 卷验收进行中。原 817 故障卷、操作现场和失败证据继续保留。正式发布门槛未据此提前解除。

## 最终运行身份

分支 `feat/v1.1-admin-p6a`，最终运行源码 **`817aa533741bdd5de23f322fa5e5171442cb28a9`**，schema3、manifest1。API、Worker、gateway、legacy frontend、publication-static、maintenance全部来自同一Git archive，完整ID/参数/日志见 [机器清单](evidence/P6E-final-runtime-manifest.json)。后继提交只含测试/运维控制器、证据与文档，不冒称镜像源码。未混用旧be5c组和aa23376单API。

保留 V1.0 视觉及静态架构，已具备真实中文后台、Go/SQLite草稿和媒体、私有预览、固定离线Nuxt构建、不可变版本和原子切换。未合并main、未连接生产、未改1Panel/OpenResty/Cloudflare/V1.0容器、数据库或`.env/.deploy`。

## 最终组已取得的新证据

- Linux精确导出源码Go全包与vet退出0；ESLint、Nuxt类型、后台34项、Node13项通过。[质量检查](evidence/P6E-final-group-quality-exits.json)
- 可信HTTPS Chromium管理24组、发布10组通过。覆盖安全登录/CSRF/改密/会话失效、CRUD/图片/409/网络错误，预览及所有资源鉴权、A→B旧标签→刷新B→恢复A保留草稿B、保卷重建，无记录到的hydration/CSP/pageerror。[管理](evidence/P6E-final-admin-browser.json)、[发布](evidence/P6E-final-publishing-browser.json)
- 320/390/768/1024/1440px与深浅主题真实浏览器覆盖；公开交互5组、匿名暴露面26项通过。[交互](evidence/P6E-final-public-interactions.json)、[HTTP](evidence/P6E-final-security-http.json)
- 最终组停写+SQLite VACUUM INTO，121文件一致备份→独立空卷仅凭bundle恢复启动，9组/62HTTP请求通过。旧Session401、原密码可登录，草稿、私图SHA、历史、预览和公开HTML/SEO保持。[备份恢复](evidence/P6E-final-backup-recovery.json)
- 真正be5c完整旧组↔817完整新组12项通过，含4种坏候选、schema拒绝、未知停写状态人工恢复和锁保护；新内容跨代码回退4项通过。跨源码内容恢复安全拒绝，代码回退不恢复旧数据库。[报告](P6E-CROSS-SOURCE-ACCEPTANCE.md)
- 新增current.next单对象离线修复、终态/intent/receipt/history/SHA核对及持久双阶段审计；Linux专项通过，但真实只读卷计划失败，尚未执行删除及修复后备份/恢复/更新。[流程](V1.1-CURRENT-REPAIR.md)、[根因](evidence/P6E-final-current-readonly-probe.json)
- 六最终镜像Scout0critical/high/medium，保留low/未定级；运行边界检查通过，Worker无网络/DB/凭据/DockerSocket，非root/只读根/资源限制，公开34文件秘密扫描0已知发现。[安全](V1.1-SECURITY-ACCEPTANCE.md)
- Lighthouse最终组六次：首页手机中位93、LCP1111.716ms、CLS0、TBT321.22435ms；项目92、关于99、桌面100；无真实用户INP或可比前后基线。[性能](evidence/P6E-final-performance-summary.json)
- 生产预检仅本地渲染断言通过，正式origin、gate0、Worker默认关闭、仅示例回环端口，未创建生产容器或连接服务器。[方案验证](evidence/P6E-final-production-preflight.json)
- 正常E2E专用栈停止并保留七卷/镜像；新故障专用栈停止并保留六卷/残留现场，334条目SHA保持。原有34个容器身份、镜像、运行状态、启动时间不变。[原容器](evidence/P6E-final-other-containers-after.json)、[故障留场](evidence/P6E-final-current-repair-retention.json)
- 既有V1.0本机3210重跑5路径HTTP/SEO、robots/sitemap、22资源、健康/404通过，仅只读访问。[日常回归](evidence/P6E-final-v10-daily-smoke.txt)

## 风险与未完成边界

十二项最终组真实故障及正常基线13/13通过，有新独立证据，不能引用旧基线代替。[汇总](evidence/P6E-final-faults-summary.json)。残留修复另行失败：相同modernc依赖在无WAL/SHM的WAL模式主库全只读挂载下查询失败，错误被误映射为schema未初始化；独立副本复现，原卷SHA不变、未删除链接。需要安全只读视图/准确诊断与真实RO挂载回归后重新冻结验收，不能使用旧PASS掩盖此阻塞。测试控制器重启、修复权限等是操作者干预，不称所有故障自动恢复。

musl来源差异已用官方分支相同补丁SHA512解释：实际3.24.3/r3，无edge混仓，原Scout未定级仍保留。deepmerge4.3.1构建链7low无官方修复；node-forge锁1.4.1与精确官方integrity一致；去符号Go二进制模块精度告警保留，精确Linux source无openpgp导入。残余风险需用户决定，不称工具零高危等于系统零风险。[处置](evidence/P6E-final-risk-disposition.json)

[异地备份运维方案](V1.1-BACKUP-OPERATIONS.md)已准备，尚未实际外发、部署定时任务、完成加密副本恢复演练或接入外部告警。目标/账户/介质、密钥保管人与告警接收人/值守、建议RPO24h/RTO4h及保留策略待用户确认。没有自动物理GC/总配额/跨进程磁盘预留。

最终组Firefox/WebKit完整管理、Safari、真实手机、读屏、完整渗透、断电和物理存储故障未验证。旧公开跨浏览器测试保留作历史，WebKit私有CA HTTPS未通过不豁免。

## 下一步与生产门槛

1. 修复停止写入后的SQLite只读视图与错误诊断，完整考虑WAL，不盲目immutable或静默checkpoint；重新冻结完整组，完成实际残留单链接修复→备份→空卷恢复→更新。当前不能申请上线。
2. 工程/证据提交`f0aa61f04529d43407205061f3ed3b62f39b6da1`已正常推送并核对远端、main不变；回执补记文档的最终提交另以Git实测及回复为准。[回执](evidence/P6E-final-git-receipt.json)
3. 用户确认内容范围、残余依赖风险、异地备份/密钥/告警责任/RPO/RTO和维护窗口后，独立评审生产发布策略并申请上线授权。
4. 当前实现明确拒绝正式origin开启localhost发布测试gate；生产发布授权尚需受审实现与测试，不能借部署脚本绕过。真实OpenResty/Cloudflare/TLS/源站保护、服务器端口和其他网站基线，只能在另行授权后只读预检及最小范围部署。

Blog/Nav/ERP真实截图、技术栈、状态、URL和更多个人资料仍待补充；用户此前允许明确占位，不代表授权将合成验收图作为真实资料。ERP截图必须确认无敏感信息。

## 阶段与历史索引

| 阶段   | 状态                                                | 交付                                                                                                        |
| ------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0～P2 | 需求、工程与首页视觉已验收                          | [P0](../XiaoWork_Homepage_P0_Delivery.md)、[P1](deliveries/P1-delivery.md)、[P2](deliveries/P2-delivery.md) |
| P3、P4 | 项目/关于/SEO、交互/性能已验收                      | [P3](deliveries/P3-delivery.md)、[P4](deliveries/P4-delivery.md)                                            |
| P5-A   | 用户基本通过工程验收                                | [P5-A](deliveries/P5A-delivery.md)                                                                          |
| P5-B   | 历史OpenResty回环内部部署记录，公网放行门槛独立保留 | [生产交付](deliveries/P5-production-delivery.md)                                                            |
| P6-A   | 架构、数据库、API设计与隔离环境已验收               | [P6-A](deliveries/P6A-delivery.md)                                                                          |
| P6-B   | 认证、草稿/媒体API及持久化已验收                    | [P6-B](deliveries/P6B-delivery.md)                                                                          |
| P6-C   | 中文Vue管理UI与真实HTTPS已验收                      | [P6-C](deliveries/P6C-delivery.md)                                                                          |
| P6-D   | 本地正常闭环通过，生产关闭                          | [P6-D](deliveries/P6D-delivery.md)                                                                          |
| P6-E   | 最终闭环收尾，正式上线未授权且gate关闭              | [P6-E](deliveries/P6E-delivery.md)                                                                          |

main基线 `14f9b1fba6504b1367aad6165a0b72c37e495927`。服务器历史运行实现 `2616ef60e7e9fd7ff6d62d26806bd56673525d52`仅引用此前交付，本轮未连接重查。此前配置德国主机使用1Panel OpenResty host、Homepage回环3100，不使用NPM；不能据此推断当前生产已验证或已更新。
