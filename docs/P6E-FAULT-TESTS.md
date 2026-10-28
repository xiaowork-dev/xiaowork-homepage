# P6-E 真实故障集成验收

本记录仅针对本机 Docker Desktop 的 `xiaowork-homepage-v11-p6e-fault` 专用项目。使用独立 SQLite、上传、发布、证书及 socket 卷，HTTP 为回环 3213、可信 HTTPS 为 localhost:3446，内部网为 `192.168.248.0/28`。未连接生产服务器，未修改 V1.0、OpenResty、Cloudflare 或其他项目。

受审运行源码为 `be5c96857c5a7098a9b8f80931ced47d0efcab89`。测试镜像继承该源码构建的固定 Nuxt 源码和离线依赖；测试报告记录 `docker image inspect .Id` 的实际测试镜像 ID。测试 overlay 另有只在 `p6e_fault && linux` build tag 下编译的 checkpoint，不能将它作为生产镜像部署。普通 API、Worker、maintenance Dockerfile 不启用该 tag，生产构建上下文也排除这些故障辅助源码。

## 测试方法与事实边界

- 所有构建场景均经真实浏览器完成可信 HTTPS 登录、Session、CSRF、再认证及 revision 提交，真实 API 冻结快照，真实 Worker 通过 UDS 领取。没有用 fake Builder 或固定 HTML 代替 Nuxt。
- 编译失败仅把固定非法 Vue fixture 挂入测试镜像源码；超时仅使用固定 Nuxt `build:before` 延迟 hook，并实际等待生产 FixedBuilder 的十分钟超时。不接收管理员提供的命令、源码或路径。
- 原子边界由测试 Worker 的现有 `Store.SetFaultForTest` 精确暂停；测试控制器再经 Docker 从父命名空间发送 `SIGKILL`。暂停使用固定私有 `/tmp/p6e-continue`，不是公开 API 或环境故障开关。
- SQLite 中断在测试 API 注册的固定无参函数内暂停，该函数仅由专用测试 DB 的 `BEFORE UPDATE ... status='succeeded'` trigger 调用。外部杀死 API 后移除该测试 trigger、重启原服务；不改任务、租约时钟、快照或 current 来制造通过。
- 每项 canonical JSON 均保存实际任务、活动版本、SQLite 状态、发布目录、manifest/页面哈希、公开 HTTP 及恢复过程。Worker 停机后的恢复会等待真实 120 秒租约。重启由测试控制器代表操作员执行，不能描述成进程永不退出或所有故障均自动恢复。
- HTTP 证据是各故障边界与恢复后的实际请求，不是连续可用性探针。静态 Nginx 被显式重启时可能短暂拒绝连接；本次证明重启后的版本与资源一致，未测量该停机窗口，也不声称零停机或整个期间每个请求都成功。
- `*-harness-*.json` 是明确保留的旧版测试夹具失败，不能计入最终通过数量。最初 PID 1 自发 SIGSTOP 未可靠暂停，后来改为私有哨兵等待；另一次恢复成功后的截图存在多 h1 选择器错误，已改为精确标题并完整重跑。

## 十二项实际矩阵

十二项强制故障均已使用冻结受审源码实际运行，安全行为通过；另有一项正常基线。恢复场景发现的旧错误摘要残留另列为后继修复事项，不能用故障矩阵通过掩盖该缺陷。只有以下固定文件名的 canonical JSON 计入本矩阵。

