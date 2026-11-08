# XiaoWork Homepage 项目进度

## 最新：2026-11-08 Nuxt 4.6.4 安全升级

`9e3d4db` 把 `nuxt` 升级到 4.6.4（同时带入 nitropack 2.13.6），修复 4 个 Nuxt 公告，包括 GHSA-9v7c-q64q-vv33。生成产物内容与升级前一致；在主服务器隔离环境重建六角色后，Worker 真实发布通过。随后按用户选择，用限定范围的 overrides 把 minimatch 升到 11.0.5、glob 升到 14.0.4，并在范围内把 eslint-plugin-import-x 升到 4.18.0（`b1080eb`）。根目录和后台都已没有 moderate 及以上公告，只剩没有修复版本的 deepmerge（low）；生成的 JS/CSS 字节与覆盖前一致，Worker 真实发布通过。见[本次交付](deliveries/20261108-v11-npm-dependency-upgrade.md)。

## 最新：2026-11-08 生产发布 gate 实现并通过生产拓扑隔离验收

按推荐决策 D1–D6 实现了运维授权型生产发布 gate：授权记录只能由维护镜像写入只读控制卷，绑定已验收的源码 SHA 和 Worker 镜像，默认有效期 7 天，可随时撤销；生产环境要求先预览后发布，每小时最多 6 个发布或恢复任务。运行源码为 `b3550b2d30c79b8a08e6001b2b972dd6b60ff3b4`，宿主工具为 `161d2ceae5e6e1fff02b8477f30f3d0d8bb0742c`。

Linux 上完整 Go 测试通过；生产拓扑端到端验收 27/27 通过，覆盖未授权、无备份拒绝、先预览、A→B→A、频率上限、撤销、重新授权和更新后自动关闭。正式项目尚未授权，正式上线条件仍不满足。见[本次交付](deliveries/20261108-v11-production-publish-gate.md)。

## 最新：2026-11-08 生产网关真实客户端地址（B6）修复，生产拓扑首次实测通过

`2859005` 让生产拓扑的 gateway 只信任来自本项目固定 edge 网桥的 `X-Real-IP`，恢复每位访客各自的登录限速桶。实测中发现生产拓扑首次部署时密钥检查挂载缺少 nocopy，由 `98be318` 修复。两项都只改宿主工具和网关配置，运行镜像仍为 825db64 组。

在主服务器隔离环境首次部署 `openresty` 拓扑：主机侧 15/15 通过，内部网络伪造测试通过；其他业务均与基线一致。见[本次交付](deliveries/20261108-v11-gateway-real-ip-fix.md)。正式上线条件仍不满足。

## 最新：2026-11-08 原生 Linux 备份恢复链修复并通过隔离验收

在主服务器的原生 Linux 独立测试环境中定位并修复了两个缺陷：

1. 维护容器（UID 10001）无法写入 root 拥有的 0700 备份父目录，恢复到新卷时同样因属主问题失败。修复提交 `825db64abadbaf927e426e8445e6b848efd1a2cb`，六角色已重建。
2. 独立 CLI 的 guard 没有登记锁的归属，被自己的锁拒绝。修复提交 `00c2a2d068c9f5cd765618cb31cf6c4ab1a040c5`，只改宿主工具，镜像不变。

在全新独立项目中依次通过：一致性备份 → 空卷恢复（13/13 数据一致）→ 跨源码更新（13/13）→ 代码回退（13/13）。V1.0、OpenResty、其他项目、发布 gate、main 均未改动；失败现场与锁保留。正式上线条件仍不满足，见[本次交付](deliveries/20261108-v11-backup-restore-fix.md)。

## 最新：2026-11-08 独立 Linux 安装因 WSL 服务崩溃受阻

用户已授权改用 `C:\WSL\XiaoWork-P6E` 并释放内存。D 盘约 52.8 GiB 不足规划预算；C 盘约 365.9 GiB、路径无冲突，释放后可用物理内存三次均约 5.03 GiB，资源预检通过。WSL 选项/Ubuntu-24.04 和 3228/3461 端口检查已完成。

