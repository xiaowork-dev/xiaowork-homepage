# P6-E 最终六角色发行身份

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
