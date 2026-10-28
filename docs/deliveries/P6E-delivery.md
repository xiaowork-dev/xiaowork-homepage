# P6-E 交付：最终发行组、可靠性与上线准备

更新：2026-10-28，Asia/Shanghai。开发分支 `feat/v1.1-admin-p6a`。

**状态：部分完成。最终组正常链、十二故障、跨源码与完整备份恢复通过；真实残留链接修复被只读 SQLite 问题阻塞，不具备正式上线条件。** 本轮没有连接德国服务器、合并 main，或修改 Cloudflare、DNS、TLS、1Panel OpenResty、V1.0 容器、数据卷及 `.env/.deploy`。本文件更新既有阶段交付，不重新创建一套阶段记录。

## 1. 最终发行身份

最终运行源码选为 **`817aa533741bdd5de23f322fa5e5171442cb28a9`**，SQLite schema **3**，内容 manifest **1**。选择理由：该提交同时包含 aa23376 的成功对账诊断修复、受审的单对象 `current.next.*` 离线修复、停写状态业务摘要和逐资源 HTTP 校验。六角色来自同一个 Git archive，归档 SHA256 `62368afa2f44279596524a51d29bf59ff850ee20ba9977b2ae16b0cfbf55d7bf`，没有混用 be5c 冻结组与 aa23376 单 API。

六个完整镜像 ID、构建参数、平台、基础镜像、构建命令与首次失败见 [发行组清单](../P6E-FINAL-RELEASE.md) 和 [机器 manifest](../evidence/P6E-final-runtime-manifest.json)。`VCS_REF` 为完整源码 SHA，前台构建 origin 为 `https://xiaoworks.com`，实际任务 builder identity 为 Worker 的精确镜像 ID。后续提交只补充测试控制器、证据和文档，不将后续文档提交冒称运行镜像源码。

正式运行镜像没有故障注入入口。测试覆盖层单独编译固定 `p6e_fault && linux` checkpoint，身份见 [测试镜像清单](../evidence/P6E-final-test-fixtures.json)，不列入正式六角色描述符。

## 2. 本轮完成与修改范围

- 实现只读检查、单对象修复和持久化双阶段审计，Linux专项通过；实际只读卷验收失败，尚不能作为可上线修复能力。契约要求终态任务、intent、receipt、历史引用及全部文件 SHA 完整一致，未知状态继续阻断。
- 更新生命周期先后停写，用新旧维护器检查 schema、完整数据和17张业务/schema/历史表的逻辑摘要。候选写状态不确定时保留恢复意图与操作锁，不恢复旧时点数据库覆盖新写入。
- HTTP 探针验证三页、SEO、后台真实 JS/CSS、可信 HTTPS API 和安全 Cookie；对当前 manifest 的全部公开资源逐项核对大小与 SHA256，不能仅以图片200判断成功。
- 重新构建并扫描统一的六角色组，重新执行管理、预览、发布、历史恢复、持久化、浏览器、性能与关键故障测试。
- 补充异地加密副本、离线签名与密钥保管、容量/备份告警、保留政策和 RPO/RTO 的可执行运维方案；没有虚构已购外部服务或已完成异地演练。

运行改动集中在 `backend/internal/maintenance/{current_repair,content_digest}*.go`、`scripts/v11-current-repair.mjs`、`scripts/v11-release.mjs`、`scripts/v11-release-probe.mjs`；后继改动为 `scripts/p6e-final-*.mjs`、跨源码测试器、文档与证据。未重新设计 V1.0 前台。完整改动以 Git diff 和 [本轮文件索引](../evidence/P6E-final-changed-files.json) 为准。

## 3. 最终组实际检查