唯一一次安装于北京时间 14:40:16～14:40:48 返回 `RPC_S_CALL_FAILED`，原始退出码 `4294967295`；Event 1000/1001 确认 `wslservice.exe 3.0.3.0` 在安装期间崩溃，异常 `c00000fd`，具体触发原因未知。取证时 Ubuntu 未注册、C 盘目标未创建，仅有停止的 `docker-desktop`，context 仍为 `desktop-linux`。没有重试或主动重启/升级/重置全局 WSL；内部下载缓存可能存在，未查删。Desktop 本轮初始即停止且 `docker info` 超时，不能引用历史容器哈希冒称今天重验。

**未完成**：原生 Docker/Compose 安装、Linux 原生测试目录及网络、独立 Daemon/Socket/挂载身份和最小挂载验证。环境不具备完整 P6-E 前置条件。本轮仅文档与证据变化，共同屏障运行源码仍为 `c7edb2f7d23cdecaf493370d8d62446907c67e67`；未构建六角色、未执行整链、未触及生产或 gate。

见[本次环境交付](deliveries/20261108-144048-linux-install-attempt.md)、[原始失败与事件证据](evidence/P6E-linux-install-attempt-20261108.json)、[更新后的环境方案](V1.1-LINUX-ACCEPTANCE-ENV.md)。下一步先受控排查宿主 WSL 崩溃；原安装和 C 盘授权继续有效。涉及全局服务或 WSL 变更时须先给出具体影响并单独获得授权，当前不自动重试安装，不申请上线。

## 历史：2026-11-02 独立 Linux 安装已获授权，资源预检受阻

已完成安装前只读预检：`D:\WSL\XiaoWork-P6E` 不存在，D 盘剩余约 213.8 GiB，WSL3.0.3 支持所需选项，Ubuntu-24.04 在线可用，3228/3461 未发现监听。但初查可用物理内存约 454 MiB，Windows 内核三次复核仅 1.22～1.49 GiB，占用率 90%～92%，低于准备方案的 4 GiB 验收预算；按用户要求在安装前停止，未修改系统环境。

**未执行**：Ubuntu/原生 Docker Engine/Compose 安装、Linux 原生目录和网络、新 Daemon/Socket/挂载身份及最小 Docker 验证。Desktop 默认 context、Daemon ID、既有 140 个容器的 ID/镜像/状态基线保持。本次只是文档与证据变更，共同屏障运行源码仍为 `c7edb2f7d23cdecaf493370d8d62446907c67e67`；新六角色和完整 P6-E 链均未启动。

见[环境交付](deliveries/20261102-152650-linux-environment-preflight.md)、[机器证据](evidence/P6E-linux-install-preflight-20261102.json)、[准备方案](V1.1-LINUX-ACCEPTANCE-ENV.md)。下一步由用户释放闲置应用内存后复测，满足资源预算且有宿主余量时在已授权范围内继续安装，不重复申请相同授权。当前环境前置条件和正式上线条件均未满足；不停止受保护业务或修改全局 WSL 设置来绕过门槛。

## 2026-11-01 共同维护屏障专项完成，P6-E 整链仍未完成

API、Worker 和受信宿主已接入独立 RO/RW 控制卷及真实跨进程共享/独占锁，消除 marker 检查与任务创建/领取/激活之间的准入窗口。已准入任务排空后才允许离线数据检查；未知状态失败关闭，不依赖父进程活着。正常成功才清保护。

已通过：实际可信 HTTPS、SQLite 事务等待、真实 Nuxt 构建/激活前排空、API/Worker 进程重启、控制目录失效、内核 RO 卷；宿主 SIGKILL/退出/外断言失败/正常完成 4/4；Go 包回归/vet、ESLint/Prettier、四入口 Go source 漏洞扫描。原 r3～r6 失败保留，其中 r6 errno 丢失属于已修正的真实实现问题。

**运行源码已变，旧 4f18 六角色不含本修复。新正式组六角色尚未冻结/构建，不以测试派生镜像或旧组充数。** 原生 Linux 完整修复、备份恢复、跨源码升级回退和新组 E2E 仍未执行，安装环境等待授权。npm 根 37 moderate/2 low、后台 9 moderate；旧 Worker 10 MEDIUM 等未解决，不作安全全通过结论。

