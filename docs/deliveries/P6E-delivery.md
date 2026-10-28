# P6-E 交付：可靠性、安全、备份恢复与上线准备

日期：2026-10-28，Asia/Shanghai。分支：`feat/v1.1-admin-p6a`。

**状态：部分完成，可交付已经验证的隔离工程成果；暂不具备 V1.1 正式上线条件。** 未合并main，未连接生产服务器，未修改1Panel、OpenResty、Cloudflare、V1.0容器、数据库或`.env/.deploy`。Worker默认关闭、正式发布gate关闭，正式域名不能开启仅localhost允许的测试gate。

## 1. 运行版本与范围

本轮六个正式运行角色的冻结源码为 **`be5c96857c5a7098a9b8f80931ced47d0efcab89`**，数据库schema3。实际完整镜像ID、源码标签与扫描见 [镜像审计](../evidence/P6E-image-audit.json)，运行权限见 [容器边界](../evidence/P6E-runtime-boundaries.json)。Docker Desktop本地Linux环境与真实Nuxt/Vue/Go/SQLite运行，非生产部署。

后继API诊断修复源码为 **`aa23376bb508dad215e644c808dd2e9461d7170a`**；[修复专项](P6E-reconciliation-diagnostics.md)记录红绿测试与Linux全包回归。最终文档、主机运维工具和测试提交另行正常提交，不把它冒称这些冻结镜像的源码。故障专用镜像继承冻结构建器，另外编译`p6e_fault && linux`固定checkpoint；普通API/Worker/维护镜像无此tag，Docker上下文也排除故障入口。没有公网、环境变量或后台任务可调用的注入接口。

## 2. 完成能力与修复

- 统一媒体容量：原图10 MiB、multipart11 MiB、重编码派生/发布/预览/HTTP单文件16 MiB、单快照公开媒体256 MiB、8192单边和2500万像素。超限重编码在登记成功前拒绝，解决原32/16 MiB契约不一致。
- 新增存储余量保护与发布页容量面板：数据库/图片/发布目录按OS实际余量检查；小于512 MiB或2%、无法核实则拒绝新任务/上传，小于1 GiB或10%警告。受限用量采样最多10万条/共2秒/60秒缓存，路径不返回客户端。构建临时空间至少256 MiB，保留Worker/API资源限制。
- 独立离线维护器：停本站写入者、SQLite `VACUUM INTO`、schema/checksum/完整性/外键/引用/快照/媒体及全部历史产物校验，带逐文件SHA和六镜像身份的独立bundle。恢复只到新空卷，保留密码哈希、撤销Session/challenge。
- 新增V1.1独立部署/更新/代码回退脚本及`.v11-deploy`状态，保留V1.0脚本/镜像/卷。精确完整GitSHA和六镜像ID，schema不兼容拒绝，不降级数据库。内容恢复、代码回退、灾难恢复明确区分。
- 镜像硬化：从Nginx移除未加载模块与curl/libxml2/brotli，从运行Worker移除npm/npx/Yarn/corepack；固定Nuxt源码/lock依赖仍可离线完整构建。没有联网强制升级、不降低TLS/CSRF或Cookie安全属性。
- 增加真实故障、完整浏览器、备份可移植性、生命周期、安全扫描与性能工具，保留失败尝试和夹具修正记录，不把它们混计最终PASS。

不新增业务功能，不改变V1.0视觉，不自动清理历史或故障现场。没有总磁盘配额、跨进程预留或自动物理GC；其他进程仍可能耗尽宿主空间。

后继最终源码ESLint、TypeScript均通过，根9项/后台34项单元测试通过。Prettier全目录遍历首次被受保护且已忽略的备份目录ACL拒绝，未放宽权限；改为Git跟踪及非忽略文件清单逐文件检查，继续尊重`.prettierignore`。机器证据保留原始序列化和哈希，不做样式重写。实际文件数及结果见[最终格式检查](../evidence/P6E-final-format.json)，首次失败日志独立保留。诊断专项的Windows日志按仓库LF策略序列化，索引同时保存原捕获及交付字节哈希，不改日志内容。

## 3. 检查与正常链结果

