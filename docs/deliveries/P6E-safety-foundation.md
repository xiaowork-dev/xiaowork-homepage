# P6-E 安全与恢复工程基线

日期：2026-10-28，分支 `feat/v1.1-admin-p6a`。这是为固定构建输入建立的中间交付，最终验收见随后生成的 `P6E-delivery.md`。

## 状态与范围

**部分完成，生产发布仍关闭。** 保留已验收的静态发布链和前台视觉。没有连接生产、合并 main、修改 V1.0 `.env` / `.deploy`、OpenResty 或 Cloudflare。

- 统一原图 10MiB、multipart 11MiB、派生/静态单文件 16MiB、单快照媒体总量 256MiB；重编码超限不能登记为成功素材。
- 监测 SQLite、图片、发布根的实际文件系统余量；少于 512MiB 或 2% 时拒绝新上传/任务，无法核实也拒绝。构建临时盘另有 256MiB 最低余量。管理界面显示容量状态；保留历史资源，不自动物理清理。
- 使用独立离线维护工具执行停写后的 `VACUUM INTO` 备份、全文件哈希与 schema/引用/发布完整性检查；只允许恢复到全新空卷，恢复后撤销 Session。
- 增加 V1.1 专用生命周期脚本及独立状态目录；固定完整源码 SHA 和镜像 ID，保留旧镜像，schema 不兼容拒绝自动更新/回退。V1.0 脚本保持独立。
- 移除未使用的 Nginx 可选模块及 Worker 全局安装工具；固定 Nuxt 依赖仍保留。Docker 生产默认不启动 Worker、gate=0，正式 origin 不能启用本地 gate。

## 主要路径

`backend/internal/{contentlimits,storagehealth,maintenance}`、`httpapi/storage*`、图片/快照/构建校验；`admin/src/pages/{MediaPage,PublishingPage}.vue`；Dockerfiles、`deploy/harden-nginx.sh`、`compose.admin-publish.yaml`；`scripts/v11-*`、`deploy/v11/`。

## 已运行验证与限制

- Windows Go 定向测试：storagehealth、mediautils、httpapi、publishworker 通过；维护工具单测和 vet 通过。
- Vue lint、TypeScript、34 单测通过；前台 TypeScript、8 单测通过；根 ESLint 通过。
- 定制静态镜像离线硬化构建成功。初次独立部署三页、健康接口与后台 HTTP 通过；停写备份和空卷恢复文件核验通过，服务恢复完整验收仍在进行。
- 初始镜像扫描发现 critical/high；移除未使用依赖后的静态镜像剩一项未定级告警，存在扫描器与官方 Alpine 安全数据库版本判断差异。最终所有镜像仍需重新扫描。

此提交不表示真实故障矩阵、浏览器、完整内容备份恢复、跨版本更新/回退或生产安全验收全部完成。后续将以此提交固定运行镜像身份，再保存真实测试结果。任何未通过条件继续阻止生产发布。

## 下一步

在本站专用本地项目中重建固定镜像，完成真实 Nuxt 故障、可信 HTTPS 浏览器、全新卷恢复和生命周期演练；如发现问题，修正后重新验证。Git 最终 SHA 和推送结果由实际 Git 及最终交付报告记录。