| 检查                                           | 实际结果与证据                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 六角色构建与启动                               | 全部从817源码构建；维护器是受限一次性工具，其余五角色真实健康运行。[构建身份](../evidence/P6E-final-runtime-manifest.json)                                                                                                                      |
| Linux Go 全包、vet                             | 从精确导出源码实际执行，退出0。[原始日志](../evidence/P6E-final-group-go-tests.txt)                                                                                                                                                             |
| 根 ESLint、Nuxt 类型、后台类型/单测、Node 测试 | 退出0，后台34项、Node13项。[退出码](../evidence/P6E-final-group-quality-exits.json)；最终格式与后继控制器检查另留记录                                                                                                                           |
| 管理后台 Chromium                              | 24功能组通过，真实登录/错误密码/限速/CSRF/改密/会话撤销、项目/分类/图片/资料/设置/409冲突/网络错误/刷新持久化。[管理证据](../evidence/P6E-final-admin-browser.json)                                                                             |
| 发布 Chromium                                  | 10组通过：私有预览及子资源认证、A→B真实Nuxt发布、旧A标签导航资源保持、刷新B、恢复A保留草稿B、保卷重建、退出/过期预览401，无记录到的hydration/CSP/pageerror。[发布证据](../evidence/P6E-final-publishing-browser.json)                           |
| 公开交互                                       | 5组通过：搜索/query刷新、空结果恢复与焦点、分类、升降序和浏览器返回、320px导航与主题保持，真实资源无失败。[公开交互](../evidence/P6E-final-public-interactions.json)                                                                            |
| 响应式与主题                                   | 管理/发布浏览器覆盖320、390、768、1024、1440px及深浅主题，详细计数见各JSON，未推断真实移动设备结果                                                                                                                                              |
| HTTP 暴露面                                    | 26项通过，管理鉴权与no-store/noindex、私有/数据库/路径访问拒绝。[HTTP证据](../evidence/P6E-final-security-http.json)                                                                                                                            |
| 容器边界                                       | 精确ID、非root、只读根、drop ALL、no-new-privileges与健康；API/Worker有CPU/内存/PID限额，三个Nginx角色未配置这些限额；仅网关回环端口；Worker无网络、DB、秘密、DockerSocket，UDS0700/0600。[实查](../evidence/P6E-final-runtime-boundaries.json) |
| 生产方案                                       | 仅本地渲染断言，固定正式origin、gate0、Worker默认关闭、示例回环端口；未启动生产或连接服务器。[预检](../evidence/P6E-final-production-preflight.json)                                                                                            |

初次 Go 依赖代理证书域名不匹配，保留日志，改用已使用过的受信代理并保持 TLS/go.sum；测试覆盖层 FROM 引用、浏览器测试选择器与环境变量等夹具失败单独留档，不计产品通过。未放宽认证或关闭 TLS 来通过测试。

既有本机V1.0日常栈3210也重新运行HTTP冒烟：5路径页面/SEO、robots/sitemap、22本地资源、健康与404通过；这是只读本机回归，未重启其容器或访问生产。[本轮原始日志](../evidence/P6E-final-v10-daily-smoke.txt)。

最终后继控制器ESLint与13项Node测试退出0，Git文件清单的Prettier检查通过，见`P6E-final-closure-eslint.txt`、`P6E-final-closure-node-tests.txt`、[格式记录](../evidence/P6E-final-closure-format.json)。首次格式检查发现一个测试控制器未格式化，原失败保存为`P6E-final-closure-format-first.json`，仅格式化该控制器后重查。机器证据不经格式化，Git对`P6E-final-*`关闭文本换行转换，以保留SHA账本对应的原字节。

首次索引whitespace检查将机器JSON的原始CRLF和上游musl补丁原有空格/Tab当作样式问题，原输出保留`P6E-final-index-whitespace-first.txt`。仅这些机器证据路径设置保留CR和原补丁缩进，源码/文档规则不放宽，不改动上游补丁或日志来伪造哈希一致。

## 4. 真实故障与残留链接

最终组故障矩阵见 [P6E-FAULT-TESTS.md](../P6E-FAULT-TESTS.md)，只引用 `P6E-final-faults-*.json` 作为817组证据。测试注入镜像派生于最终组，正常发布/备份/跨源码使用未经注入的正式镜像。历史 be5c 与 aa23376 专项保留，不能代替本轮。

最终故障矩阵 **13/13通过**（正常基线加十二故障），[新组汇总](../evidence/P6E-final-faults-summary.json)。真实超时任务600000ms、控制器602802ms；隔离tmpfs实际ENOSPC，余量804552704→0，写入804536320B。两次真实EACCES恢复失败阻断新任务，人工修复后同任务成功，API错误为空、SQL两诊断NULL、两条失败审计保留。没有把 RUNNING、人工核对或失败任务写为发布成功。

受审修复方法见 [current.next 离线流程](../V1.1-CURRENT-REPAIR.md)。真实 Nuxt 崩溃现场的计划阶段 **失败并安全停止**：[实际请求](../evidence/P6E-final-current-repair.json)、[根因复现](../evidence/P6E-final-current-readonly-probe.json)。正确原卷中有438272B有效SQLite主文件、无WAL/SHM，头部为WAL模式；同一modernc依赖在全只读副本的 `mode=ro` SELECT报 `unable to open database file (14)`，维护器将其映射成schema未初始化。仅在独立副本上使用immutable或可写目录能读出3条迁移；原库从未RW挂载、checkpoint或修复，SHA/元数据不变。

