# P6-E 独立 Linux 环境交付：安装前资源门槛受阻

日期：2026-11-02，Asia/Shanghai。分支：`feat/v1.1-admin-p6a`。状态：**预检部分完成，未开始安装；尚不满足 P6-E 完整验收的环境前置条件。**

## 目标与授权范围

用户已明确授权在 `D:\WSL\XiaoWork-P6E` 安装独立 Ubuntu 24.04 LTS WSL2，并仅在新发行版内安装原生 Docker Engine、Compose 和必要依赖。本轮限于环境准备、Daemon/Socket 身份证明和无业务数据的最小挂载验证，不包括六角色构建或完整 P6-E 测试链。

按[环境准备方案](../V1.1-LINUX-ACCEPTANCE-ENV.md)，安装前必须确认目标路径、资源与命令支持；资源不足或有冲突时停止。本次授权仍有效，阻塞原因不是缺少安装许可。

## 实际预检结果

| 项目             | 真实结果                                                                                                     | 结论                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| D 盘目标         | `D:\WSL`、`D:\WSL\XiaoWork-P6E` 均不存在，收尾时仍不存在                                                     | 无路径冲突，未创建目录                                 |
| 磁盘             | D 盘可用 `229549596672` 字节，约 213.8 GiB；C 盘可用约 365.2 GiB                                             | 满足约 80 GiB 规划                                     |
| CPU / 总内存     | 16 个逻辑处理器；物理内存 `16855646208` 字节，约 15.7 GiB                                                    | 总容量有记录，不等于当前资源充足                       |
| 初次可用物理内存 | Node/Windows 报告 `475922432` 字节，约 454 MiB                                                               | 不足，进入独立内核接口复核                             |
| 内核复核三次     | `1445441536`、`1598279680`、`1306038272` 字节，约 1.35、1.49、1.22 GiB；间隔 5 秒，占用率 90%～92%           | 仍低于准备方案的 4 GiB 验收预算，停止安装              |
| WSL              | 3.0.3.0，内核 6.18.54.1-1；仅 `docker-desktop`，WSL2，运行中                                                 | 未创建或更改发行版                                     |
| 安装选项         | 本机 help 包含 `--location`、`--name`、`--no-launch`、`--version`、`--vhd-size`；在线列表包含 `Ubuntu-24.04` | 命令支持已核对；help 的原始 exit `4294967295` 单独保留 |
| 计划端口         | 3228、3461 未发现监听                                                                                        | 未绑定端口或创建测试服务                               |
| Docker Desktop   | 29.8.2，context `desktop-linux`，Daemon ID `960fce9c-a763-42d0-b849-fc1f38473b89`                            | 仅作既有环境基线，不是新原生 Engine                    |
| 既有容器         | 140 个，初查 25 个运行；前后全部容器的 ID/镜像/状态规范化清单 SHA256 相同                                    | 未操作现有容器，未清理任何卷                           |

4 GiB 是仓库方案中的验收任务资源预算，**不是声称 Ubuntu 官方安装最低要求**。本次不能证明在当前内存压力下启动新环境不会挤压现有服务，因此依据用户要求与方案停止。约 6 GiB 的剩余提交额度包含页面文件，不能当作充足物理内存的证明；没有调整页面文件、WSL 全局配置或现有服务来通过门槛。

## 命令、证据与异常分类

实际只读执行：

```powershell
wsl.exe --version
wsl.exe --list --verbose
wsl.exe --help
wsl.exe --list --online
docker context show
docker context inspect --format '{{.Endpoints.docker.Host}}'
docker info --format '{{json .}}'
docker ps -a --format '{{json .}}'
Get-NetTCPConnection -State Listen
Get-Service WslService
```

内存使用 Windows `kernel32!GlobalMemoryStatusEx` 复核，三次采样均成功，保留物理内存、可用物理内存、占用率、提交额度与 UTC 时间戳；解释和本地原始文件 SHA 见[机器证据](../evidence/P6E-linux-install-preflight-20261102.json)。初次受限 shell 的 WSL/Docker/CIM 访问错误与真正资源不足分开记录：使用已授权的提升权限仅复核读取后，WSL/Desktop 查询成功；没有将沙箱权限错误当成发行版安装失败。

`wsl --help` 输出完整参数但返回 unsigned -1；如实记录，不将其当作安装成功。`--version`、`--list --verbose`、`--list --online` 及收尾的 Desktop 命令均 exit0。只读复核控制器也 exit0，表示收集成功；业务结论仍为 `BLOCKED_AVAILABLE_PHYSICAL_MEMORY`，不是环境验收通过。

全量容器标签含其他本地项目资料，不进入本交付；只记录容器 ID/镜像/状态清单的聚合 SHA 和数量。该哈希不声称证明全部容器配置逐字节不变。初始及收尾哈希均为 `5a00e5c66dd3562cc082d131e9db9c0c64cc7de17170346fc27d91a2bdec9d13`。

## 安装与测试状态

- Ubuntu 安装：**未执行**；没有运行 `wsl --install` 或 `wsl --import`。
- 原生 Docker Engine、Compose：**未安装**，没有可报告的新 Engine 版本或资源占用。
- Linux 测试源码、备份目录、独立网络：**未创建**。
- 新 Daemon、Unix Socket、Linux ext4 与 bind Source 身份：**未执行**。
- 最小 Docker 挂载验证：**未执行**，不能以 Desktop 代替。
- 六角色构建、完整链、业务数据、正式发布 gate：**均未触及**。
- 没有连接生产、修改 Desktop 默认 context/其他发行版、终止现有进程、改变系统服务、删除故障卷或执行全局清理。

## 修改文件、Git 与下一步

本次仅新增本交付与机器证据，并更新 `docs/PROGRESS.md`、既有 P6-E 交付、环境准备方案和生产检查清单；没有修改运行代码、依赖或镜像。起始 Git HEAD 为 `dc88634995691f388504aeb172c2530f000763d0`，共同屏障运行源码仍为 `c7edb2f7d23cdecaf493370d8d62446907c67e67`。本次文档提交与推送结果以最终 Git 核验及用户汇报为准，不在同一文件循环写入自身提交 SHA。

后续由用户释放闲置应用内存；在当前可用物理内存达到 4 GiB 预算且留有宿主余量后，重新执行只读预检，再沿用本次授权继续安装。不能通过停止受保护业务、修改全局 WSL 设置或使用德国服务器绕过资源阻塞；本次安装范围无需重复申请授权。

安装、Daemon 独立性和最小挂载实际通过后才能声明环境就绪。**本轮不申请六角色构建或 P6-E 整链测试，也不申请正式上线。**
