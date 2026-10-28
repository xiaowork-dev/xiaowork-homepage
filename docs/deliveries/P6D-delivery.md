# P6-D 交付：静态内容发布、草稿预览与版本恢复

日期：2026-10-27～28（Asia/Shanghai）。分支：`feat/v1.1-admin-p6a`。

**状态：本地正常闭环已通过；故障验收部分完成，正式发布保持禁用。** 未合并main，未连接生产，未修改正式OpenResty、Cloudflare、数据库或V1.0 `.deploy`。本报告不是生产发布批准。

## 1. 实际实现

| 模块         | 已实现行为                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 不可变快照   | 在确定revision的事务内冻结品牌/个人资料、可见项目、使用中的分类、技术/状态、首页/页脚/SEO及已确认媒体；确定性JSON+SHA256。不包含密码、Session、审计、私有素材声明/路径或隐藏/归档项目。快照与媒体引用独立保留。 |
| 任务安全     | Session、CSRF、Origin、If-Match、幂等键；发布/恢复另需再认证、全站确认、已核对的active ID。202只表示排队。同键重试返回同任务，未完成任务阻断新任务。                                                            |
| 受限Worker   | 与API经同UID私有UDS通信，父目录0700/socket0600；无网络、数据库、账户/session secret、SSH/GitHub凭据、Docker Socket。固定源码/lock依赖与Nuxt命令，不接受用户命令、路径或Git ref。                                |
| 完整静态构建 | 重新生成首页、项目列表、关于页、404/health、客户端数据与版本资源、SEO、canonical/OG、robots/sitemap；origin固定`https://xiaoworks.com`，保留Nuxt静态架构。                                                      |
| 私有预览     | 独立冻结/构建，不切换current。全部HTML/JS/CSS/图片逐请求认证与哈希检查，no-store/noindex，24h到期拒绝；退出/会话过期后拒绝。不能直接提升预览为正式产物。                                                        |
| 发布/对账    | 全文件manifest/hash/fsync，不可变release，intent与原子相对current切换、任务专属receipt。API经RO文件、素材、current和真实内网HTTP逐文件验证后才事务记成功；未知状态保持reconciling/recovery_required并阻断。     |
| 旧页面兼容   | 快照编入同版bundle，关闭payloadExtraction/appManifest；JS/CSS/主题脚本/favicon/分享图/图片均版本化。历史资源保留；旧A标签内部导航仍A，刷新读取当前版本。                                                        |
| 历史恢复     | 验证完整历史产物、相同源码SHA/Worker镜像ID/schema，再独立任务/再认证/确认/切换/HTTP对账。不回退草稿、账号、schema、Git或镜像。                                                                                  |
| 中文后台     | 真实预览、全站差异摘要、当前版本、任务进度/脱敏错误、历史与恢复；刷新查询真实任务，409保留输入并要求重新确认，密码提交后清空。未核验不显示成功。                                                                |

V1.0视觉与无快照TS配置回退保留。Blog/Nav/ERP仍明确资料待确认，没有编造外链/技术栈/状态/截图。A/B验收图在专用卷本地生成，明确标注合成图，不是项目截图；经过真实上传、重编码、公开确认、绑定和发布，不进入正式数据或源码种子。

## 2. 主要修改文件

- `backend/internal/publishmodel/`、`publishdata/`、`publishfs/`、`publishworker/`、`cmd/homepage-worker/`：协议、快照、固定构建、产物验证、进程组/锁、封存/原子切换/恢复。
- `backend/internal/httpapi/publication*.go`、`worker_socket*.go`：任务/历史/预览、认证/并发/幂等/再认证、全站确认与独立对账；包含HTTP和故障测试。
- `backend/migrations/003_publication_details.sql`及runner：追加schema3，001/002原文保留，版本/checksum漂移拒绝，没有删库重建。
- `shared/publication*`、`shared/content.ts`、Nuxt配置与前台数据/SEO适配：同快照HTML和bundle、版本资源及固定origin，没有重新设计前台。
- `admin/src/pages/PublishingPage.vue`、`lib/publishing.ts`、router/dashboard/types及测试：真实发布操作。
- `compose.admin-publish.yaml`、`backend/worker.Dockerfile`、`deploy/admin-publish/`、`scripts/publishing-*`：独立容器、可信HTTPS及验收工具。
- `package-lock.json`：兼容更新node-forge1.4.1；README、进度、数据库/API/迁移/发布设计与操作说明同步。

## 3. 实际测试