因此**未删除任何候选链接，未通过修复后备份/恢复/更新链**，不能用普通备份9组或Linux专项替代。后继需要设计安全的停写SQLite只读视图（必须正确考虑WAL，不能盲目immutable忽略已提交WAL）及准确错误诊断，增加真实RO挂载集成测试，重新冻结并验收完整发行组。保留现场和生产关闭，不用未知源码维护镜像混入817组。禁止批量删除、跳过 SHA 或删除未知操作锁。

## 5. 最终组完整备份恢复

[最终组备份恢复](../evidence/P6E-final-backup-recovery.json) **9组、62次HTTP请求通过**：独立TTY账户、可信HTTPS→真实A/B发布→恢复A保留草稿B→私有预览→停写→SQLite `VACUUM INTO`→121文件一致备份→全新空卷恢复启动。原宿主 current.json 暂不可用时仅用独立bundle启动，之后原描述符归还。

恢复后 schema3、revision5、3项目、1图片、3快照、4任务、3历史版本及当前A保持；旧Session401，原密码可重新登录，私图SHA、六公开HTML/SEO路径保持。篡改runtime描述符及覆盖非空恢复均拒绝。总流程209.052秒含测试构建、发布等，不能当生产RTO。源/恢复专用项目已精确停止且保留卷和镜像。

这是本机一致性恢复，**不是已实施的异地灾备**。备份含账户必要敏感数据，不能提交Git；使用配套维护镜像及完整bundle，不直接复制运行中的SQLite主文件。见 [备份恢复](../V1.1-BACKUP-RESTORE.md)、[备份运维方案](../V1.1-BACKUP-OPERATIONS.md)。

## 6. 跨源码更新、回退与锁恢复

[跨源码报告](../P6E-CROSS-SOURCE-ACCEPTANCE.md) 主矩阵 **12项通过**，补充新内容专项 **4项通过**。旧组为 `be5c96857c5a7098a9b8f80931ced47d0efcab89`，新组为817完整六角色，真实业务源码不同。

覆盖旧→新、代码回退、候选启动失败、公开503、后台JS404、图片200错误字节、schema4更新/回退拒绝、已有锁拒绝、候选停写不确定时保守锁定、人工核验恢复旧服务及再次升级。严格新内容场景由新Worker实际发布，旧代码继续服务该自包含版本并核验HTTP；直接跨源码内容恢复终态 `ROLLBACK_TARGET_INVALID`，当前和草稿不变，再升级成功。

代码回退只换镜像且接受当前数据；内容恢复只换兼容静态版本；灾难恢复从一致备份还原新空卷并撤销旧Session。跨Schema自动迁移/降级未实现，必须先拒绝。停写不确定时公开坏候选曾不可用，操作者恢复后才恢复访问；不声称自动零停机。旧备份必须保留配套旧maintenance，不能用新字段要求改写旧备份骗过校验。

## 7. 性能与未覆盖范围

最终组六次 Lighthouse 实测见 [性能汇总](../evidence/P6E-final-performance-summary.json)：首页手机87/99/93，中位 **93**；LCP中位 **1111.716ms**、CLS **0**、TBT中位 **321.22435ms**。项目手机92、关于手机99、首页桌面100；六次 Accessibility/Best Practices/SEO均100。保留CPU校准、主线程、资源链和图片审计建议。

这些是本机Docker/模拟节流/合成测试内容的导航实验室数据；无可比前后基线，没有真实用户INP/CrUX，TBT不等同INP。最终组未重新执行Firefox/WebKit完整管理，历史公开补测不能扩大为817通过；Safari、真实手机、读屏、完整渗透、主机断电/物理磁盘故障均未验收。历史WebKit可信HTTPS失败仍如实保留。

## 8. 依赖风险与运维决策

[最终审计](../evidence/P6E-final-security-audit.json)、[风险处置](../evidence/P6E-final-risk-disposition.json)、[安全验收](../V1.1-SECURITY-ACCEPTANCE.md)记录全部精确镜像和官方来源，复核日期2026-10-28。

