# P5 内部部署：Nginx 配置权限修复

- 日期：2026-10-26（Asia/Shanghai）。
- 状态：修复及隔离回归已完成；服务器重试另记最终交付。
- 前置：已推送方案 SHA `53d063f85bf8dd6bdf461cc5f30334808f1d66cf`，用户仅放行内部预览，未接受剩余 high 风险。

## 发现与范围

德国目标独立 checkout 从确认的 GitHub main 获取上述完整 SHA，正式 origin 设置为 `https://xiaoworks.com`，仅使用 `compose.yaml` 回环 3100。服务器独立安装、静态生成和镜像构建成功；首次启动健康等待失败，脚本退出非零，未写入成功 current，也未配置公网路由或 DNS。

原因是本轮操作者使用 `umask 077` 创建 checkout，源配置文件为 0600。原 Dockerfile COPY 继承该权限且文件归 root；最终非 root nginx 无法读取 `/etc/nginx/nginx.conf`，日志明确为 Permission denied。已停止仅本轮失败的 Homepage 容器。

只读对照部署前基线：15 个既有容器 ID、镜像、启动时间、状态及健康状态均未变，8 份既有代理配置哈希未变。空 health 字段的最初比较表示不一致已按相同语义归一化复核，没有把查询格式错误当作服务变更。

## 修复

仅修改 `Dockerfile` 两行，对 `nginx.conf` 与 `security-headers.conf` 使用 `COPY --chmod=644`，使非 root 运行所需的公开配置可读，不依赖操作者 checkout 的 umask。未改变 `.env` 的 0600、容器用户、只读、限权或日志设置；未修改应用视觉或依赖。

旧失败镜像标签保留，不覆盖标签；回归通过后提交新完整 SHA，再在同一专用目录安全快进并首次部署重试。首次从未健康成功，不虚构上一可用版本或回滚成功。

## 验证

实际 gzip tar 构建上下文中，两份源配置均明确为 0600。完整 Docker/Nuxt 构建成功，镜像内两份配置均为 0644 root:root；非 root nginx 启动 healthy、重启 0，`nginx -t` 通过。正式 origin 三页/五路径 SEO、sitemap/robots、22 资源、health/404 与静态响应头冒烟均通过，安全限制保留。初次未压缩 tar 的本机传输报错发生于应用构建前，改 gzip 后完成真实回归；未更改生产源文件权限来掩盖故障。测试后仅移除本轮专属容器和镜像，保留已有开发/预览服务。证据：[权限回归](../evidence/P5-production-permission-fix.txt)。

## 风险与后续

node-forge 同源 7 high 未修复、未获接受，公网发布继续关闭。本修复只处理镜像配置权限，不能算依赖安全修复。服务器重试后须再验证健康、正式 origin HTTP/SEO、OpenResty 内回环可达、SSH 隧道浏览器和既有服务基线。

关联：[方案调整](P5-openresty-plan.md)、[最新进度](../PROGRESS.md)、[发布门槛](../P5-RELEASE-CHECKLIST.md)。最终本次文档提交 SHA 与推送结果由交付回复和远端查询报告，不自引用。
