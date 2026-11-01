# XiaoWork Homepage 项目进度

> 最后更新：2026-11-01（Asia/Shanghai）
> 当前阶段：**P6-E 部分完成。bb05六角色已统一构建/扫描；14项真实RO矩阵、7项真实锁故障及单对象修复通过。修复后备份因故障夹具镜像描述符不一致而拒绝，已停止下游并保留现场，不能上线。**

最新记录：[P6-E交付](deliveries/P6E-delivery.md)、[最终发行身份](P6E-FINAL-RELEASE.md)、[真实故障矩阵](P6E-FAULT-TESTS.md)、[跨源码验收](P6E-CROSS-SOURCE-ACCEPTANCE.md)。本页是最新结论；旧基线报告保留作历史，不将旧组证据扩大到最终组。

本轮只处理根atime与外层验收锁。空卷分步对照证明默认Docker create即改变卷根atime，容器尚未启动；只增加volume-nocopy后不变。源挂载nocopy、kernel RO、目录/文件O_NOATIME及完整metadata比较均已实现并实测，无重设atime。[诊断](evidence/P6E-atime-diagnosis-r3.json)、[O_NOATIME补测](evidence/P6E-atime-diagnosis-r4.json)。原9887的475/481条相同、六根atime改变的[原始失败](evidence/P6E-ro-readonly-matrix-r2.json)完整保留。

最终组[真实只读矩阵](evidence/P6E-atime2-readonly-matrix.json)14/14通过：4个稳定/有效WAL/只读目录正例、10个不明WAL/权限/损坏/Schema等反例，全部SHA与完整元数据不变。[真实锁矩阵](evidence/P6E-atime2-real-guards.json)7/7通过，覆盖外层assert、wrapper/维护器强杀、错误挂载/写者、故意metadata变化和marker写前退出；新任务确实拒绝，已知纯检查可显式复核，未知状态拒绝复核。锁和持久marker独立于源卷，不以进程退出自动清除。

新专属故障卷已完成真实单链接修复及双阶段审计，六根Atim、主库和无关文件元数据/SHA保持；publication父目录计划内Nlink/mtime/ctime变化保留。[完整前后清单](evidence/P6E-atime2-repair-metadata-review.json)。随后备份在复制前因故障派生API与正式api-init镜像ID不一致而拒绝，控制器此前宽泛assert.throws不能证明特定current.next拒绝原因。已经停止所有下游恢复/更新/回退，无自动重试apply；新源写者停止、旧公开6路HTTP/SHA保持。独立步骤失败后本轮明确人工补建控制阻塞，不冒称整链自动留锁。[留场](evidence/P6E-atime2-chain-retention.json)。

## 最终运行身份

分支 `feat/v1.1-admin-p6a`，最终候选运行源码 **`bb05f6ad613fdf3507ff8a9c56696da85fa4a678`**，schema3、manifest1。六正式角色从该SHA同一Git archive重建；完整ID/基础镜像/参数/日志见 [最终候选清单](evidence/P6E-atime2-runtime-manifest.json)。没有混用817/9887/8ee角色。此后只修改测试控制器、证据、文档，不冒称运行镜像源码变化。选择该SHA是因为它还补齐“锁已创建、marker未写入”的早期窗口。

新候选精确Linux Go全包/vet退出0、Node锁专项8项通过，六镜像0critical/high/medium，low及未定级保留。[安全复核](evidence/P6E-atime2-security-audit.json)。同源码派生测试角色的正常Nuxt基线和真实切换前退出/Chromium验证通过；**不能扩大为六正式镜像完整运行链或常规浏览器全矩阵**。修复后备份拒绝，下游空卷恢复/跨源码更新与回退/内容恢复/再次备份恢复均 **NOT_RUN**。原始夹具UID、CPU配额、restart日志采集错误及旧组失败均保留。

保留 V1.0 视觉及静态架构，已具备真实中文后台、Go/SQLite草稿和媒体、私有预览、固定离线Nuxt构建、不可变版本和原子切换。未合并main、未连接生产、未改1Panel/OpenResty/Cloudflare/V1.0容器、数据库或`.env/.deploy`。

## 历史817组已通过的证据（不计入9887新候选）

本节运行源码为 `817aa533741bdd5de23f322fa5e5171442cb28a9`，完整身份见 [817机器清单](evidence/P6E-final-runtime-manifest.json)。保留已通过的历史成果，不重复重做；以下“最终组”仅指当时817组。

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

历史817组十二项真实故障及正常基线13/13通过，[汇总](evidence/P6E-final-faults-summary.json)。当前bb05补齐元数据与操作锁专项，但修复后备份链尚未通过。控制服务restart实测exit1拒绝新任务，首份收集器遗漏stderr失败保留；[补充只读复核](evidence/P6E-atime2-control-restart-review.json)不虚构未记录的前后marker哈希。宿主OS/Docker引擎重启、断电未测，Windows Node无法目录fsync；测试和人工干预不能称全部故障自动恢复。

musl来源差异已用官方分支相同补丁SHA512解释：实际3.24.3/r3，无edge混仓，原Scout未定级仍保留。deepmerge4.3.1构建链7low无官方修复；node-forge锁1.4.1与精确官方integrity一致；去符号Go二进制模块精度告警保留，精确Linux source无openpgp导入。残余风险需用户决定，不称工具零高危等于系统零风险。[处置](evidence/P6E-final-risk-disposition.json)

[异地备份运维方案](V1.1-BACKUP-OPERATIONS.md)已准备，尚未实际外发、部署定时任务、完成加密副本恢复演练或接入外部告警。目标/账户/介质、密钥保管人与告警接收人/值守、建议RPO24h/RTO4h及保留策略待用户确认。没有自动物理GC/总配额/跨进程磁盘预留。

最终组Firefox/WebKit完整管理、Safari、真实手机、读屏、完整渗透、断电和物理存储故障未验证。旧公开跨浏览器测试保留作历史，WebKit私有CA HTTPS未通过不豁免。

## 下一步与生产门槛

1. 保留新旧现场和未知锁；先修正故障夹具与正式角色的描述符身份。在全新测试环境完整六正式角色启动并重新验收修复→备份→空卷恢复→更新/回退→内容恢复→再次备份恢复，不能在已阻塞现场改描述符/删锁强行续跑。任何运行代码变化需重新冻结六角色。当前不能申请上线。
2. 本轮起始远端为`94d0309668d7190bc6494dc461f2c09f6d2a64f0`，最终运行源码为上述bb05；文档提交及最终推送/main核对以Git实测及最终回复为准。main保持`14f9b1fba6504b1367aad6165a0b72c37e495927`。历史Git回执不冒称本轮结果。
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