| 项目                    | 故障位置与预期安全行为                                                                                                      | 实际结果与证据                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1. 真实 Nuxt 构建失败   | 非法 Vue 源码导致真实编译失败；旧站、草稿、current 保持，任务 failed                                                        | 已通过：[compile-error](evidence/P6E-faults-compile-error.json)                             |
| 2. 真实 Nuxt 构建超时   | 固定 hook 阻塞真实 Nuxt，经过完整十分钟后进程组被终止，旧站保持                                                             | 已通过：任务实际600000ms，[timeout](evidence/P6E-faults-timeout.json)                       |
| 3. 构建期 Worker 退出   | 观察本任务真实 Nuxt 命令后 SIGKILL；重启后同任务失败，不重新构建                                                            | 已通过：[building-exit](evidence/P6E-faults-building-exit.json)                             |
| 4. 原子切换前退出       | 在 before-current-rename 等待时 SIGKILL；原站字节不变                                                                       | 已通过：[before-switch](evidence/P6E-faults-before-switch.json)                             |
| 5. 原子切换后退出       | 在 current 已替换、receipt 尚未写入时 SIGKILL；同任务修复证明后独立 HTTP 验证                                               | 已通过：[after-switch](evidence/P6E-faults-after-switch.json)                               |
| 6. 结果写 SQLite 时中断 | 真实事务执行成功状态 UPDATE 的 BEFORE trigger 时 SIGKILL API；WAL 回滚，不提前显示成功                                      | 已通过：[sqlite-commit-exit](evidence/P6E-faults-sqlite-commit-exit.json)                   |
| 7. API 在任务期间重启   | 真实 Nuxt 运行中重启 API，静态站保持；若 Worker 保守退出则明确重启同任务核对                                                | 已通过：[api-restart](evidence/P6E-faults-api-restart.json)                                 |
| 8. 静态服务切换期间重启 | 在 current 替换后重启静态 Nginx，再继续原任务；最终必须 HTTP 与 DB 一致                                                     | 已通过：[static-restart](evidence/P6E-faults-static-restart.json)                           |
| 9. 恢复目标缺失/损坏    | 移走真实历史 Nuxt index.html；必须拒绝恢复，当前版本保持；测试后只还原原字节文件                                            | 已通过：[corrupt-history](evidence/P6E-faults-corrupt-history.json)                         |
| 10. 回滚与再次恢复失败  | B 激活后把专用发布根改为 0500，实际 EACCES 使恢复指针写入失败；再次恢复仍失败，阻断新任务；经显式修复权限/HTTP 后核对同任务 | 安全行为通过；发现旧错误摘要残留：[recovery-fails](evidence/P6E-faults-recovery-fails.json) |
| 11. HTTP 核验不可用     | 仅把 API verifier 指向同一私网服务的未监听端口，公开 HTTP 保持；必须恢复原指针并等待核验，不能伪报成功                      | 已通过：[http-unavailable](evidence/P6E-faults-http-unavailable.json)                       |
| 12. 磁盘空间不足        | 真实 Nuxt 运行后仅填满该 Worker 的 `/work` tmpfs，记录前后剩余值与内核 ENOSPC；旧站保持                                     | 已通过：[enospc](evidence/P6E-faults-enospc.json)                                           |

独立正常基线：[P6E-faults-baseline.json](evidence/P6E-faults-baseline.json)。构建期间的 tmpfs 空间故障与发布入队 507 容量门槛是不同测试，不互相代替。

真实超时任务由数据库记录的开始/完成时间相差 **600000ms**，控制器实际等待 **601970ms**。ENOSPC 精确计量复跑向专用 `/work` tmpfs 实际写入 **804552704 字节**，`statfs` 可用空间由相同值降至 **0**，内核返回 ENOSPC；没有填充宿主磁盘或业务卷。初次写调用计数报告另保留为 `enospc-measurement-before.json`，不计为第十三项。完整汇总见 [P6E-faults-summary.json](evidence/P6E-faults-summary.json)。

## 实测发现与后继补丁

`recovery-fails` 在同一任务经过两次真实 EACCES 后，正确阻断新任务（409）；操作员修复专用卷权限和验证服务后，原任务第三次领取，确认完整 B 版本与 HTTP 一致并成功。但是冻结的 `be5c968…` API 没有同时清空旧 `error_code/error_summary`，导致 `succeeded / activeVerified:true` 仍附带 `RECONCILIATION_FAILED`。这属于成功结果展示与数据库终态清理缺陷，不能将原证据改成没有该错误。后继补丁与专项 HTTP/DB 验证由主交付记录关联；本矩阵保留冻结镜像的真实结果。

