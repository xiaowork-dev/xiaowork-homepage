# P6-D 私有快照传输修复

日期：2026-10-28（Asia/Shanghai）。状态：此修复已通过隔离 Linux 测试；完整浏览器预览、发布与恢复仍在验收。

真实 UDS 回归复现了 `snapshot hash mismatch`：公开种子里的 `Developer & Creator` 经通用 JSON 编码器重新转义，改变了 `json.RawMessage` 的封存字节。仅内部 claim 响应改为关闭 HTML 转义，保留原 SHA256 验证与公开 API 编码方式。没有放宽快照验证，也没有把数据库挂给 Worker。

新增测试经过真实 SQLite、可信 HTTPS 编辑/上传/公开确认、同 UID 私有 Socket、生产 UnixClient 和严格验证器，核对公开种子及中文/Unicode/真实上传媒体快照的原始字节与哈希。修复前的真实失败保存在 `docs/evidence/P6D-transport-before.txt`；修复后 Go 全包与 vet 退出0，见 `docs/evidence/P6D-go-tests.txt`。

同时修正认证测试夹具：CLI 初始化包含 Argon2 耗时，API 的冻结时钟改在账户创建之后设置，避免跨秒时违反 `updated_at >= created_at`。运行安全约束未修改。浏览器脚本对尚未加载的懒加载图使用声明 URL 检查版本路径，后续仍须逐图滚动并解码才算加载通过。

下一步以该修复的真实完整 Git SHA 重建独立 API/Worker 镜像，再运行浏览器闭环。当前文件自身提交 SHA 和推送结果以最终交付与 Git 核验为准。不合并 main，不连接生产；默认发布门槛保持关闭。
