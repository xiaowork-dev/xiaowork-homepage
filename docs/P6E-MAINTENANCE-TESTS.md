# P6-E 共同维护屏障专项验收

日期：2026-11-01。范围是本轮新增共同协议，不是重复 P6-E 阶段交付。原生 Linux 完整链未执行，正式发布 gate 保持关闭。

## 实际执行与身份

控制器是 `scripts/p6e-maintenance-barrier.mjs`，用离线 vendor 副本构建当前 Go 测试二进制。`go mod verify` 实际返回 `all modules verified`；没有关闭 TLS 或下载未知依赖。运行环境为 Docker Desktop 的 Linux 内核，非 root、只读根、drop ALL/no-new-privileges、network none、CPU 2、内存 4 GiB、pids 256，工作/tmp 为独立有界 noexec tmpfs。

```powershell
node scripts/p6e-maintenance-barrier.mjs r8
node scripts/p6e-maintenance-barrier.mjs r9 focused
node scripts/p6e-barrier-host-test.mjs <r8测试镜像完整ID> r1
node scripts/p6e-barrier-quality.mjs
node scripts/p6e-barrier-environment.mjs
```

命令与原 stdout/stderr、退出码、实际镜像 Inspect、逐文件源码 SHA、任务/current/产物 SHA 见 [r8](evidence/P6E-barrier-r8.json)、[r9](evidence/P6E-barrier-r9.json)、[宿主 r1](evidence/P6E-barrier-host-r1.json)、[质量与依赖](evidence/P6E-barrier-quality.json)、[环境](evidence/P6E-barrier-environment.json)。控制器不覆盖既有证据；测试容器、控制卷和失败保护状态保留。

测试镜像复用已审查 4f18 Worker 的固定 Node/Nuxt 依赖，运行**本轮新编译的 Go Runner/API**。标签明确为 `unfrozen-maintenance-tests` 和 `io.xiaowork.p6e.test-only=maintenance-barrier`。实际任务使用测试 source/builder 值；这些值及派生镜像不是正式发行身份，不进入六角色 manifest。真实 Nuxt generate 由固定 `FixedBuilder` 执行；等待点只存在于 `_test.go`，不进入 Go 正式入口。首次测试在空公开版本上进行，不能据此声称新六角色 A→B→A 已验收。

## 用户要求的专项矩阵

| 场景                          | 实际方法和结果                                                                                                                          | 证据                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 发布与维护同时到达            | 8 轮真实可信 HTTPS 与独立维护进程竞争；只接受封门前的 202，或 503；任务数与 HTTP 结果相符。封门后新请求及 UDS Claim 均 503              | r8 `TestMaintenancePublishArrivalRace`                 |
| 已准入但 SQLite 尚未可用      | 实际占用唯一数据库连接，确认 HTTP 已等待连接；维护停在 draining；释放连接后原请求 202、事务提交，维护才 drained；后来请求 503           | r9 `TestMaintenanceWaitsForAdmittedHTTPTransaction`    |
| 屏障建立、API 仍在线          | publish/preview/rollback 均返回结构化 503/MAINTENANCE_REQUIRED，healthz 仍 200；不是停 API 的 502                                       | r8 `TestMaintenanceHTTPOnlineDenialRestartAndRecovery` |
| Worker 构建中开始维护         | 当前 Runner 独立进程持租约，实际离线 Nuxt 构建、校验、激活和 DB 结果成功后维护才 drained                                                | r8 `...ActualWorkerDrainsBuildAndActivation/building`  |
| 即将切换 current              | 私有 Prepared 返回后、原子激活前暂停；维护停在 draining；放行后真实激活、HTTP 核对、任务 succeeded，维护才完成                          | r8 `.../activating`                                    |
| 父控制器 SIGKILL              | Linux 独立进程及实际 Node protectedChain 进程强杀；持久状态保留，新进程 Enter/Continue 及宿主 backup 拒绝                               | r8 gate、宿主 r1 controller-kill                       |
| 父监督进程退出                | 实际进程 exit 47；宿主 operation.lock、marker 与共享控制卷 owner 一致并保留；新请求准入被拒绝                                           | r8 gate、宿主 r1 supervisor-exit                       |
| API/Worker 分别重启           | 两次 fork/exec 新 API 进程，真实可信 HTTPS 503、health 200；两次新 Worker Runner 进程没有 Claim；完成核验后同一 API 的 Session 返回 200 | r8 `...APIAndWorkerExecRestart`                        |
| 带 recovery-required 恢复服务 | 运行端仅以 RO 卷读取持久状态；不依赖原宿主进程活着，新进程继续拒绝                                                                      | r8、宿主 r1 的 PERSISTENT_BARRIER_PROOF                |
| 控制目录不可读/缺失/损坏      | 非 root 目录 0000、路径不存在、坏 JSON：真实 HTTPS 与私有 Claim 均 503；SQLite 仍仅原 queued 任务、current 未改变                       | r9 `...ControlAccessFailure`                           |
| 控制文件攻击/未知状态         | 缺失、未知字段、符号链接、硬链接、未完成 state.next 全部拒绝；未降低校验                                                                | r8 gate 子用例                                         |
| 正常维护完成                  | 只有全外层断言通过后控制状态 ready、宿主保护正常释放；真实 Session 200、preview 创建 202                                                | r8、宿主 r1 normal-completion                          |
| 外层断言失败                  | 真实 Node 抛出专用元数据断言错误，宿主与共享状态均保留；后续 backup 与新运行进程拒绝                                                    | 宿主 r1 outer-assertion-failure                        |
| 真正 RO 挂载上的文件锁        | Docker readonly+volume-nocopy 控制卷：O_RDONLY flock 可准入，Begin/文件写入被内核 RO 拒绝                                               | r8、r9 RO_KERNEL_PROOF                                 |