| 检查              | 实际结果                                                                                                  | 证据与边界                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux Go全包      | 冻结基线99顶层PASS、0FAIL、0SKIP，342条HTTP记录；后继修复10个测试包通过、7个无测试包、0FAIL，vet退出0     | [基线日志](../evidence/P6E-go-tests.txt)、[后继回归](../evidence/P6E-go-post-diagnostics.txt)。后继全包未加-v，不推断测试条数。首轮测试tmpfs误设noexec单独留档；仅测试环境改exec |
| Vue/Nuxt检查      | 根与后台ESLint/TypeScript及单元测试实际结果见最终源码报告                                                 | [最终源码检查](../evidence/P6E-final-source-checks.json)，不以单元测试代替下面的真实服务验收                                                                                     |
| 前台构建/静态生成 | 生产build和generate退出0                                                                                  | [build](../evidence/P6E-frontend-build.txt)、[generate](../evidence/P6E-frontend-generate.txt)                                                                                   |
| 管理构建          | 实际Docker Vite构建通过，JS213.42 kB/gzip71.94，CSS22.02 kB/gzip5.57                                      | [Docker构建](../evidence/P6E-docker-build.txt)                                                                                                                                   |
| Docker构建        | API、Worker、gateway、legacy frontend、publication-static、maintenance均实际构建和启动                    | 首次Go代理TLS证书不匹配，未关闭验证；换受信代理并保留go.sum后成功，初次日志保留                                                                                                  |
| V1.0日常隔离回归  | 5路径、独立SEO、robots/sitemap、22资源、health和404通过                                                   | [3210实测](../evidence/P6E-v10-daily-smoke.txt)。未改已有日常容器                                                                                                                |
| 容器边界          | 非root/只读根/drop ALL/no-new-privileges/日志及资源限制；API无宿主端口，Worker无网络/DB/凭据/DockerSocket | [实际inspect](../evidence/P6E-runtime-boundaries.json)                                                                                                                           |

## 4. 真实故障验收

详细十二项矩阵、每个故障点、current、SQLite、目录、HTTP、自动/人工恢复过程见 [P6E-FAULT-TESTS.md](../P6E-FAULT-TESTS.md) 和`P6E-faults-*.json`。

十二项强制故障的安全行为均完成真实运行，另有一项正常基线。故障测试实际调用真实Nuxt；编译错误使用专用非法Vue源，超时实际等待固定构建器600000毫秒。Worker/API进程中断由控制器在固定checkpoint实际SIGKILL，并等待真实120秒租约，不改时钟或手动认领任务。ENOSPC在专属768MiB `/work` tmpfs实际写入804552704字节，余量从同值变为0并收到内核ENOSPC，没有填满宿主或业务数据卷。

已通过的切换前/后退出、SQLite成功UPDATE事务内中断、API重启、静态服务重启、历史目标损坏及HTTP验证服务不可用，均有独立canonical证据。失败或结果不明时不提前提示成功；验证服务不可用时原版本恢复，但状态维持`reconciling/recovery_required`，阻止新任务，恢复验证服务并核对同一任务才终结。

恢复再次失败的真实场景经过两次EACCES后保持人工核对并409阻断新任务；修复专用卷权限和验证服务后原任务第三次核对成功，页面保持完整。原基线API存在成功后保留旧错误摘要的缺陷，已用后继源码在同一成功事务内清空当前诊断，保留失败审计。专项真实HTTPS/UDS/SQLite两例及全包回归通过；不改写原故障证据中的缺陷。

后继API已按完整aa23376源码单独构建，实际镜像`sha256:e2d4e7a59e795b8528365b75d1ea9cf37e8d8676f3ff60691f2eb93f103869b3`。配合冻结be5c构建器完整复跑同一真实Nuxt恢复故障：两次EACCES、真实租约、人工修复后，原任务第三次核验成功，API `error:null`、SQLite两诊断字段NULL、失败审计至少2条保留且成功审计1条。[后继真实专项](../evidence/P6E-faults-recovery-fails-postfix.json)。这不是后继六角色全组装，也不代替跨源码升级验收。

**恢复边界：**控制器重启Worker、恢复测试卷权限/HTTP服务属于操作者干预，不能说全部故障自动恢复。构建前切换中断留下的`current.next.*`额外链接仍保留在故障专用卷；公开版本不变，但维护器只允许`current`链接，因此计划备份/更新保守拒绝，需要人工审查修复。P6-E没有自动化这项修复。

`*-harness-*.json`记录最初暂停方式、选择器、API契约或Compose依赖启动等夹具问题，不能混计应用通过，也未删除失败记录。全机断电、底层存储失效、所有分区同时满不在实测承诺内。