本轮源码 **`c7edb2f7d23cdecaf493370d8d62446907c67e67` 已推送并核验**；main 仍为 `14f9b1fba6504b1367aad6165a0b72c37e495927`。[机器记录](evidence/P6E-barrier-runtime-status.json)证明 68 个后端运行文件与最终复核证据逐字节一致，8 个运维/Compose 文件与源码提交一致。新六角色及正式 builder identity 仍为未构建/未验收；后继文档提交不改变上述运行源码身份。

见[本轮交付](deliveries/P6E-delivery.md)、[协议/运维](V1.1-RELEASE-OPERATIONS.md)、[实际专项](P6E-MAINTENANCE-TESTS.md)、[Linux 环境方案](V1.1-LINUX-ACCEPTANCE-ENV.md)。本轮不生产部署、不合并 main、不开 gate、不动旧故障卷/锁。以下 chain4 及更早内容为历史基线。

下一步只在获得独立 Ubuntu WSL2/原生 Engine 安装授权后准备环境，并证明实际 Daemon 身份；确认通过后再从统一完整源码构建新六角色，在全新项目执行完整修复与备份恢复链。当前不具备正式上线条件。

## 历史 chain4 基线（以下为当时结论）

本轮chain4只完成环境、六镜像身份、安全扫描及旧保护复核：[最新交付](deliveries/P6E-delivery.md)、[环境/并发代码审查](evidence/P6E-chain4-environment.json)、[收尾](evidence/P6E-chain4-closure.json)。本机只有Docker Desktop WSL2，没有原生Linux验收环境；未证明bind路径身份等价，严格Source检查保留，不再尝试路径转换。新完整链未启动，原chain3失败容器/卷/锁保持。宿主marker未被API/Worker实时读取，活跃发布与维护竞争仍为未修复的工程门槛，不能用停API后的502替代。

运行源码没有变化，候选仍为`4f18eaeaecb86baaca01f148f388e7e86eec68bf`六正式镜像；本轮未重建、不混用旧组。六ID/源码/平台吻合；691份原证据哈希不变、5组旧保护marker不变，新备份/修复/update被宿主工具拒绝。重新扫描Worker10MEDIUM/1LOW/1UNSPECIFIED，其余各1UNSPECIFIED；根npm37moderate/2low、后台9moderate。Nuxt4.6.3官方兼容补丁存在但未安装，musl分支相同补丁与Go入口无OpenPGP导入重新核对，告警及非零结果保留。详见[安全](V1.1-SECURITY-ACCEPTANCE.md)。

> 最后更新：2026-11-01（Asia/Shanghai）
> 当前阶段：**P6-E 受阻。4f18六角色身份复核通过，运行代码未变。本机缺少原生Linux验收环境；bind身份仍未证明，活跃API/Worker维护屏障仍未实现/验收。本轮不启动新整链，不申请上线。**

最新记录：[P6-E交付](deliveries/P6E-delivery.md)、[最终发行身份](P6E-FINAL-RELEASE.md)、[真实故障矩阵](P6E-FAULT-TESTS.md)、[跨源码验收](P6E-CROSS-SOURCE-ACCEPTANCE.md)。本页是最新结论；旧基线报告保留作历史，不将旧组证据扩大到最终组。

下一步：先确定独立本机Linux环境，再补齐API/Worker/维护程序共同的持久屏障及六种真实竞争测试；运行修改后重新冻结六角色，使用全新卷重跑修复→备份→空卷恢复→跨源码更新/回退→内容恢复→再次备份恢复。环境和门槛见[运维说明](V1.1-RELEASE-OPERATIONS.md)。最终推送状态由本轮Git实查及最终回复报告，main基线不变。

## 历史bb05专项（以下不替代新候选）

当轮只处理根atime与外层验收锁。空卷分步对照证明默认Docker create即改变卷根atime，容器尚未启动；只增加volume-nocopy后不变。源挂载nocopy、kernel RO、目录/文件O_NOATIME及完整metadata比较均已实现并实测，无重设atime。[诊断](evidence/P6E-atime-diagnosis-r3.json)、[O_NOATIME补测](evidence/P6E-atime-diagnosis-r4.json)。原9887的475/481条相同、六根atime改变的[原始失败](evidence/P6E-ro-readonly-matrix-r2.json)完整保留。

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
