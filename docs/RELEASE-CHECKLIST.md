# 正式发布前检查与维护

P4 已验收，P5-A 当前发布门槛以 [P5 发布清单](P5-RELEASE-CHECKLIST.md)、[资料核对](P5-CONTENT-CHECKLIST.md) 与 [部署方案](P5-DEPLOYMENT-PLAN.md) 为准。本页保留通用维护建议。P5-A 本机验收不授权 P5-B 生产操作。

## 内容与域名

- 确认正式 HTTPS origin，设置 `NUXT_PUBLIC_SITE_URL`，用新唯一标签重建；检查三页 canonical、OG 图、robots 与三页 sitemap。不能复用带 localhost origin 的验收镜像发布。
- 补充 Blog/Nav/ERP 的已确认截图、技术栈、状态、官网及源码地址；未准备好的入口继续隐藏。ERP 仅接入确认可公开且已脱敏的演示截图。
- 本人确认详细介绍、公开联系方式、可选简历与最终品牌素材；Git 邮箱不自动公开。
- 使用新图片文件名发布替换素材，检查 16:10 裁切、alt、清晰度、AVIF/WebP 变体与失败回退。

## 工程与授权

- 复跑 `npm ci`、`npm test`、`npm run check`、build、generate 和静态镜像 smoke；检查移动端、双主题、键盘、搜索/分类/排序、浏览器返回。
- 正式上线前重新执行 npm audit，核查官方修复与基础镜像风险；不使用 force 或未经验证的大版本替换。
- 取得针对真实服务器、反代网络、域名/TLS 和生产部署的授权，再检查端口、存量服务和磁盘。不占用其他项目端口或改其容器，不做全局清理。
- 保存现有镜像、源码 SHA、环境文件及 `.deploy` 状态备份；记录回滚标签，核对旧镜像可用。站点无数据库，但环境和镜像不能省略。
- 正式环境验证健康、响应头、压缩、日志轮转、只读权限；验证反代/证书、HTTPS 重定向及真实公网路径。当前版本标签固定但未锁镜像 digest。
- 补 Firefox/Safari、真实手机与读屏验收；在真实域名发布后采集 LCP/CLS/INP 的真实用户数据，不能用 Lighthouse TBT 替代 INP。

## 上游风险复查

2026-10-26 核验：node-forge 1.4.0，官方 GHSA-86w9-cpqp-85rv 的 affected 范围为 `<=1.4.0`，first_patched_version 为空；npm 最新仍为 1.4.0。Nuxt/Nitro/listhen 链在开发和构建安装它，npm 传播为 7 个 high 条目。本站不执行 RSA 签名验证，最终 Nginx 静态镜像无 Node 运行时；这降低生产运行暴露面，但不消除开发和构建供应链风险。

开发服务器仅绑定回环，不接收不可信签名/证书作为构建输入；保持 lockfile 与独立构建，勿将开发服务暴露公网。发布前及每周维护检查官方公告和 npm 版本；兼容修复发布后更新 lockfile，在同样检查和静态容器流程验证后提交。P4 没有执行强制降级、依赖覆盖或宣称审计通过。原始审计和官方公告摘录见 `docs/evidence/P4-npm-audit.json`、`P4-advisory-check.json`。

基础镜像 OS 层扫描与真实生产环境安全审核须独立记录；npm audit 不能覆盖它们。若风险不能接受，应延后发布并等待兼容修复，而不是编造已修复记录。