## 5. 完整备份恢复

实际链路：TTY初始化独立管理员→可信HTTPS登录→上传并确认64×40合成PNG→真实Nuxt发布A/B→恢复公开A保留草稿B→私有预览→停止写入者→`VACUUM INTO`和完整121文件集合备份→全新独立卷恢复→启动并重新登录。

恢复前后schema3、revision5、管理员1、项目3、上传1、快照3、任务4、发布记录3、未完成0、activeA一致。旧Cookie401；原密码可重新登录；草稿B、图片SHA、三页HTML/SEO、robots/sitemap、历史和私有预览均保持。[实际完整证据](../evidence/P6E-backup-recovery.json)。

另将原栈/首恢复栈的宿主部署描述符移开，仅凭独立bundle在第三组新空卷重建，6公开路径SHA完全相同。实际损坏HTML、修改runtime描述符、重复恢复到已有卷均拒绝；原描述符已归还。[可移植恢复](../evidence/P6E-backup-portability.json)。首轮Windows原生递归复制Linux链接的测试器崩溃未计通过，最终改用受限容器复制后在新卷重测。

最终审查另将校验与恢复的备份源bind收紧为只读。已有121文件备份重新校验→另一组全新六卷恢复→Inspect核对→再次校验通过，备份源整体SHA前后相同。该短回归未启动服务，不替代上面的真实启动恢复验收。[只读源回归](../evidence/P6E-backup-readonly.json)。

备份含密码哈希、会话秘密和私有资料，未提交备份本体、数据库、图片卷或TLS私钥。SHA不等于签名，需受信保管及异地加密副本；本轮未实现远端备份或托管密钥，不能把本机备份等同异地灾备。流程见 [备份恢复](../V1.1-BACKUP-RESTORE.md)。

## 6. 部署、更新与回退

独立模拟拓扑实测：同源码be5c/schema3的重新封装网关镜像→真实容器替换→旧镜像代码回退→缺失nginx可执行文件的坏候选真实启动失败→恢复旧服务并验证HTTP→schema4候选提前拒绝→独占操作锁拒绝。DB/图片/active保留，4公开路径SHA不变。[生命周期证据](../evidence/P6E-release-lifecycle.json)。

首轮故障候选只改ENTRYPOINT，但Compose固定entrypoint覆盖它，未产生预期故障；此测试器FAIL独立保存，不声称失败恢复机制因此已验收。修正为真实不可执行候选后重新通过。

这证明**同源码/同schema镜像生命周期**，没有证明不同功能源码版本升级，也没有执行跨schema迁移。schema不同一律拒绝，不能自动破坏性降级。最终审查发现并修复“停止候选失败”分支的锁保留缺陷：候选启动前持久化转换意图，停止失败及恢复记录ENOSPC仍保留原意图和operation.lock。真实坏候选配合测试专用宿主CLI wrapper复验通过，后续更新被阻断，操作者完成停写/旧库/原描述符/HTTP核对才释放锁。[专项证据](../evidence/P6E-release-guard.json)。这不是实际全机Docker daemon故障或物理盘满，不扩大为所有故障自动恢复；该故障期间入口不可用，不承诺升级失败零停机。

正式方案见 [OpenResty拓扑与V1.0切换](../V1.1-PRODUCTION-PLAN.md)、[更新与代码回退](../V1.1-RELEASE-OPERATIONS.md)。只规划本站Host、回环网关、`/admin/`及`/api/admin/v1`；未接触正式入口，不安装NPM。正式TLS/Cloudflare缓存、源站保护和真实V1.0→V1.1切换必须另获授权后核验。

## 7. 浏览器、图片和性能

