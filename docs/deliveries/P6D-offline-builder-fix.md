# P6-D 离线只读构建修复

2026-10-27，功能分支 `feat/v1.1-admin-p6a`。

首轮真实浏览器在可信 HTTPS 下完成登录、草稿保存及预览排队；Worker 返回 `BUILD_FAILED`，UI 未误报成功，current 没有改变。该失败证据保留为 `docs/evidence/P6D-browser-initial.json`，不能算成功验收。

使用公开种子快照在无网络、只读、非 root 容器重现：Nuxt 4.6.2 的 Chrome 工作区缓存和 CLI output lock 默认写 `node_modules/.cache`，而固定依赖位于只读 `/builder/node_modules`。

修复仅影响发布构建：禁用不需要的 Chrome 工作区及共享 build cache，Vite 缓存移至任务 `.nuxt/cache/vite`。固定 Worker 环境设置 `NUXT_LOCK=0`，因该 Nuxt 锁文件不可配置路径；发布互斥仍由已测试的 Worker 全生命周期内核 flock、每任务独立私有目录、活动构建日志及进程组控制负责。没有放开依赖写权限，没有开启网络或改变管理认证。

实际隔离公开种子构建已退出0，完整生成8条预渲染路径。完整浏览器闭环将在此修复提交 SHA 的镜像上重跑。最终结果和所有尚未通过的门槛见 `P6D-delivery.md`，本记录不声明正式发布通过。没有生产操作。

修改：`nuxt.config.ts`、`backend/internal/publishworker/builder.go`；测试及诊断证据随最终交付保留。提交 SHA、推送结果以最终 Git 报告为准。