- 六镜像Scout均0 critical/high/medium，仍保留Worker deepmerge low、四个Alpine角色musl未定级、API/maintenance Go模块未定级；没有抑制原告警。
- musl实际Alpine3.24.3、1.2.6-r3且无edge混仓；官方3.24与edge的同一安全补丁SHA512证实r3/r6为分支修复号差异，记录来源而不改写扫描器结果。
- deepmerge4.3.1仍无官方兼容修复；根npm7low/admin0。只使用受控输入、固定离线构建、Worker无网络/凭据/数据库且有资源限制，仍需确认残余构建链风险。
- 保留node-forge1.4.1兼容修复，与精确官方版本integrity一致；latest1.4.2为Buffer兼容补丁，未冒称尚未应用的安全修复。
- 精确去符号二进制govuln退出3/0/3，保留模块精度告警；91个backend文件与冻结树逐SHA核对后Linux source扫描exit0、无openpgp导入，仅Argon2id/blake2b。GO-2026-5932模块告警尚无修复，不称模块风险清零。
- 当前公开34文件460122B秘密扫描0已知模式发现、前后SHA一致；[最终仓库快照扫描](../evidence/P6E-final-repository-secret-scan.json)原始exit1、7条generic-api-key均逐行确认为同一本地公开镜像tag误报，保留原始告警和核对，不禁用规则、不标为工具零告警。模式扫描不能证明未知秘密不存在；私有忽略目录、扫描器自身结果及命令日志不进入其输入。

异地age加密副本+独立离线签名、密钥轮换/保管、校验恢复演练、保留与容量告警方案已准备。建议RPO24h/RTO4h尚未获用户接受，未计作达到目标；外部目标/账户/介质、密钥保管人、值守与告警接收渠道均待确认，未安装外部调度或发送通知。实际本地监控是后台容量警告与CLI检查，不是已接入外部告警系统。

## 9. 生产门槛与下一步

当前首要工程阻塞是上述SQLite只读修复流程。817是本轮实际构建与检验的候选发行身份，**不是全部门槛通过的可生产发布版本**；本轮交付可验证的安全部分，不申请上线。

[现场留场](../evidence/P6E-final-current-repair-retention.json)确认334文件/链接条目前后相同、current/候选未变、六个HTTP/SEO路径停止前200且SHA一致，仅停止新故障项目并保留六卷；[正常E2E收尾](../evidence/P6E-final-e2e-retention.json)保留七卷与六镜像；[其他容器核对](../evidence/P6E-final-other-containers-after.json)确认34个原有容器ID/镜像/运行状态/启动时间均未改变。没有全局Docker清理。

工程测试完成不等于具备直接上线条件。当前正式origin开启本地gate仍被拒绝；需要独立审查并实现生产发布授权策略，不能用localhost测试开关绕过。生产只做方案渲染，未验证真实OpenResty/Cloudflare/TLS、源站防绕过、服务器资源、端口及其他站点。

还需用户确认：首版资料/明确占位范围与ERP截图脱敏、构建链/模块残余风险处置、异地加密目标及密钥保管、告警接收人与责任人、RPO/RTO/保留策略和维护窗口。Blog/Nav/ERP真实截图、技术栈、状态、URL及更多个人资料仍待补充；隔离合成图不会作为真实项目内容发布。

全部工程门槛终结后才提出独立上线申请；本轮不执行申请后的生产操作。核对清单见 [正式发布检查](../V1.1-PRODUCTION-CHECKLIST.md)，拓扑见 [生产方案](../V1.1-PRODUCTION-PLAN.md)。

## 10. Git 与历史证据

本轮起始远端功能分支为 `7b17165111faeaa14b93b5b1f0f0e492868e27c8`。main基线 `14f9b1fba6504b1367aad6165a0b72c37e495927`。最终运行源码817的六镜像已独立冻结；本次文档/测试提交SHA、推送和远端main复核以最终Git结果及回复为准，不在文件中循环记录自身尚未生成的SHA。

工程与完整证据提交 **`f0aa61f04529d43407205061f3ed3b62f39b6da1`** 已正常推送，`git ls-remote`确认功能分支与该SHA一致，main仍为上述基线，工作区当时干净。[实际Git回执](../evidence/P6E-final-git-receipt.json)。本段随后仅补记已发生的事实，后补文档提交SHA与最终推送核对在最终回复中报告，不改变817运行组身份或解除其修复阻塞。

历史 be5c 十二故障、aa23376 单API修复、旧格式检查、旧性能和旧同源码生命周期证据继续保留在Git及原文件中；它们只解释演进，不用来替代最终组六角色的新证据。[诊断专项](P6E-reconciliation-diagnostics.md)、[P6-E工程基线](P6E-safety-foundation.md)、[历史故障矩阵](../P6E-FAULT-TESTS.md)。