- Chromium151专用CA信任、TLS验证开启。管理24功能组通过：登录/错误密码/429、Session恢复/失效/退出/改密、CSRF、项目/分类CRUD与排序/归档、409保留输入、上传更换及引用保护、资料/设置保存、网络失败、保卷重建。[管理报告](../evidence/P6E-admin-browser.json)。
- 真实发布10功能组通过：认证预览及全部子资源→A发布→保存B不改A→B发布→旧A标签内部路由及SEO仍A，A的JS/CSS/图片真实请求200且SHA不变→刷新B→恢复A且草稿B保留→四服务保卷重建→退出/Session到期预览HTML/JS/CSS/图片401。没有hydration/CSP/pageerror记录。[发布报告](../evidence/P6E-publishing-browser.json)。
- 320/390/768/1024/1440px×深浅主题：管理7页70组，公开3页30组、发布页10组，无页面级横向溢出；实际滚动并decode图片。键盘排序、焦点及移动菜单经真实操作。未测试真实移动硬件、读屏或完整渗透。
- Firefox/WebKit公开页共60组通过；Firefox可信HTTPS登录页与浏览器匿名401通过。WebKit私有测试CA不受信，HTTPS为**NOT_PASSED**，未关闭TLS验证；不等同Safari/iOS完整后台测试。[附加浏览器](../evidence/P6E-multibrowser.json)。
- 真实4096²高熵WebP原图<10 MiB，但重编码PNG>16 MiB：413且revision不变。5000²PNG实际上传201，派生541784字节，未引用软删除200，无OOM；1秒采样最大182181888字节/API限768 MiB、耗时726ms。不是所有25M像素输入的绝对峰值或压力结论。[图片样本](../evidence/P6E-media-peak.json)。

| Lighthouse13.6.0 / Chrome156 |    Performance |        LCP | CLS |       TBT |
| ---------------------------- | -------------: | ---------: | --: | --------: |
| 首页mobile三次中位           | 95（92/98/95） | 1123.47 ms |   0 | 195.31 ms |
| 项目页mobile                 |             91 | 2265.50 ms |   0 | 313.00 ms |
| 关于页mobile                 |             93 | 1036.18 ms |   0 | 259.46 ms |
| 首页desktop                  |            100 |  251.08 ms |   0 |      0 ms |

六次Accessibility/Best Practices/SEO均100。首页约161.3 kB传输、JS104.6 kB/CSS7.5 kB。原始报告、CPU校准warning及局限保留于 [汇总](../evidence/P6E-performance-summary.json)。本机Docker/模拟限速/合成测试内容，没有可比P6-D基线，**TBT不是INP**，未测真实用户INP/CrUX；不为评分放松安全或改变视觉。

截图：`P6E-admin-login.png`、`P6E-admin-project-list.png`、`P6E-admin-media-upload.png`、`P6E-admin-mobile.png`、`P6E-publishing-private-preview.png`、`P6E-publishing-release-history.png`、`P6E-publishing-public-home-{dark,light,mobile}.png`。合成测试图不是Blog/Nav/ERP真实截图。

## 8. 安全审计与剩余风险

| 项目       | 实测结果与结论                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| npm        | 根7low/0moderate/high/critical，admin0；deepmerge构建链尚未修复，不强制降级Nuxt                                      |
| node-forge | 安装/lock均1.4.1，官方gitHead/tag/integrity再次核对，保留P6-D修复；旧公告无first_patched_version，不扩大为系统零风险 |
| Go源码     | Windows全包及Linux三个正式入口：symbol0/imported0/module1，未导入openpgp的GO-2026-5932无修复；真实依赖表无openpgp    |
| Go二进制   | API/maintenance去符号扫描exit3，退化为go.mod精度的保守告警；Worker exit0。保留原报告及扫描器源码依据，不改成零告警   |
| 六角色镜像 | 全部0critical/high/medium；Worker1low deepmerge；API/maintenance未定级openpgp模块；四个Alpine角色未定级musl          |
| 来源冲突   | musl1.2.6-r3：Scout修复点r6，官方Alpine3.24 secdb/aports列r3已修；保留双方事实，正式发布前需复查并作处置决定         |
| HTTP安全   | 可信HTTPS匿名探针26项通过：管理no-store/noindex、8项API401、DB/env/git/manifest/snapshot及穿越404；无CORS放宽        |
| 产物秘密   | 最终活动release约317325字节，gitleaks8.28.0、无网络/非root/只读卷扫描exit0无已知模式发现；不等同未知秘密不存在       |

后继aa23376单API镜像另作精确ID扫描：Scout重试成功，0critical/high/medium、1条未定级openpgp模块告警；去符号二进制govulncheck仍exit3，保留模块精度原报。首次Scout认证服务失败也保留，不能用基线报告代替此候选。[候选镜像审计](../evidence/P6E-api-candidate-audit.json)。其余五角色仍为上述冻结身份。

仓库秘密扫描额外覆盖Git跟踪及非忽略的源码、文档和证据快照，在本机无网络/非root/只读源容器执行，扫描前后核对全部输入哈希。实际结果、文件数与输入清单摘要见[仓库扫描](../evidence/P6E-repository-secret-scan.json)；忽略的私有备份、数据库、上传和依赖不进入快照。模式扫描不能证明未知秘密不存在。

