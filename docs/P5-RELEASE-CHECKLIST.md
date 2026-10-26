# P5 发布门槛与执行清单

2026-10-26。当前方案为已有 1Panel + OpenResty，目标 `xiaowork-main`，主站 `https://xiaoworks.com`，无 www。勾选只表示已实际完成的事项；服务器内部部署与公网发布分开验收。最终事实见 [项目进度](PROGRESS.md) 和 [生产交付](deliveries/P5-production-delivery.md)。

## P5-A 历史本机工程验收

以下为 [P5-A 交付](deliveries/P5A-delivery.md) 的历史结果，不冒称本次生产重测。

- [x] P0～P4、Git/GitHub、资料/占位/外链/调试代码复核。
- [x] npm test、ESLint、Prettier、TypeScript、build、generate、Docker 构建。
- [x] HTTP/SEO、缓存/压缩/安全头、三页双主题响应式浏览器与 Lighthouse。
- [x] 回环部署/更新/回滚、标签防覆盖、故障恢复、精确 SHA 获取和拒绝分支。
- [x] 历史代理 Compose 共网与无宿主映射验证；不作为当前生产网络方案。

## 当前授权与方案核对

- [x] 用户确认目标 SSH 别名 `xiaowork-main`，允许本站独立部署；不改无关系统业务。
- [x] 用户确认生产反代改用已有 1Panel + OpenResty，不使用 NPM。
- [x] 正式主站确认为 `https://xiaoworks.com`，不配置 www。
- [x] 用户允许首版明确占位：保持状态、截图、技术栈和入口待确认，不编造真实资料。
- [x] 只读识别 Debian 12、OpenResty host 网络；当时 3100、专用目录、同名 Compose 项目无冲突，根域无已有代理配置。执行前仍须复核。
- [x] 现有脚本可选 `compose.yaml`，回环 `127.0.0.1:3100:8080`、项目独立默认网络，不接 NPM 网。
- [x] 本机以正式 origin 重新生成并完成 HTTP/SEO 及部分浏览器检查；这不是服务器已部署或公网已验收。

## 服务器内部部署（已完成，见生产交付）

- [x] 复核资源、端口、目录/项目归属、版本与 GitHub 同步，记录完整已审 SHA。
- [x] 专用目录准备正式 `.env`，build origin 为 `https://xiaoworks.com`，回环地址与端口显式指定。
- [x] 首次使用 `compose.yaml` 与现有 release/deploy；已有本站实例使用 update。
- [x] 镜像正式域名重新构建，不复用空域名/localhost 产物，OCI revision 与构建 origin 正确。
- [x] 容器 healthy、非 root/只读/限权/日志轮转生效，只发布回环 3100，未接 NPM 网络。
- [x] 内部三页/资源/404/health、canonical/OG/分享图/sitemap/robots 及实际浏览器验证。
- [x] 保存镜像、`.env`、`.deploy`、源码 SHA 与备份，明确首次失败撤销或旧版本回滚方法。
- [x] 15 个既有容器状态与 8 份代理配置哈希前后一致；未执行其他业务完整登录/写入流程回归。

## 公网放行门槛（当前关闭）

- [ ] 上游 7 high 已兼容修复并复验，或用户明确接受记录中的剩余风险。**当前用户暂不接受，安全审计未通过。**
- [ ] 基础镜像 OS/CVE、构建隔离与真实主机安全检查完成，未测项目明确记录。
- [ ] 本站 OpenResty/1Panel 配置、有效根域证书与 Cloudflare 现有状态完成核对及备份。
- [ ] 只影响本站的源站 IP + Host/SNI、IPv4/IPv6 和应用端口防绕过方案验证；不改整机规则，不以回环、橙云或 Full (strict) 单独判通过。
- [ ] 用户授权范围内的正式公网变更已具备执行条件；不将内部部署视为可自动新增 vhost/DNS。

当前只允许内部部署和预览，不新增公网路由或修改 DNS。内容占位已获允许，不等于高危风险也获接受。

## 公网开放后的验收（尚未执行）

- [ ] 仅本站 OpenResty vhost 指向 `http://127.0.0.1:3100`，根域有效证书，Cloudflare 橙云和 Full (strict)。
- [ ] 正式 HTTPS、HTTP 跳转无循环，不配置 www，未改变其他站点的全局规则。
- [ ] 正常 Cloudflare 链路可用，直接源站 Host/SNI 与公网应用端口无法绕过预期入口；若不能限制则如实记录风险。
- [ ] 公网三页/404/资源/health、canonical/OG/分享图、sitemap 与 robots 正确。
- [ ] 缓存、安全头、日志无异常，其他网站和证书/管理链路无回归。
- [ ] 实际浏览器三页、PC/手机、双主题、菜单/分类/搜索/排序与已确认外链通过。
- [ ] 对生产域名运行 HTTP smoke 和 Lighthouse；真实用户 INP/CrUX 另行收集，不把 TBT 当 INP。
- [ ] 交付实际版本、镜像、端口、时间、恢复方法和证据，验证后正常提交推送。
