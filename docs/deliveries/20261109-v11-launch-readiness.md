# V1.1 上线准备：c81af02 发行组验收与上线脚本

- 日期：2026-11-09（Asia/Shanghai）
- 执行者：独立审查 Agent（Claude）
- 用户决定：异地备份上线后再补；生产机上的 Node 使用专用目录的官方包；切换上游前停下，等用户确认。
- 结论：c81af02 发行组的**完整验收全部通过**，上线脚本和操作手册已就绪。**正式影子部署尚未执行**：执行时被 Claude Code 的权限审查（生产部署类）拦下，服务器上没有留下任何改动，需要用户决定执行方式。

## 1. 发行组

| 角色        | 镜像 ID（前 12 位） |
| ----------- | ------------------- |
| api         | `4d174e6c4649`      |
| worker      | `4ebbac7fe51a`      |
| gateway     | `3b0509178d92`      |
| frontend    | `6912ba88fc98`      |
| static      | `81657cf5e11e`      |
| maintenance | `3f64046d0e7a`      |

- 源码：`c81af02da2c40104804cba33fd0146de3dd0980b`，与 61b7b32 相比只有后台文案修复（6 个文件）。
- 构建方式与 61b7b32 相同；源码归档的 SHA256 前 16 位为 `a57fb00d69f0ee0d`。
- 网关镜像中，新文案（"读取会话""无需填写""核对并发布后"）已经存在，旧文案（"后续发布阶段""后续静态渲染器"）已经清零；61b7b32 镜像恰好相反。
- 宿主工具测试 46/47：唯一失败的是已知过时夹具"完整离线保护"，在 61b7b32 上同样失败，与本次改动无关。

## 2. 完整验收

| 链路                                                            | 项目           | 结果                                                                      |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| 端到端 / 并发                                                   | rc7 simulation | **23/23**、**4/4**                                                        |
| 备份 → 全新空卷恢复 → 一致性                                    | rc7 → rc7r     | 233 个文件；**13/13**                                                     |
| 跨版本：61b7b32 → c81af02 → 回退 → 再更新                       | rc5 simulation | 3 次都成功，在线核对 **13/13 ×3**，屏障 ready                             |
| 生产 gate 全流程（含更新到 61b7b32 后自动关闭、回退后重新授权） | rc6 openresty  | closed 2/2、flow 17/17、revoked 3/3、reopened 2/2 ×2、after-update 3/3 ×2 |
| B6 真实客户端地址 / 内部伪造 `X-Real-IP`                        | rc6 openresty  | **15/15** / 通过                                                          |

**一次时序失败（rc4，非产品缺陷）**：

- 现象：部署和导入刚结束时立即开始 E2E，预览请求返回 503 WORKER_UNAVAILABLE。
- 原因：Worker 每 2 秒轮询一次，但导入刚结束的那几秒里维护屏障还没恢复，Worker 的领取请求被返回 MAINTENANCE_REQUIRED，API 因此还没有记录到心跳。
- 处理：rc4 已停止（数据卷保留），换用新项目 rc7、部署后等待 60 秒再测，全部通过。
- 影响：正式部署后的前几秒内，后台的预览和发布按钮可能提示构建服务不可用，属于正常现象。

验收结束后 rc4～rc7 都已停止，数据卷保留，没有残留锁。机器结果保存在 `.cache/v11-independent-review/rc/c81af02-results.tar.gz`。

## 3. 上线准备

- **现网核对（只读）**：
  - V1.0 是 `xiaowork-homepage-web-1`，监听 `127.0.0.1:3100`。
  - 切换点是 `/opt/1panel/www/sites/xiaoworks.com/proxy/root.conf` 里的 `proxy_pass`；该文件已经设置 `X-Real-IP $remote_addr`。
  - xiaoworks.com 没有经过 Cloudflare 代理（响应里没有 `cf-ray`），所以按 IP 限速时拿到的是访客的真实地址。
  - OpenResty 1Panel 容器使用 host 网络，`openresty -t` 可用。
  - 3110/3111 端口和 `192.168.240.0/28` 网段空闲。
- **上线脚本**：放在 `deploy/v11-production/`，包括：
  - 影子部署：`prod-setup.sh`；
  - 每日本地备份：`v11-backup.sh` 及 systemd service/timer；
  - V1.0/V1.1 内容比对：`compare-v10-v11.py`；
  - 切换与自动回退：`cutover.sh`；
  - 一键切回 V1.0：`rollback-v10.sh`。

  新增 `scripts/v11-production-scripts.test.mjs`（4 项），检查脚本语法和以下安全约束：切换前必须确认当前上游是 V1.0、先保存原配置、任一核验失败就自动回退、备份脚本不删除任何文件、影子部署不涉及 OpenResty。

- **操作手册**：[V1.1 正式上线操作手册](../V1.1-PRODUCTION-LAUNCH.md)。

## 4. 正式影子实例（用户批准后执行）

1. **部署**：项目 `xiaowork-homepage-v11-prod`（openresty 拓扑，c81af02）。
   - 4 个服务健康，网关只监听 `127.0.0.1:3110`。
   - 内部隔离网络从默认池分到 `192.168.16.0/20`；固定网段为 `192.168.240.0/28`，edge 为 `.16/28`。
   - 第一次执行时，生命周期工具拒绝了不带后缀的项目名 `xiaowork-homepage-v11`，当时没有创建任何资源；改名后修正提交为 `12d380c`。