| 检查        | 结果与证据                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go/Linux    | `go test -count=1 -v ./...`：93个顶层PASS、0FAIL、0SKIP，335条expected/actual HTTP记录；vet退出0。[完整日志](../evidence/P6D-go-tests.txt)                                                                                |
| 管理前端    | ESLint/TypeScript、34单测、Vite build通过；JS211.96kB/gzip71.31，CSS22.02kB/gzip5.57。[检查](../evidence/P6D-admin-check.txt)、[构建](../evidence/P6D-admin-build.txt)                                                    |
| 公开前台    | ESLint/TypeScript、8单测、Nuxt生产build/静态generate通过。Windows Nitro cache-driver external提示保留，静态产物与HTTP通过。[build](../evidence/P6D-frontend-build.txt)、[generate](../evidence/P6D-frontend-generate.txt) |
| 真实浏览器  | Chromium151、专用CA信任，`ignoreHTTPSErrors=false`；10功能组PASS。预览→发布A→保存B不改A→发布B→旧A导航仍A→刷新B→恢复A，草稿B保留。[报告](../evidence/P6D-browser.json)                                                     |
| 资源一致性  | 真实网络及no-store显式fetch证明A的JS/CSS/图片在B发布后仍200且SHA不变。未关闭正常Nuxt预取；无记录到的hydration/CSP/pageerror。                                                                                             |
| 预览权限    | HTML/JS/CSS/重编码图片：匿名、退出、Session到期共12次401；24h预览TTL由受控时钟的真实API测试验证，没有等候24小时。                                                                                                         |
| 响应式/主题 | 公开三页×5宽度×双主题30组，发布管理页10组。320/390/768/1024/1440px无页面级横向溢出，全部前台图片滚动并decode。未测试真实移动硬件/多浏览器/读屏。                                                                          |
| HTTP/SEO    | 恢复后3页独立title/description/canonical/OG/版本标识一致，22个immutable资源200，robots/sitemap固定正式origin；私有目录404。[证据](../evidence/P6D-public-http-seo.json)                                                   |
| Docker      | 镜像真实构建；API/Worker/frontend/static/gateway healthy，两init退出0。非root/只读/drop ALL/no-new-privileges/日志限制，Worker离线且3GiB/2CPU/256PID。[Docker证据](../evidence/P6D-docker.json)                           |
| 数据持久化  | 保卷force-recreate API/Worker/static/gateway后，原Session、草稿B ws-44、公开A、历史、私有预览和图片均保留；不等同离线备份恢复。                                                                                           |
| V1.0回归    | 日常3210三页/路径/SEO/22资源/健康/404 HTTP通过；11个原有Homepage/Blog/ERP容器ID、镜像、启动时间和运行状态保持，不冒称其他业务全功能回归。[日常回归](../evidence/P6D-v10-daily-smoke.txt)                                  |

Go全包在无网络、只读源码Linux容器执行，Go1.27.3、SQLite3.54.1。专用128KiB tmpfs实际ENOSPC，没有填满宿主或业务卷。Bash脚本语法/status通过；完整`publishing-dev.sh build/start/stop`没有单独重新演练，本轮使用相同Compose及专用验收helper。

## 4. 故障测试与尚未完成的门槛

完整18项及真实运行层级见 [故障矩阵](../P6D-FAULT-TESTS.md)。已验证：

- 真实HTTPS拒绝匿名、CSRF、无再认证和旧revision；并发请求一202一409，相同幂等键返回同任务。
- SQLite真实trigger中止入队事务，无部分snapshot/job。完成写入失败前已核验7个真实HTTP文件；保持对账中、阻断新任务，以同任务/同artifact/同receipt恢复证明。
- 实际删除/修改/增加静态fixture文件、错误SEO/资源前缀、缺失/未确认素材均拒绝；没有伪装成真实Nuxt错误产物测试。
- Linux真实子进程在intent、rename前、rename后、receipt后直接退出；重开Store核查完整A/B并补回执。真实进程组超时杀父子进程；内核ENOSPC保留A。
- 在观察到本任务固定Nuxt构建进程后，对专用Worker容器实际SIGKILL：旧站三页及版本文件字节不变，新任务先409、实际可用性期限到期后503。重启并等待实际120秒租约后，同任务失败为`INTERRUPTED_BEFORE_ACTIVATION`，草稿不变，没有重新构建或虚报成功。[中断证据](../evidence/P6D-worker-interruption.json)

**完整真实Nuxt/容器组合故障仍未全部完成**：真实编译错误和十分钟超时、切换/结果写入瞬间容器退出、恢复再次失败及数据库/文件系统/HTTP组合，跨源码升级和离线备份恢复。分层测试不能拼称单次全栈崩溃通过。默认Worker不启动/gate=0，正式origin无法开启本地gate；本地正常链通过不解除这些条件。

## 5. 本轮发现及修复

1. Nuxt曾试写只读依赖缓存：关闭Chrome工作区缓存和buildCache，Vite cache放任务目录，固定环境`NUXT_LOCK=0`。仍有生命周期flock和任务独立目录，没有开放网络或依赖写权限。[离线修复](P6D-offline-builder-fix.md)
2. 已验证builtin品牌/分享引用被误拒绝：保留严格allowlist，增加真实种子回归。
3. JSON传输改写`&`造成RawMessage哈希变化：仅私有claim编码保持封存字节，增加真实UDS/生产UnixClient/上传媒体/Unicode回归，不放宽哈希。[传输修复](P6D-snapshot-transport-fix.md)
4. 测试同步修复：SPA等待路由/head真正完成；懒加载声明路径与最终decode分别检查；到期fixture等待最小Session年龄。冻结时钟移至CLI账户初始化之后，避免跨秒违反测试数据库时间约束，安全策略未放宽。
5. Worker错误只保留白名单code和固定中文摘要，自由文本丢弃，不向UI显示构建日志、堆栈或秘密。

