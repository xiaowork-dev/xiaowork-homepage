# XiaoWork Homepage 项目进度

> 最后更新：2026-10-28（Asia/Shanghai）
> 当前阶段：**P6-E 部分交付：真实故障、备份恢复和隔离安全验证已完成；后继完整镜像与跨源码升级门槛未完成，正式发布保持关闭。**

最新记录：[P6-E交付](deliveries/P6E-delivery.md)、[真实故障矩阵](P6E-FAULT-TESTS.md)。保留[P6-D](deliveries/P6D-delivery.md)和[P6-E工程基线](deliveries/P6E-safety-foundation.md)作为历史记录，不将其中的待办描述当作最新测试结论。

## 本轮实际交付

继续 `feat/v1.1-admin-p6a`。已实现不可变公开快照、独立离线 Worker、认证预览、全站静态构建、原子 current、独立 HTTP/SQLite 对账及同构建器内容恢复。中文后台调用真实服务。未合并 main，未连接生产，未修改 OpenResty、Cloudflare、V1.0 `.deploy` 或生产数据。

P6-E六角色冻结验收源码：`be5c96857c5a7098a9b8f80931ced47d0efcab89`，schema3。后继修复和文档提交另行记录，不能将旧镜像证据冒称为后继镜像；最终提交及远端状态以Git实测和交付回复为准。

- 冻结基线Linux Go全包99顶层PASS、342条HTTP记录、0失败/跳过，vet通过；后继诊断修复全包10测试包通过、7无测试包、vet退出0，不推断后继条数。[基线Go](evidence/P6E-go-tests.txt)、[后继Go](evidence/P6E-go-post-diagnostics.txt)。前后台最终规范/类型/单测见[源码检查](evidence/P6E-final-source-checks.json)，生产build和generate通过。
- 真实Chromium可信HTTPS：管理24功能组、发布10组通过，覆盖认证/CSRF/改密/409、项目分类媒体资料管理、私有预览、A→B旧标签兼容→刷新B→恢复A保留草稿B、保卷重建及预览子资源401。[管理](evidence/P6E-admin-browser.json)、[发布](evidence/P6E-publishing-browser.json)
- 五宽度×双主题：管理70组、公开30组、发布页10组无页面横向溢出，记录到的hydration/CSP/pageerror为0。Firefox/WebKit另有60公开组通过；WebKit私有CA可信HTTPS未通过，未关闭TLS或冒称Safari完整测试。[多浏览器](evidence/P6E-multibrowser.json)
- SQLite停写+VACUUM INTO、图片/快照/历史/当前版本121文件一致性备份→新空卷恢复→真实HTTPS重新登录、旧Session401、草稿/媒体/三页SEO/历史/预览保持。独立bundle脱离原部署描述符在第三组新卷恢复通过。[备份](evidence/P6E-backup-recovery.json)、[可移植恢复](evidence/P6E-backup-portability.json)
- 独立V1.1同源码/同schema镜像更新、旧镜像回退、真实坏候选失败恢复、schema4拒绝和独占锁通过；没有真正不同功能源码版本升级的证明。[生命周期](evidence/P6E-release-lifecycle.json)
- 十二项真实Nuxt/容器/SQLite故障安全行为通过，真实超时600秒、专属tmpfs ENOSPC，未知状态阻断；恢复权限及服务需要操作者干预，不声称全部自动恢复。[故障](P6E-FAULT-TESTS.md)
- 恢复成功保留旧错误摘要已在后继源码`aa23376bb508dad215e644c808dd2e9461d7170a`修复，真实HTTPS/UDS/SQLite专项两例及全包通过。候选停止失败/恢复记录ENOSPC时锁保留已修复并通过宿主边界专项；备份源只读挂载及全新空卷恢复短回归通过。[诊断](deliveries/P6E-reconciliation-diagnostics.md)、[锁保护](evidence/P6E-release-guard.json)、[只读](evidence/P6E-backup-readonly.json)
- 统一派生/预览/发布/HTTP单文件16MiB，快照媒体256MiB；OS余量警告/准入拒绝、Worker临时磁盘和容器CPU/内存/PID限制。真实25M像素样本上传/软删除无OOM，不冒称全类型压力。[容量样本](evidence/P6E-media-peak.json)
- 六最终冻结镜像0high/critical/medium；移除不使用的安装器及Nginx可选模块；仍保留low/未定级及musl来源冲突。[安全](V1.1-SECURITY-ACCEPTANCE.md)
- Lighthouse首页手机中位95、LCP1.12s/CLS0/TBT195ms，项目91、关于93、首页桌面100；无INP/CrUX与可比P6-D基线。[性能](evidence/P6E-performance-summary.json)
- V1.0日常3210三页/SEO/22资源/健康/404通过；本轮e2e精确项目停止、七卷保留，12个原有容器身份/镜像/启动时间/运行状态保持。[日常](evidence/P6E-v10-daily-smoke.txt)、[隔离清理](evidence/P6E-e2e-cleanup.json)
- 故障专用项目也已精确停止，七卷及崩溃现场保留，其他12个容器仍运行；最终格式与Git文件快照秘密扫描见[格式](evidence/P6E-final-format.json)、[仓库扫描](evidence/P6E-repository-secret-scan.json)。[故障收尾](evidence/P6E-faults-cleanup.json)

