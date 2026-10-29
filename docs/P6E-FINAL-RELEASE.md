# P6-E 最终六角色发行身份

更新：2026-10-29。当前统一候选运行源码为 **`9887f6d456c5cdde79ec0689480684f905b7db2a`**，Schema **3**、manifest **1**。六角色已从该完整源码重新构建并完成镜像安全扫描，但**尚未通过整体验收，不具备正式发布条件**。完整六个镜像 ID、构建参数、源码归档 SHA256、基础镜像与 Schema 核对见 [本轮候选机器清单](evidence/P6E-ro-runtime-manifest.json)。没有把 817 组或后继单镜像混成新发行组；固定 builder identity 应使用本轮清单中的 Worker 精确镜像 ID。

选择该候选是因为它包含只读 SQLite 受控副本视图、WAL 完整性检查、错误分类和失败留锁等运行修复。后续控制器及文档提交不冒称运行镜像源码已经变化。新组的 Scout/source/binary 实测见 [安全复核](evidence/P6E-ro-security-audit.json)：六角色 0 critical/high/medium，deepmerge low、musl 与 Go 模块未定级告警保留；这不是整个系统零风险或生产放行的结论。

### 当前阻塞与停止范围

真实六卷全 RO 的第二次矩阵在 `stable` 场景实际运行维护器，`inspect-current` exit **0**，重复计划完全一致，已不再返回原来的 SQLite 14 / Schema 误报。但严格前后核对发现**六个卷根目录 atime 发生变化**，所以整个只读矩阵仍为 **FAIL**。只读检查期间 **332 个文件的 SHA256、数据库文件全部元数据保持一致**；不能以此忽略目录元数据要求，也不能在原因未被证明前判断一定是产品故障或夹具问题。原始第一轮与第二轮失败记录均保留：[首次控制器失败](evidence/P6E-ro-readonly-matrix.json)、[第二次真实只读结果](evidence/P6E-ro-readonly-matrix-r2.json)。

按用户门槛已停止后续自动修复尝试：**未执行 apply、未删除候选链接**；其他 WAL/权限/损坏/Schema 矩阵场景、本轮修复后备份→空卷恢复→更新/回退链、正常预览/发布与关键故障 acceptance 均为 **NOT_RUN**，不能引用下方 817 历史通过项替代。新测试卷、原故障卷和现场保留；后续需先只读定位根目录 atime 变化的来源，再取得可验证的完整只读结果。

本轮没有连接生产、没有修改 1Panel/OpenResty/Cloudflare/DNS/TLS 或 V1.0 数据，未合并 main、未开启正式发布 gate。即使最终消除本次阻塞，生产切换仍需独立授权及既有运维/风险门槛。

## 817 历史发行组（以下原记录保留，不计入新候选通过证据）

冻结源码：`817aa533741bdd5de23f322fa5e5171442cb28a9`，Schema **3**、内容 manifest **1**。选择该提交是因为它同时包含 aa23376 的成功对账诊断修复、可审计的 current.next 单对象离线修复、跨源码停写数据摘要和逐资源 HTTP 校验。它是本轮实际重建的运行身份；后续测试控制器、证据和文档提交不冒称镜像源码。

全部角色来自该提交的同一个全新 Git archive，归档 SHA256 为 `62368afa2f44279596524a51d29bf59ff850ee20ba9977b2ae16b0cfbf55d7bf`。没有重贴历史标签或混入 be5c/aa23376 镜像。

| 角色               | 最终镜像 ID                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| API                | `sha256:c2e26df316318302033b9242f4dbdf77e28f36d63a21a6c85f1f1a821998608f` |
| Worker             | `sha256:bcfd13bfaff393e74d6670d34914b46c5943d3d0e57e0b89a4b65a0d41e52f2c` |
| gateway            | `sha256:5823b6d04c8dfd3dd55c8496be374935c6ceff8f648725d7f6fd746f6aa651d9` |
| legacy frontend    | `sha256:7d05e7e749c8ff96ec3b6e92d2143ba5a01f0e0b05f1dbcf506129621245dba3` |
| publication-static | `sha256:457665bb4f876c8720cbca2e4a3267238c0c16cce286362c1e1ae053b99bae60` |
| maintenance        | `sha256:4b07bde81bc577362ffab2176dd780a20fb5a2c5c3edc4d5a35dce1a68703dab` |

