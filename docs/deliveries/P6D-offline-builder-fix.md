# P6-D 离线只读构建修复

2026-10-27，功能分支 `feat/v1.1-admin-p6a`。

首轮真实浏览器在可信 HTTPS 下完成登录、草稿保存及预览排队；Worker 返回 `BUILD_FAILED`，UI 未误报成功，current 没有改变。该失败证据保留为 `docs/evidence/P6D-browser-initial.json`，不能算成功验收。

使用公开种子快照在无网络、只读、非 root 容器另行重现了实际构建障碍：Nuxt 4.6.2 的 Chrome 工作区缓存和 CLI output lock 默认写 `node_modules/.cache`，而固定依赖位于只读 `/builder/node_modules`。这是需要修复的问题，但随后真实 Worker 复测说明它不是任务失败的唯一原因。

修复仅影响发布构建：禁用不需要的 Chrome 工作区及共享 build cache，Vite 缓存移至任务 `.nuxt/cache/vite`。固定 Worker 环境设置 `NUXT_LOCK=0`，因该 Nuxt 锁文件不可配置路径；发布互斥仍由已测试的 Worker 全生命周期内核 flock、每任务独立私有目录、活动构建日志及进程组控制负责。没有放开依赖写权限，没有开启网络或改变管理认证。

实际隔离公开种子构建已退出0，完整生成8条预渲染路径。完整浏览器闭环将在此修复提交 SHA 的镜像上重跑。最终结果和所有尚未通过的门槛见 `P6D-delivery.md`，本记录不声明正式发布通过。没有生产操作。

后续诊断补充：原 API 把所有安全终结失败统一显示 `BUILD_FAILED`，掩盖了 Worker 在构建前的 `INVALID_ASSIGNMENT`。实际快照文档引用使用合法 builtin 品牌图标/分享图，而校验器仅接受上传 media。该问题通过真实种子回归修复：只允许上传 media 或已经验证的 builtin 白名单，未知引用仍拒绝。测试覆盖真实 seed 校验和及六处文档引用的24个接受/拒绝场景。第二次失败报告与截图保留为 `P6D-browser-second*`。

API 失败终结原有文件系统核对条件不变，增加已知错误分类白名单与固定中文摘要；未知分类回退通用失败。真实 HTTPS 测试确认任意底层路径、脚本与 Worker 自报摘要不持久化、不返回管理界面。缓存诊断和这些分层回归仍不能替代最终真实任务闭环。

修改：`nuxt.config.ts`、`backend/internal/publishworker/builder.go`、`validate.go`、真实 seed 回归、`backend/internal/httpapi/publication_worker.go` 及安全分类回归；测试及诊断证据随最终交付保留。提交 SHA、推送结果以最终 Git 报告为准。