Go 包级内核锁用例不含 HTTP/SQLite，因此相应字段不适用；HTTP 专项实际记录任务、current、产物 SHA 和进程，r9 增加 `/proc/locks`。本轮没有以普通 fixture 构建代替实际 Nuxt 两个并发场景。包回归覆盖其他固定产物夹具，但只计其自身范围。

## 失败记录（保留）

- 初次 Docker 依赖下载因异常证书（`safebrowsing.hinet.net` 与 proxy.golang.org 不符）被 TLS 拒绝；无网尝试也失败。改用本机已验证缓存生成的离线 vendor；没有禁用验证。另一次 Go 命令工作目录错误、一次 PowerShell 内联 Node 引号错误属于控制器调用错误，不属于产品测试通过。
- [r3](evidence/P6E-barrier-r3.json)：测试镜像漏放 seed/cwd 不符，尚未进入业务断言。
- [r4](evidence/P6E-barrier-r4.json)：临时目录未显式设置 0700，严格权限检查正确拒绝。
- [r5](evidence/P6E-barrier-r5.json)：临时容量 384 MiB 不满足既有 512 MiB 安全门槛，真实 HTTP 507；另有 UDS 目录权限夹具错误。修正测试资源和目录，不改产品阈值。
- [r6](evidence/P6E-barrier-r6.json)：**产品实现错误**，`fmt.Errorf("%w: %v", ...)` 丢失底层 errno，`errors.Is(EWOULDBLOCK)` 失败，维护在竞争时提前报错。状态仍 draining、后续发布被拒绝。修正为保留两层错误链，增加“必须等待共享租约完成”回归；[r7](evidence/P6E-barrier-r7.json)首次全通过，r8 在包含宿主持久卷探针的最终测试镜像上再次通过。
- 本轮没有删除上述失败 JSON、旧 chain3/chain4 证据、旧故障卷或未知锁。
- 收尾还发现 **maintenance Dockerfile 的目录初始化问题**：把空目录内容 COPY 到新 `/control` 会得到实际 `0755/10001/10001`，严格初始化 exit1。改为在 build 阶段建立 `/mounts/control` 并 chmod700，再随父目录整体 COPY。独立 scratch 探针真实 stat 为 `0700/10001/10001`、初始化 exit0；[原失败和修正证据](evidence/P6E-barrier-control-directory.json)完整保留。此后仅该 Dockerfile 目录准备发生变化，Go 核心保持 r8/r9 已测字节；这项探针不冒充正式六角色构建。

## 限定与下一步

已通过当前 Go 核心及专项测试镜像的协议验收、HTTP/Worker 包回归、go vet、宿主控制器 4/4、ESLint/Prettier 和当前四个 Linux Go 入口 source 漏洞扫描。npm 实扫仍根 37 moderate/2 low、后台 9 moderate，exit 1。4f18 Worker 的 10 MEDIUM 等 Scout 是旧正式组结果，不能当作新源码镜像扫描。

**未执行**：原生 Linux Engine 完整修复→备份→空卷恢复→跨源码升级/回退→内容恢复链；新正式六角色冻结/构建及新组 A→B→A、浏览器/全部运行权限扫描；宿主/Daemon 整体重启、断电，Firefox/WebKit/Safari、真机和完整渗透。进程重启专项通过不扩大为断电测试通过。

独立 Linux 安装及系统服务变更等待用户授权，见[准备方案](V1.1-LINUX-ACCEPTANCE-ENV.md)。严格 bind 身份校验保持，当前不具备正式上线条件。
