# P6-D 故障验证矩阵与验收边界

日期：2026-10-27。范围为 V1.1 独立本地发布环境；发布能力默认关闭，正式管理 Origin 不能开启此本地 gate。本阶段没有连接生产服务器，没有修改正式网站、DNS、反向代理或其他业务容器。

本文区分真实 HTTPS、SQLite、文件系统、HTTP 和进程级测试，以及固定产物 fixture、fake Builder / Control 的故障注入。分层测试通过不等于真实 Nuxt 构建、Worker、API、Nginx 和容器重启组成的全部故障端到端测试通过。

## 实际执行记录

- 最终 Linux Go 全包日志共 **88 个顶层测试、0 个跳过、0 个失败**；嵌套子测试不另计顶层数量。最终主交付记录完整命令及构建环境。[全包测试证据](evidence/P6D-go-tests.txt)。
- 补充的真实并发 HTTPS 与真实 SQLite 结果写入故障测试均已通过。SQLite 日志记录：**7 个真实 HTTP 资源核验后触发 409，保持对账中，再以同一任务完成恢复核验**。[补充故障证据](evidence/P6D-additional-faults.txt)。
- 独立临时容器的 **128KiB 专用 tmpfs** 触发实际内核 `ENOSPC`，原 A 的指针和完整产物哈希保持有效，B 未激活；未填满宿主机磁盘或业务卷。[ENOSPC 证据](evidence/P6D-enospc.txt)。
- Windows 本机补充并发 HTTPS 测试重复三轮通过，`go vet ./internal/httpapi` 通过。原子 symlink / flock 相关测试以 Linux 实际执行为准；不以 Windows 跳过结果代替 Linux 测试。
- 正常 Nuxt 发布、浏览器交互及保卷重建的最终结果以 `docs/deliveries/P6D-delivery.md` 为准。成功任务后的保卷重建不视为处理中任务的崩溃恢复测试。

## 18 项故障矩阵

“分层通过”表示表中指定层级实际运行通过；“部分覆盖”表示已运行的安全边界测试通过，但仍缺少表中列出的真实 Nuxt 或容器故障测试。未登录与未授权合并为第 2 项。