首轮扫描器实际exit1，7条generic-api-key均将本地候选镜像的tag误作密钥；[首轮告警](../evidence/P6E-repository-secret-scan-first.json)保留。逐条从实际源行重建脱敏Match，确认只匹配该固定公开镜像标识；最终报告保留scanExit、所有告警和逐条处置，不做整规则/文件豁免，也不改称工具零告警。未出现无法解释的密钥匹配时，脚本结果为`REVIEWED_IMAGE_TAG_FALSE_POSITIVES`。

完整来源、精确镜像及每项证据见 [安全验收](../V1.1-SECURITY-ACCEPTANCE.md)。运行Worker无数据库/Session/SSH/GitHubToken/DockerSocket，UDS0700/0600，无网络端口，固定Node/Nuxt命令，不接受用户命令。鉴权/上传/路径/秘密扫描和依赖工具覆盖不同范围，不能用零高危代替完整安全评审。

生产旧镜像没有升级，其既有安全接受和公网入口门槛保持独立。本轮测试通过不代表用户已接受所有剩余风险。

## 9. 修改文件与资料

- `backend/internal/contentlimits/`、`storagehealth/`、`httpapi/storage.go`及媒体/快照/Worker/HTTP核验：统一限制和容量保护。
- `backend/internal/maintenance/`、`cmd/homepage-maintenance/`、维护Dockerfile：一致性备份与空卷恢复。
- 六角色Dockerfile/ignore、`compose.admin-publish.yaml`、`deploy/v11/`：硬化、资源/源码身份、独立OpenResty模拟。
- `scripts/v11-{maintenance,release,recovery-test,backup-portability-test,release-test}.mjs`及三个shell入口：V1.1独立生命周期。
- `backend/cmd/p6e-fault-*/`、`httpapi/p6e_fault_linux.go`、`scripts/fixtures/p6e-*`、`p6e-fault-*.mjs`：仅隔离测试的真实故障工具。
- `scripts/admin-browser-test.mjs`、`publishing-browser-test.mjs`及`p6e-*`：浏览器、安全、镜像、容量、性能、精确项目清理与审计证据。
- README、进度、API/图片/后台/发布/数据库设计、五份V1.1运维安全说明和本交付；未改原始P0设计资料。

完整路径列表见[本阶段修改文件索引](../evidence/P6E-changed-files.json)，比较基点为P6-D末次提交`29b3b5f53ac0d5e2ab5c44927c76cf35b065a780`，包括已提交工程基线、后继修复与本次文档/证据。私有缓存、卷和备份不纳入Git。

## 10. 未完成门槛与下一步

1. 后继补丁的完整六角色最终镜像组装与端到端验收仍未完成；不能把冻结be5c的六镜像、十二故障、浏览器及备份证据扩大到任何后继发行镜像。十二故障安全行为通过不等于所有人工恢复边界已消除。
2. 真正不同功能源码版本的升级与回退兼容验收；现有同源码镜像替换不能代替。跨schema迁移没有实现，必须另行设计和验收。
3. 崩溃残留`current.next.*`的可审计人工处理/修复流程尚未自动化，备份在该现场仍保守拒绝。不能跳过完整性检查来强行更新。
4. 确认musl来源冲突和其他依赖残余风险处置，安排异地加密备份、实际RPO/RTO、容量报警接收人与历史保留政策。
5. Blog/Nav/ERP真实截图、URL、技术栈和状态，公开联系方式及更多个人资料仍待用户补充；允许首版明确占位的历史授权不等于将隔离合成图作为真实资料发布。ERP必须确认无敏感业务信息。
6. 完成上述工程门槛之后，再申请独立生产授权和只读预检；正式OpenResty/Cloudflare/TLS/源站保护、真实入口切换和其他网站回归均未在本阶段执行。

因此当前不申请V1.1正式上线。本轮中途多次GitHub HTTPS连接被reset；恢复连接后，冻结工程基线be5c及诊断修复 **`aa23376bb508dad215e644c808dd2e9461d7170a`** 已正常推送，并通过`git ls-remote`核验功能分支指向aa23376、main仍为`14f9b1fba6504b1367aad6165a0b72c37e495927`。最终文档/工具提交SHA和推送结果以本轮Git实测及最终回复为准，不将本文件写入自身尚未生成的SHA。
