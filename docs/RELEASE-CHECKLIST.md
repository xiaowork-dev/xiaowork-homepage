# 正式发布前检查与维护

当前发布门槛以 [P5 发布清单](P5-RELEASE-CHECKLIST.md)、[资料核对](P5-CONTENT-CHECKLIST.md) 与 [部署方案](P5-DEPLOYMENT-PLAN.md) 为准。用户确认 `xiaowork-main`、已有 1Panel + OpenResty、根域 `https://xiaoworks.com`（无 www），允许明确占位和内部回环部署；未接受上游 7 high 风险，公网 vhost 与 DNS 暂不放行。本页保留通用维护建议。

## 内容与域名

- 生产 origin 使用 `NUXT_PUBLIC_SITE_URL=https://xiaoworks.com`，用新唯一标签重建；检查三页 canonical、OG 图、robots 与三页 sitemap。不能复用带 localhost 或空 origin 的镜像发布。
- 用户允许首版保留 Blog/Nav/ERP 明确占位，真实截图、技术栈、状态、官网及源码地址后续补充；未准备好的入口继续隐藏。ERP 仅接入确认可公开且已脱敏的演示截图。
- 本人确认详细介绍、公开联系方式、可选简历与最终品牌素材；Git 邮箱不自动公开。
- 使用新图片文件名发布替换素材，检查 16:10 裁切、alt、清晰度、AVIF/WebP 变体与失败回退。

## 工程与授权

- 复跑 `npm ci`、`npm test`、`npm run check`、build、generate 和静态镜像 smoke；检查移动端、双主题、键盘、搜索/分类/排序、浏览器返回。
- 正式上线前重新执行 npm audit，核查官方修复与基础镜像风险；不使用 force 或未经验证的大版本替换。
- 当前使用 `compose.yaml`、显式 `127.0.0.1:3100:8080`、项目独立默认网络；已有 OpenResty host 上游为 `http://127.0.0.1:3100`。不接 NPM 网络，不占用其他端口或改无关容器，不做全局清理。执行前仍复核端口、存量服务和资源。
- 内部部署通过后仍等待安全门槛放行，才能处理本站 OpenResty vhost、根域证书和 Cloudflare Full (strict)/DNS；不改整机 80/443 白名单，实际核验源站 IP + Host/SNI 绕过。
- 保存现有镜像、源码 SHA、环境文件及 `.deploy` 状态备份；记录回滚标签，核对旧镜像可用。站点无数据库，但环境和镜像不能省略。
- 正式环境验证健康、响应头、压缩、日志轮转、只读权限；验证反代/证书、HTTPS 重定向及真实公网路径。当前版本标签固定但未锁镜像 digest。
- 补 Firefox/Safari、真实手机与读屏验收；在真实域名发布后采集 LCP/CLS/INP 的真实用户数据，不能用 Lighthouse TBT 替代 INP。

## 上游风险复查

2026-10-26 核验：node-forge 1.4.0，官方 GHSA-86w9-cpqp-85rv 的 affected 范围为 `<=1.4.0`，first_patched_version 为空；npm 最新仍为 1.4.0。Nuxt/Nitro/listhen 链在开发和构建安装它，npm 传播为 7 个 high 条目。本站不执行 RSA 签名验证，最终 Nginx 静态镜像无 Node 运行时；这降低生产运行暴露面，但不消除开发和构建供应链风险。

开发服务器仅绑定回环，不接收不可信签名/证书作为构建输入；保持 lockfile 与独立构建，勿将开发服务暴露公网。发布前及每周维护检查官方公告和 npm 版本；兼容修复发布后更新 lockfile，在同样检查和静态容器流程验证后提交。P4 没有执行强制降级、依赖覆盖或宣称审计通过。原始审计和官方公告摘录见 `docs/evidence/P4-npm-audit.json`、`P4-advisory-check.json`。

本轮再次核验仍为 7 high，官方未提供兼容修复，用户暂不接受该剩余风险；仅内部部署，不宣称生产安全通过。基础镜像 OS 层扫描与真实生产环境安全审核须独立记录；npm audit 不能覆盖它们。不能接受时延后公网发布并等待兼容修复，不编造已修复记录。