| 编号 | 故障或拒绝场景             | 实际测试与观测                                                                                                                                                                                                                                                                                                                                   | 结论及边界                                                                                                                                                  |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 数据库事务失败             | `TestPublicationHTTPSGatesRevisionReauthIdempotencyAndAtomicFailure` 在真实 SQLite 入队事务中设置 `BEFORE INSERT` trigger，`RAISE(ABORT)` 后真实 HTTPS 返回 409，未遗留快照。                                                                                                                                                                    | **分层通过**：真实 HTTPS + SQLite 入队事务回滚。不是磁盘 I/O 导致的数据库提交失败。                                                                         |
| 2    | 未登录或未授权发布         | 同一测试验证匿名请求 401；有效登录但缺少再次验证的发布请求 403。正式环境发布 gate 的配置拒绝另由 `TestProductionPublicationConfigurationFailsClosed` 验证。                                                                                                                                                                                      | **分层通过**：认证和再次验证限制已实际拒绝。本项目没有额外虚构多角色授权模型。                                                                              |
| 3    | CSRF 失败                  | 真实 HTTPS 发布请求缺少 CSRF 返回 403；既有认证生命周期测试另验证跨 Origin 和错误 CSRF。                                                                                                                                                                                                                                                         | **分层通过**：真实请求经过鉴权中间件。                                                                                                                      |
| 4    | 并发发布冲突               | `TestPublicationConcurrentHTTPSRequestsCreateSingleJob` 在服务端 barrier 等待两条真实 HTTPS 请求到达后同时放行。不同幂等键得到一个 202、一个 `JOB_CONFLICT` 409；数据库仅有一份 snapshot、job、assignment 和幂等记录。                                                                                                                           | **分层通过**：真正重叠请求竞争真实 SQLite，补足原有顺序冲突测试。不是两个真实 Nuxt 构建同时竞争。                                                           |
| 5    | 重复请求                   | 并发测试使用相同幂等键时，两条 HTTPS 请求均为 202 且返回同一 job；异请求体复用键返回 409；已完成任务重试返回原 job。                                                                                                                                                                                                                             | **分层通过**：真实 HTTPS / SQLite 幂等行为，不重复冻结或入队。                                                                                              |
| 6    | Worker 不可用              | 将 API 记录的 Worker 最近可用时间置为不可用，提交返回 503；控制协议路径不能从公开 API 访问。                                                                                                                                                                                                                                                     | **部分覆盖**：可用性拒绝逻辑实际运行；尚未在真实 Nuxt 发布现场杀死 Worker 后测其可用性转移。                                                                |
| 7    | 构建途中 Worker 中断       | Runner 的 fake Builder 故障覆盖构建失败，API 租约测试拒绝过期 token；真实子进程组测试验证超时终止父子进程及启动时处理已验证孤儿 journal。                                                                                                                                                                                                        | **部分覆盖**：尚未对正在运行 Nuxt 的真实 Worker 容器执行中途终止并贯通 API 恢复。不能称为真实 Nuxt 中断端到端通过。                                         |
| 8    | 静态构建失败               | `TestRunnerBuildAndValidationFailuresNeverActivate` 的 fake Builder 返回错误，实际 Store 未切换 current，任务按失败协议处理。                                                                                                                                                                                                                    | **部分覆盖**：固定构建失败返回路径通过；尚未制造真实 Nuxt 编译或生成失败并走完全部服务链。                                                                  |
| 9    | 静态文件缺失或损坏         | 完整文件树测试实际删除、修改、增加 fixture 文件并验证哈希；产物验证测试实际移除依赖 chunk / 必需页面，均拒绝封存或激活。                                                                                                                                                                                                                         | **分层通过**：真实文件系统和验证器，输入为固定静态 fixture，非真实 Nuxt 失败产物。                                                                          |
| 10   | SEO 验证失败               | `TestActualOutputValidationAndFailureGates` 使用实际 HTML / robots / sitemap fixture，故意设置错误 SEO、标记、资源前缀或公开 `noindex` 等，验证拒绝发布。                                                                                                                                                                                        | **分层通过**：真实产物验证器；没有冒称已让真实 Nuxt 生成错误 SEO。                                                                                          |
| 11   | 无效或未确认素材引用       | `TestPublicationRejectsUnconfirmedPublicMediaWithoutPartialSnapshot` 在真实 SQLite 引用未获公开确认的素材，HTTPS 返回 422，snapshot / job 均为 0；assignment 与文件复制测试另覆盖缺失、哈希错误和未知素材。                                                                                                                                      | **分层通过**：真实数据库引用门槛和实际文件复制检查，未发布未确认素材。                                                                                      |
| 12   | 磁盘满                     | `TestRealTinyFilesystemENOSPCPreservesActiveRelease` 在专用 128KiB tmpfs 上将候选产物写至实际 `ENOSPC`，检查 current 仍为 A，完整 A manifest 校验通过，B 未激活。                                                                                                                                                                                | **分层通过**：真实内核错误及真实 Store；不代表所有 Nuxt `/work`、SQLite 或宿主机分区满的端到端组合均已测试。                                                |
| 13   | 构建超时                   | `TestActualTimeoutKillsWholeBuildProcessGroup` 启动真实测试进程及其子进程，1200ms 到期后整组终止；孤儿 journal 测试验证启动恢复与未知状态拒绝。                                                                                                                                                                                                  | **部分覆盖**：真实 Linux 进程组终止通过；没有实际运行超时十分钟的 Nuxt 构建。                                                                               |
| 14   | current 切换前进程退出     | `TestActualProcessCrashAtEveryAtomicActivationBoundary` 的真实子测试进程在 `after-intent`、`before-current-rename` 直接 `os.Exit(79)`，不运行 defer；新 Store 重新取得内核锁，current 保持完整 A，无伪造完成回执。                                                                                                                               | **分层通过**：真实进程崩溃、锁释放和持久化边界；子进程是测试二进制，不是完整 Worker / API 容器。                                                            |
| 15   | current 切换后进程退出     | 同一测试在 `after-current-rename`、`after-receipt` 直接退出；新 Store 看到完整 B，并能修复切换与回执之间的缺口；原产物不被部分覆盖。                                                                                                                                                                                                             | **分层通过**：真实进程崩溃及文件系统恢复；最终 API / HTTP 成功证明由独立对账测试覆盖，不将二者拼称为单次全栈崩溃测试。                                      |
| 16   | 发布结果数据库写入失败     | `TestPublicationRealSQLiteResultFailureReconcilesExistingActivation` 先真实激活固定产物，API 经真实 HTTP 核验全部 7 个文件后，真实 SQLite `BEFORE UPDATE ... succeeded` trigger 中止完成事务并返回 `RECORD_CONFLICT` 409。任务保留 `reconciling`、无部分成功证明，新任务 409；租约到期后同 job 领取恢复，旧 lease 被拒绝，重新 HTTP 核验后成功。 | **分层通过**：真实 SQLite + 文件系统 + HTTP，而非 fake Control。原 manifest / activation receipt 哈希不变，任务及快照不重复、草稿不改变；未执行 Nuxt 构建。 |
| 17   | 版本恢复失败或状态不符     | Store 测试拒绝旧任务的恢复操作覆盖无关 current，保留当前 B；完整文件树校验另覆盖损坏产物拒绝。API 对真实 NotFound HTTP 服务拒绝成功，并在实际 Restore 后重新证明恢复版本。恢复证明与原激活回执独立保存。                                                                                                                                         | **部分覆盖**：恢复拒绝边界及恢复成功路径分层通过；尚未在完整服务链中同时注入恢复写盘失败、HTTP 故障与真实 Worker 重启。                                     |
| 18   | 服务重启后的处理中任务对账 | API 测试推进时钟令真实数据库租约到期，再领取同一冻结任务并拒绝旧 token；Runner 测试从保留 Store / receipt 对账而不重建。正常完成任务后的容器保卷重建另属浏览器验收。                                                                                                                                                                             | **部分覆盖**：租约和持久化协议通过；尚未对真实 Nuxt 构建、切换或结果写入中的容器重启进行完整恢复验收。                                                      |

