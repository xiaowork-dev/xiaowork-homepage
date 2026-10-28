# P6-E 专项：成功对账清理当前错误诊断

日期：2026-10-28（Asia/Shanghai）。分支：`feat/v1.1-admin-p6a`。

状态：源码修复和专项回归已完成；独立 API 候选及真实 Nuxt 故障复测另行记录于 P6-E 总交付，不能以本记录代替全栈最终镜像验收。

## 问题与修复

冻结运行基线 `be5c96857c5a7098a9b8f80931ced47d0efcab89` 在两次恢复失败后能正确阻断新发布，修复外部条件后原任务也能成功对账，但成功任务仍带旧 `RECONCILIATION_FAILED`。原始故障证据保留，不将它改成无缺陷。

`backend/internal/httpapi/publication_worker.go` 在成功的同一 SQLite UPDATE 内清空 `error_code/error_summary`。失败和待核对分支仍保留诊断，审计事件继续追加，既有失败审计不删除。

## 实际验证

- 新增 Linux 专项两例：真实 HTTPS、SQLite、生产 UDS 客户端和 HTTP 核验；两次实际 503 后重领同一任务并成功，验证 DB NULL、API `error:null`、`activeVerified:true`，并保留两条失败审计、追加一条成功审计。SQLite trigger 强制诊断与成功状态同次更新。
- 终态失败仍保留错误和审计，重复成功结果被拒绝。
- 先在原实现执行第一例，实际失败；补丁后两例通过。此专项使用静态 artifact fixture，不冒称真实 Nuxt 构建故障。
- 后继源码 `go test -count=1 ./...`、`go vet ./...` 在隔离 Linux Go 环境实际退出 0；没有放宽正式容器权限。

证据：`docs/evidence/P6E-diagnostics-before-fix.txt`、`P6E-diagnostics-regression.txt`、`P6E-go-post-diagnostics.txt`、`P6E-go-vet-post-diagnostics.txt`。

## 范围与后续

不改变数据库 schema、内容快照、不可变 receipt、前台视觉或发布 gate。未连接生产。后续独立构建带准确源码标签的 API 候选，复测真实 Nuxt 恢复场景；其结果与原十二项冻结基线分开记录。完整最终镜像组装、跨功能源码升级及正式拓扑验收未由本专项完成。

本记录随修复提交；完整提交 SHA 与 GitHub 推送核验以 Git 和最终交付回复为准，不将待提交文档写入自身 SHA。
