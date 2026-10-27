# P6-D 实现基线与验收入口

日期：2026-10-27，分支 `feat/v1.1-admin-p6a`。这是固定构建源码的中间交付，最终结果见随后生成的 `P6D-delivery.md`。

## 范围与当前状态

已实现白名单不可变快照、schema 3 增量迁移、认证任务 API、受限 UDS Worker、离线固定 Nuxt 构建、完整产物校验、原子 current、HTTP/数据库对账、私有预览及同构建器内容恢复。Vue 后台接入真实任务/历史/确认/再认证流程。

发布能力默认关闭。唯一可启用的环境为 localhost HTTPS 独立测试栈；配置正式管理 origin 时无法开启本地发布 gate。V1.0 正式部署文件、服务器、OpenResty、DNS、main 均未修改。

## 修改文件

- `backend/internal/publishmodel`、`publishdata`、`publishfs`、`publishworker`、`cmd/homepage-worker`：快照、固定构建、封存、切换、恢复。
- `backend/internal/httpapi/publication*`、`worker_socket*` 与 `migrations/003_publication_details.sql`：鉴权、任务、引用、独立证明、对账。
- `shared/publication*`、`shared/content.ts`、Nuxt 页面/数据/SEO：构建期快照和版本化资源，保留无快照模式的 V1.0。
- `admin/src/pages/PublishingPage.vue` 等：真实发布界面，不能把排队显示成发布成功。
- `compose.admin-publish.yaml`、`backend/worker.Dockerfile`、`deploy/admin-publish`、`scripts/publishing-*`：独立回环 HTTPS/持久化/隔离和验收。
- `package-lock.json`：兼容更新 node-forge 1.4.0 → 1.4.1；无强制升级。

## 已运行检查

- 冻结后 Linux Go 全包测试与 `go vet` 退出 0；包含真实 HTTPS、SQLite、文件系统、UDS 和进程崩溃边界测试。故障测试使用 fixture 的部分不能称为真实 Nuxt 全链测试。
- 128KiB 专用 tmpfs 实际 `ENOSPC`：旧 A 的 current 及所有哈希保留，B 未激活。
- 管理界面 lint、TypeScript、34 项测试及 Vite 生产构建通过。
- 本轮根 npm、admin npm 审计均为 0；Go symbol/package 0，module 1 为未导入的 openpgp `GO-2026-5932`，没有兼容修复。

## 剩余验证与风险

此提交用于获取真实源码 SHA 后重建 Worker，尚不能将待执行的完整浏览器发布/预览/恢复与 Docker 重建验收标为通过。最终证据将单独提交。真实 Nuxt 构建中断、全部在途容器崩溃及离线备份恢复等仍须区分分层测试和端到端验收。

内容恢复要求源码 SHA、构建器镜像 ID、schema 一致，不支持跨代码/镜像升级自动恢复；成功 release 不自动清理，需监控磁盘。错误摘要脱敏，构建诊断较粗。生产旧镜像没有因本地依赖更新而修复，原公网发布门槛继续保留。

## 下一步与 Git

提交本基线后按其完整 SHA 重建隔离镜像，执行 `npm run publishing:e2e`，据实生成最终 P6-D 交付、故障矩阵、截图及 HTTP/SEO 证据。当前文件自身 SHA 和推送状态以 Git 与最终回复为准，不写入待提交文件形成循环。