## 其他发布安全边界

- 私有预览的 HTML、脚本、样式和图片都必须经 API 认证；每次请求重新检查预览有效期、数据库成功记录和 manifest 中该资源的哈希。不存在公开 Nginx 预览目录映射。
- `TestPreviewEveryResourceAuthenticationTTLAndSnapshotPrivacy` 实际验证预览请求认证、TTL 到期拒绝和隐藏项目不进入公开投影。浏览器中所有资源类别的退出 / 会话到期验证以最终浏览器报告为准。
- `TestPublishingStatusPassivePollingDoesNotExtendSessionIdleExpiry` 通过真实 HTTPS 和可控时钟验证状态轮询不续空闲期限；超过 30 分钟返回 401。
- 只有 API 独立核对实际 current、完整 manifest、任务证明及固定隔离 HTTP 服务后，才允许把任务写为 `succeeded`。排队、Worker 自报成功和只有磁盘产物均不等于发布成功。
- 发布进程仅使用同 UID 的私有 UDS，固定 Nuxt 命令及环境白名单；Worker 无网络、无数据库卷、无账户密钥卷和 Docker socket，具有内存 / CPU / PID / 临时空间约束。公共 Nginx 使用页面及历史版本资源白名单。
- `current` 的替换是文件系统原子操作；数据库与文件系统不是单个 ACID 事务。跨边界的不确定状态保留为 `reconciling`，通过同一任务证明恢复，不能将其报告为已成功。
- 恢复限定相同源码 SHA、构建器镜像 ID 与兼容 schema，不支持跨代码或镜像版本自动恢复。正常验收应使用启动 helper 固定实际镜像 ID；直接 Compose 的默认构建器名称不能替代不可变镜像证明。

## P6-E 必须补齐的验收

1. 在独立环境中对正在运行的真实 Nuxt 构建执行 Worker 中断，证明子进程终止、租约回收、失败 / 对账状态、旧站完整可用以及草稿保持不变。
2. 通过仅测试环境可用的受控输入制造真实 Nuxt 构建错误和超时，贯通 API、Worker、静态服务与界面；不得添加生产可启用的任意命令或运行时故障后门。
3. 分别在构建中、切换前后及结果写入期间重启真实服务容器，保留卷后验证同任务恢复、HTTP / SQLite / 指针一致性和旧浏览器资源一致性。
4. 在完整服务链中制造恢复目标缺失或损坏、恢复写盘失败、验证 HTTP 不可用等组合，确认不覆盖无关 current、不虚报成功且后续发布保持关闭。
5. 明确跨源码 / 构建器更新的兼容范围，补充离线备份恢复、磁盘容量监控、保留版本清理流程及正式发布的内容与安全门槛。清理只能针对已确认的本站资源，不得执行全局 Docker 清理。

P6-D 已运行的分层测试能够证明表中具体边界，不解除上述未完成项，也不授权生产发布。最终 P6-D 交付应继续明确真实端到端故障覆盖不足；正式服务器和正式发布 gate 保持未操作 / 关闭状态。