## 安全与未完成门槛

默认Worker不启动、发布gate=0，仅显式启用localhost HTTPS独立测试。正式 `https://xiaoworks.com` 管理origin被服务端拒绝开启，不能用本地成功绕过生产批准。

10月27日兼容更新node-forge1.4.0→1.4.1，官方npm gitHead和tag commit相同、integrity与lock一致。10月28日P6E根审计 **7 low / 0 high / 0 critical**，均沿deepmerge4.3.1构建链；官方最新仍4.3.1，未强制降级Nuxt。admin审计0。[审计](evidence/P6E-npm-audit.json)

node-forge旧官方告警仍无first_patched_version，影响范围列为<=1.4.0；记录当前版本及工具结果，不将其等同所有安全问题消除。生产旧镜像未更新，原安全门槛未解除。[来源](evidence/P6E-node-forge-source.json)

Go扫描symbol0/package0/module1，为未导入openpgp的GO-2026-5932，无修复；不宣称模块风险清零。[Go扫描](evidence/P6E-govulncheck.txt)

原故障证据保留基线的旧错误摘要缺陷，后继修复与其真实专项分开记录，不改写历史。跨功能源码升级仍未实测；崩溃残留`current.next.*`使维护备份保守拒绝，需要人工核对修复。无自动物理GC/总配额、真实移动硬件/读屏或WebKit完整HTTPS管理验收；生产拓扑和原风险接受门槛未操作。

后继aa23376实际API候选配合冻结构建器完整复跑真实Nuxt恢复故障通过：同任务第三次核验成功后API错误为空、SQL诊断NULL、原失败审计保留；单API镜像另扫描仍0high/critical/medium、保留openpgp未定级和二进制精度告警。[专项](evidence/P6E-faults-recovery-fails-postfix.json)、[候选审计](evidence/P6E-api-candidate-audit.json)。aa23376已推送并远端核验，最终文档提交另记录。

## 下一步与上线阻塞

1. 完成后继版本完整六角色镜像组装及跨源码更新/回退；未知状态始终阻断。当前API后继候选专项不能代替完整最终发行验收。
2. 完善崩溃临时链接的可审计处理、异地加密备份/RPO/RTO、容量报警和保留政策。内容恢复仍要求相同源码/Worker镜像/schema，不能误当代码或数据库回退。
3. 复查musl来源冲突、deepmerge和未导入openpgp残余风险；确认发布资料范围后独立评审生产门槛。
4. 门槛完成后才申请正式授权，核对OpenResty/Cloudflare/TLS及源站保护、本站上游切换与其他网站回归。当前不连接服务器。

Blog/Nav/ERP真实截图、状态、技术栈、地址与更多个人资料仍待用户补充。合成验收图仅在专用本地卷，明确不是项目截图。

## 阶段与历史索引

| 阶段   | 状态                                             | 交付                                                                                                        |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| P0～P2 | 需求、工程与首页视觉已验收；原件保留             | [P0](../XiaoWork_Homepage_P0_Delivery.md)、[P1](deliveries/P1-delivery.md)、[P2](deliveries/P2-delivery.md) |
| P3、P4 | 项目/关于/SEO、交互/性能已验收                   | [P3](deliveries/P3-delivery.md)、[P4](deliveries/P4-delivery.md)                                            |
| P5-A   | 用户基本通过工程验收                             | [P5-A](deliveries/P5A-delivery.md)                                                                          |
| P5-B   | OpenResty回环内部部署完成，公网未放行            | [生产交付](deliveries/P5-production-delivery.md)                                                            |
| P6-A   | 架构/数据库/API设计与隔离环境已验收              | [P6-A](deliveries/P6A-delivery.md)                                                                          |
| P6-B   | 认证、草稿/媒体API及持久化已验收                 | [P6-B](deliveries/P6B-delivery.md)                                                                          |
| P6-C   | 中文Vue管理UI与真实HTTPS已验收                   | [P6-C](deliveries/P6C-delivery.md)                                                                          |
| P6-D   | 本地正常闭环已通过，故障验收部分完成，生产关闭   | [P6-D](deliveries/P6D-delivery.md)                                                                          |
| P6-E   | 隔离可靠性/备份/安全部分通过，正式门槛未全部完成 | [P6-E](deliveries/P6E-delivery.md)                                                                          |

main基线为 `14f9b1fba6504b1367aad6165a0b72c37e495927`。服务器历史运行实现 `2616ef60e7e9fd7ff6d62d26806bd56673525d52` 仅引用此前P5/P6-A交付，本轮未连接重查。既有德国主机使用1Panel OpenResty host，Homepage仅回环3100，不使用NPM。原公网代理/DNS/证书/Full(strict)/Host-SNI防绕过及用户安全接受门槛继续有效。敏感服务器信息仅私有记录。