精确 tag、所有构建参数、起止时间、基础镜像 ID/digest、Docker/Compose 版本与 Schema 实际检查见 [机器清单](evidence/P6E-final-runtime-manifest.json)。构建平台 linux/amd64，`VCS_REF` 为上述完整 SHA，前台生成 origin 为 `https://xiaoworks.com`；运行任务的 builder identity 是上述 Worker **实际镜像 ID**，不把构建标签 `xiaowork-nuxt-p6d-v1` 当作实际 digest。

## 可复核的命令与失败记录

```powershell
node scripts/p6e-final-build.mjs 817aa533741bdd5de23f322fa5e5171442cb28a9
node scripts/p6e-final-fixtures.mjs
node scripts/p6e-final-acceptance.mjs admin
node scripts/p6e-final-acceptance.mjs publishing
node scripts/p6e-final-acceptance.mjs fault <固定允许的case>
node scripts/p6e-final-public-browser.mjs
node scripts/p6e-final-production-preflight.mjs
```

首次 Go 模块下载遭遇证书域名不匹配，保留 [失败日志](evidence/P6E-final-build-api-first-attempt.txt)；第二次在新 archive 目录使用历史已验证的 `GOPROXY=https://goproxy.cn`，保持 TLS、go.sum 校验和固定依赖，六角色成功。各角色构建输出为 `P6E-final-build-<role>.txt`。

测试覆盖层最初误将纯 `sha256:` ID 用于 Dockerfile FROM，Docker 将其解释为远程仓库。正式六角色已经构建成功；随后仅将测试覆盖层 FROM 改为事先核对 ID 一致的新独立 tag，重新构建通过。三种 `p6e_fault` 专用测试镜像单列在 [夹具身份](evidence/P6E-final-test-fixtures.json)，不进入最终发行描述符。正式 Dockerfile 上下文排除故障入口，普通二进制未带测试 build tag。

运行边界见 [最终容器核对](evidence/P6E-final-runtime-boundaries.json)：非 root、只读 rootfs、drop ALL、no-new-privileges，Worker 无网络、数据库、Session、SSH/GitHub 凭据和 Docker Socket。maintenance 仅作为无网受限一次性工具运行；只有隔离测试网关回环端口映射，没有公网后台。

## 验收与发布边界

**最终验收为部分通过，817组不能直接生产发布。** 十二真实故障与正常基线通过，但实际`current.next`修复在严格只读SQLite计划阶段失败；相同驱动对WAL模式主库无WAL/SHM的RO挂载查询报14错误，原库和链接未改。修复后备份/恢复/更新未执行。见 [实际失败](evidence/P6E-final-current-repair.json)、[独立副本根因复现](evidence/P6E-final-current-readonly-probe.json)。后继不能仅换maintenance后继续声称本六组全部通过。

正常预览/发布/同源码内容恢复：[真实发布浏览器](evidence/P6E-final-publishing-browser.json)。管理、认证、数据持久化及五宽度双主题：[管理浏览器](evidence/P6E-final-admin-browser.json)。最终组六角色完整一致性备份与全新空卷启动：[恢复证据](evidence/P6E-final-backup-recovery.json)。不同源码更新及回退见 [专项报告](P6E-CROSS-SOURCE-ACCEPTANCE.md)，残留链接见 [离线修复流程](V1.1-CURRENT-REPAIR.md)。故障最终状态以 [故障矩阵](P6E-FAULT-TESTS.md) 和 [阶段交付](deliveries/P6E-delivery.md) 为准。

生产仅做 [本地方案渲染断言](evidence/P6E-final-production-preflight.json)。13210 只是示例回环端口，不代表德国服务器已分配。Worker 默认关闭、正式发布 gate 关闭，未连接生产、未合并 main。工程验收不构成正式上线授权；真实资料范围、异地备份/密钥与告警责任、生产拓扑/TLS/源站保护仍需另行确认。