后继 API 修复已提交为 **`aa23376bb508dad215e644c808dd2e9461d7170a`**。独立候选 `xiaowork-homepage-api:p6e-diagnostics-aa23376` 的实际 `docker image inspect .Id` 为 `sha256:e2d4e7a59e795b8528365b75d1ea9cf37e8d8676f3ff60691f2eb93f103869b3`，source label 完整匹配该 SHA；旧 API/Worker 标签均未移动。实际 [API 构建日志](evidence/P6E-api-diagnostics-build.txt) 与 [固定 SQLite 诊断器构建日志](evidence/P6E-data-diagnostics-build.txt) 已保存。

使用该 API 与冻结的 `be5c968…` 构建器另跑一次完整 EACCES 双失败场景，**专项通过**：[recovery-fails-postfix](evidence/P6E-faults-recovery-fails-postfix.json)。原任务 `job_a19902912e72eb7f52c38ba0b6fae7ba` 经过三次领取，最终 `succeeded / activeVerified:true / error:null`；SQL `error_code IS NULL` 与 `error_summary IS NULL` 均为 true；两条失败审计和一条成功审计同时保留，公开四路径均为 200。该证据是后继 API 补丁专项，不冒称十二项全套均已在新镜像重复，也不覆盖原失败诊断或原十二份 JSON。

另保留 `recovery-fails-harness-dependency-before.json` 和对应 `-recovery.json`：旧测试器使用 Compose start 间接启动只读故障卷的 init，测试器提前停止。定向重启相同 Worker 完成第二次实际失败后，仅修复测试权限和 HTTP verifier，原任务第三次核对成功；没有新建任务或改写任务/current。随后修正测试器为 `--no-deps` 且移除已完成的 checkpoint，完整重跑 canonical case 才计入矩阵。

## 人工核对与恢复

当状态为 `reconciling / recovery_required` 或 Worker 因控制面断线退出时，后续发布必须阻断。先记录原任务、current、manifest、receipt 及 HTTP，恢复可确认的磁盘权限/验证服务后，以相同受审镜像重启 Worker，等待原任务租约并检查原任务最终结果。不要创建新任务来掩盖旧任务，不要删除数据库或改写 current。

真实单机硬件损坏、断电时底层存储持久性、所有磁盘分区同时满、内核故障和跨主机网络分区不在本矩阵的通过范围。若完整性无法证明，继续保留人工恢复状态及正式发布关闭，不猜测恢复成功。

## 执行入口

`scripts/p6e-fault-tests.mjs` 仅接受固定 case 枚举，`scripts/p6e-fault-environment.mjs` 强制检查本机 Docker Desktop endpoint、固定 Compose 项目与卷标签。测试账户密码仅通过真正 PTY 安全初始化、只在进程内保留，不写命令参数、环境、日志或 Git。

实际运行需先从最终受审基础镜像构建 `scripts/fixtures/p6e-fault-worker.Dockerfile` 的 `worker-test`、`api-test`、`data-test` 三个测试 target，再执行各 case。不得对生产环境运行这些故障工具。测试控制器可通过固定本地 `.cache/p6e-fault-performance-hold` 标记暂停新任务以让独立 Lighthouse 测量；该标记不由 API 或 Worker 读取。

专项入口为 `node scripts/p6e-fault-tests.mjs recovery-fails --postfix-api`，仅允许通过 `P6E_TEST_POSTFIX_API_IMAGE` 选择 `xiaowork-homepage-api:p6e-diagnostics-<7位SHA>` 形式的本地候选标签；还须先准备同后缀的固定 data-test 镜像，用于直接验证 SQL NULL 和审计计数。此开关仅属于本机测试控制器，不在管理 API 或生产 Worker 中。

## 最终隔离环境收尾

验收完成后精确执行本项目 Compose `down`，未加 `-v`，未执行任何全局清理。[实际收尾记录](evidence/P6E-faults-cleanup.json) 确认本故障项目容器为 **0**、全部 **7 个命名卷保留**，清理前其他 **12 个运行容器仍在运行**。最终活动版本为 `rel_f6fd036f6abcaa951ddebc5be27c9673`，所有任务均已终结；发布根已恢复 0700，历史原 HTML 全部归还，没有遗留 `.p6e-held-index`。一个切换前 SIGKILL 留下的 `current.next.*` 现场仍保留在专用卷，不参与 current 路由，没有为了清理报告而删除。