## 6. 安全审计

- 10月27日兼容更新node-forge1.4.0→1.4.1并实际安装。官方npm gitHead与v1.4.1 tag commit均为`8a917370ec51731e817c2d547b7329a58f8210af`，integrity与lock一致。官方旧告警仍无first_patched_version、范围列为<=1.4.0；保存来源和工具结论，不声称所有安全问题清零。[来源](../evidence/P6D-node-forge-source.json)
- **10月28日最终根审计7 low、0 high、0 critical**，沿deepmerge4.3.1构建链，官方最新仍4.3.1；未采用不兼容Nuxt降级。27日0告警作为初始历史证据保留。[最终](../evidence/P6D-npm-audit.json)、[初始](../evidence/P6D-npm-audit-initial.json)。admin审计0。
- Go再次扫描symbol0/package0/module1，为未导入openpgp的GO-2026-5932，无修复版本，不是已解决。[Go审计](../evidence/P6D-govulncheck.txt)
- 离线、无秘密、固定输入/命令及资源限制缩小构建攻击面，静态Nginx不运行Node；不能将隔离等同漏洞消除。生产旧镜像未更新，原用户风险接受和公网门槛保持有效。
- 镜像OS CVE、完整渗透/DoS/峰值及备份恢复尚未完成。成功release默认保留，无预览物理GC/配额/磁盘告警。恢复限定同源码SHA/Worker镜像ID/schema。派生图32MiB与预览/HTTP核验16MiB上限尚需统一；大图可能安全拒绝，不能称全部尺寸发布已验收。

## 7. 版本、截图与操作

验收运行源码SHA：`16adc47b1f20a65f8ec0218ac4e9cbebac7ba1d2`。Worker镜像ID：`sha256:d2cd1b6ff657a93944c555314dbec2e17b0c475931918bcbfb74f1b2dc2a80d3`。API/Worker使用同一源码身份与实际构建器ID。

正常浏览器验收A：`rel_84c4dd3b464732e6c5e8fa3ce38d8daa`（ws-39），B：`rel_bece469466bd836b4fc8adf13addf814`（ws-44）；该轮结束时恢复公开A、草稿B ws-44保留。随后独立中断测试的基线为`rel_64d371127a3729f011b09ae6bf80b1c5`，测试前后均保持此版本，草稿仍为ws-44。均为专用本地测试内容，各证据保留其实际采集时点，不将不同轮次混称同一版本。

实际截图已查看：[后台历史](../evidence/P6D-release-history.png)、[私有预览](../evidence/P6D-private-preview.png)、[发布A](../evidence/P6D-publication-A.png)、[后台浅色](../evidence/P6D-publishing-light.png)、[后台手机](../evidence/P6D-publishing-mobile.png)、[重建后](../evidence/P6D-after-recreation.png)、[前台深色](../evidence/P6D-public-home-dark.png)、[浅色](../evidence/P6D-public-home-light.png)、[手机](../evidence/P6D-public-home-mobile.png)、[中断恢复](../evidence/P6D-worker-interruption.png)。完整长图保留，合成内容明确标记。

启动、TTY初始化、可信CA、预览/发布/恢复与排障见 [发布操作](../V1.1-PUBLISH-OPERATIONS.md)。网关仅回环3212/3445，临时9323验收后撤除，七个持久卷保留，不删库/历史、不prune；日常环境保留。验收清理见 [清理证据](../evidence/P6D-e2e-cleanup.json)。

`P6D-browser-initial.json`、`P6D-browser-second.*`、`P6D-browser-transport-before.*`、`P6D-browser-route-before.*`与`P6D-browser-failure.png`保留早期失败/诊断现场，不能作为最终PASS依据。最终结论只引用本报告表格列出的成功报告及其实际测试范围。构建日志中的NUL虚拟模块字符转为可读的`\0`并保留说明，未删去构建提示。

## 8. Git与P6-E

实现基线`51fa29159e709fb71eb16b384d65c5b60f13911b`已推送。随后修复和最终报告/证据在本轮正常提交推送功能分支，并读取远端核验。不强推、不合并main；当前报告自身SHA不循环写入本文件，最终SHA和真实推送结果在交付回复报告。

P6-E优先补齐真实故障组合、离线备份恢复/跨代码升级、大图容量与资源限制、容量告警/保留政策、镜像扫描、全栈性能/可访问性及正式OpenResty上线预检。真实项目/个人素材待用户补充。本阶段不会为完成形式而打开生产发布。