2. **管理员**：由用户本人在交互式终端设置，用户名 `xiaowork`，密码不经过 Agent。
   - 第一次尝试超过了命令内置的 2 分钟时限（`context deadline exceeded`），没有写入账号；第二次成功。
3. **导入 V1.0 内容**：成功，3 个项目、3 个分类，payload SHA256 前 16 位为 `841fbca75e7cc57e`。
4. **与线上 V1.0 比对**（`Host: xiaoworks.com`）：
   - `/`、`/projects/`、`/about/`、`/robots.txt`、`/sitemap.xml` 的标题和可见文本**完全一致**（`CONTENT_IDENTICAL`）；
   - 三个页面引用的 23 个资源在 V1.1 上全部返回 200；
   - `/admin/` 返回 200，会话接口返回 401；
   - 正式发布 gate 保持关闭（publish mode=off）。
5. **每日本地备份**：
   - 已安装 `xiaowork-homepage-v11-backup.service` 和 `.timer`，每天 UTC 19:30 运行，随机延迟最多 10 分钟；
   - 手动试跑成功，备份目录 `20261109T085452Z`，权限 700，大小 372K；
   - 试跑后屏障 ready、没有锁，后台返回 200。
6. **影响核对**：
   - OpenResty 主配置哈希不变，`root.conf` 仍指向 `127.0.0.1:3100`（V1.0）；
   - xiaoworks/blog/nav/erp/dav/jijian 返回 200，inbox 返回 302，xiaoworks.com/admin/ 仍是 V1.0 的 404；
   - 非测试容器与 2026-11-08 的基线一致，只多出一个遗留探测容器，见下一条。
7. **遗留探测容器 `youthful_haibt`**：
   - 来源：Agent 检查网关镜像时启动的临时容器（测试镜像 `xiaowork-homepage-v11-test-gateway:c81af02da2c4`，带 `--rm`）。它对整个文件系统执行 grep，包括 `/proc`，所以一直没有结束；当时只停掉了本机的 SSH 会话，没有停掉服务器上的容器。
   - 资源占用：约 2% CPU、不到 1 MiB 内存，与业务无关。
   - 现状：Agent 尝试停止时被权限审查拦下，等待用户处理（`docker stop youthful_haibt`）。

## 5. 正式切换（2026-11-09 09:00 UTC，用户确认"切换"后执行）

- **执行**：`cutover.sh`。
  - 原配置保存为 `/opt/xiaowork-homepage-v11/release/root.conf.v10-20261109T090014Z`（SHA256 前 16 位 `4990719062b38c90`）；
  - `root.conf` 中的 `proxy_pass` 从 `127.0.0.1:3100` 改为 `127.0.0.1:3110`；
  - `openresty -t` 通过后平滑重载，没有停机。
- **服务器本机核验**：`/`、`/projects/`、`/about/`、`/robots.txt`、`/sitemap.xml`、`/admin/` 返回 200，会话接口返回 401，输出 `CUTOVER_OK`。
- **外网核验**（从 Agent 所在电脑访问 `https://xiaoworks.com`）：
  - 结果同上；
  - `/admin/` 带有 CSP（`default-src 'none'`）、`X-Content-Type-Options: nosniff` 和 HSTS；
  - 切换后 3 分钟内网关没有 5xx 错误。
- **真实客户端地址**：生产网关只信任 `192.168.240.16/28`（edge 网关 `.17`）传来的 `X-Real-IP`，OpenResty 用 `$remote_addr` 设置这个请求头。网站没有经过 Cloudflare 代理。
- **影响核对**：
  - blog/nav/erp/dav/jijian 返回 200，inbox 返回 302；
  - V1.0 容器仍在运行且健康（`Up 2 weeks`），作为回退目标；
  - 切换后再次比对 V1.0 和 V1.1，仍然 `CONTENT_IDENTICAL`。
- **回退**：`bash /root/v11-launch/rollback-v10.sh`，用保存的原配置恢复并重载。

## 6. 未完成 / 需要用户处理

1. 停止遗留探测容器 `youthful_haibt`（Agent 尝试时被权限审查拦下）。
2. **后台发布默认关闭**：要从后台发布新内容，先执行 `v11-release.mjs backup`，再执行 `authorize-publishing`（手册第 6 节），需要用户另行授权。
3. 异地备份和告警：按用户决定，上线后再补。目前只有服务器本机每日备份，需要定期查看 `/opt/xiaowork-homepage-v11/logs/backup-status.log`。
4. 合并 main：当前线上运行的是 `feat/v1.1-admin-p6a` 上的 c81af02，main 仍是 V1.0 的 `14f9b1f`，需要用户另行决定是否合并。
5. 测试目录 `/opt/xiaowork-homepage-v11-test` 中的测试项目数据卷、镜像和锁现场都保留着，清理需要另行批准。

本文件是文档提交；`deploy/v11-production/` 与测试属于运维脚本，不改变运行镜像。
