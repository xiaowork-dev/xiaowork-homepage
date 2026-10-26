# P5 生产部署交付：内部完成，公网未发布

- 日期：2026-10-26（Asia/Shanghai）；状态：**部分完成**。
- 德国目标内部部署和SSH隧道验收完成，**未正式上线、未满足全部发布门槛**。
- 用户已确认主站 https://xiaoworks.com（无www）、复用1Panel OpenResty、允许明确占位；**未接受7 high剩余风险，只完成内部部署**。

## 目标、版本与拓扑

用户确认SSH别名 xiaowork-main 为德国主力VPS；使用既有OpenSSH配置及严格主机校验。Debian12/x86_64、4CPU、约20GiB内存，巡检时可用内存约16.6GiB、磁盘余177GiB。Docker29.9.1 / Compose5.6.0，1Panel core/agent正常。实查代理为OpenResty host网络，无NPM，用户据此调整方案。

实际专用部署目录、主机地址、其他业务及备份路径只在忽略的本机 .cache/p5-production-private/deployment-record.md 等私有记录；不复制SSH配置、私钥、密码或Token到仓库。

| 项目          | 实际值                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| 已部署完整SHA | 2616ef60e7e9fd7ff6d62d26806bd56673525d52                                |
| Git来源       | 已确认GitHub main，干净专用checkout，完整SHA已推送并核验一致            |
| 部署入口      | XIAOWORK_COMPOSE_FILE=compose.yaml bash release.sh deploy 完整SHA       |
| 镜像标签      | xiaowork-homepage:git-2616ef60e7e9                                      |
| 镜像ID        | sha256:d5c79a723ce3c541a2a566ee60d1a6f0795d7121992179176315f956fa8c2c03 |
| 容器          | xiaowork-homepage-web-1，healthy，复验restart=0                         |
| 网络          | 独立xiaowork-homepage_default；不使用NPM共享网或别名                    |
| 端口          | 127.0.0.1:3100 → 容器8080，无IPv6/通配宿主绑定                          |
| 构建origin    | https://xiaoworks.com，镜像标签及实际SEO一致                            |
| 配置          | .env=0600，current=git-2616ef60e7e9，mode=compose.yaml                  |
| 安全限制      | nginx非root、只读、tmpfs、cap drop ALL、no-new-privileges、日志10MB×3   |

当前为本机回环SSH隧道→服务器回环→Homepage。OpenResty host内访问首页、项目、关于及health均200。**未创建根域公网vhost、重载OpenResty或变更证书**。最终镜像实测无Node，宿主未安装Node/npm。[运行证据](../evidence/P5-production-server-runtime.json)。

## 首次失败及修复

方案SHA 53d063f85bf8dd6bdf461cc5f30334808f1d66cf 首发构建/生成成功，但操作者以umask077 clone导致源配置0600；COPY继承权限，非root Nginx读取配置报Permission denied。健康等待失败，退出非零，未写成功current；仅停止本站失败容器。

Dockerfile两份公开Nginx配置显式COPY --chmod=644。真实0600输入隔离完整构建、健康及正式origin冒烟通过，再以新SHA安全快进重建，服务器成功健康。旧失败标签保留追溯，**不得用作可用回滚版本**。见[修复交付](P5-permission-fix.md)及[回归](../evidence/P5-production-permission-fix.txt)。没有修改应用、视觉、依赖或部署脚本。

## 实际验证与截图

| 检查           | 结果及范围                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 规范/类型/单测 | 方案阶段ESLint、Prettier、TypeScript及4项单测通过；最终 npm run check 复验通过，见[最终检查](../evidence/P5-production-final-checks.txt)          |
| 正式origin构建 | 本机及服务器均重新生成静态产物，不复用localhost/空origin镜像；服务器首次独立安装/生成成功                                                         |
| HTTP与SEO      | SSH隧道真实服务器三页五路径、独立title/description/canonical/OG、robots/三项sitemap、22资源、分享图/favicon、health/404、gzip/缓存/安全头全部通过 |
| 交互           | 分类2项、名称倒序、Nav搜索、重置、空分类、浏览器返回、内链、手机菜单开合/跳转收起、双主题刷新持久化通过                                           |
| 响应式         | 320/390/768/1024/1440 × 三页 × 双主题30组均无横向溢出、一个h1；首页/项目卡片分别1/1/2/2/3列                                                       |
| 外链           | 仅已确认本站GitHub，target/rel正确；项目入口隐藏，未假称三个项目源码已接入                                                                        |

[HTTP证据](../evidence/P5-production-server-http-smoke.txt)、[浏览器记录](../evidence/P5-production-server-browser.json)。交互等待路由完成后取样，不以异步中间帧判断结果。没有重复完整键盘/减少动效仿真、读屏、Firefox/Safari或真实设备测试。

实际服务器视口截图经SSH隧道获取，无拼接美化，**不是公网截图**：

- [桌面深色](../evidence/P5-production-server-home-desktop-dark.jpg)、[桌面浅色](../evidence/P5-production-server-home-desktop-light.jpg)。
- [手机项目](../evidence/P5-production-server-projects-mobile-light.jpg)、[手机关于](../evidence/P5-production-server-about-mobile-light.jpg)。

## 性能

Lighthouse13.5.0，跨境SSH隧道手机首页单次：性能82、可访问性100、最佳实践100、SEO100；LCP3651.26ms、CLS0、TBT39.5ms。报告提示本机CPU低于预期，隧道延迟/单次波动影响结果。**不是正式Cloudflare/HTTPS性能，不能与P5-A本机98分直接比较成优化收益**。INP/CrUX未测，TBT不替代INP。

[汇总](../evidence/P5-production-tunnel-performance.json)、[原始报告](../evidence/P5-production-lighthouse-tunnel-home-mobile.json)。公网开放后须对正式域名重测；未改视觉或功能追分。

## 安全、端口与未完成项

本轮npm audit仍**7 high、0 critical，未通过**，同一GHSA-86w9-cpqp-85rv链：Nuxt4.6.2 → @nuxt/nitro-server4.6.2 → Nitro2.13.5 → listhen1.10.1 → node-forge1.4.0。官方影响<=1.4.0、patched版本为空，相关5包latest与安装相同。未force、降级或override。[审计](../evidence/P5-production-npm-audit.json)、[公告](../evidence/P5-production-advisory.json)、[版本](../evidence/P5-production-registry.json)。

静态运行无Node、未发现本站RSA验签业务，只缩小运行攻击面；构建/开发风险保留，不能标已修复。用户暂不接受，**不得将生产安全验收标通过或自动公开本站**。基础镜像锁版本但未固定digest；实际ID已记，OS镜像CVE扫描未执行。

- 服务器唯一3100监听及对应DNAT都限制127.0.0.1；无通配或IPv6宿主发布。
- 本机外网IPv4 TCP显示connected，无代理HTTP却超时（curl28），未收到本站响应；IPv6为AccessDenied。**外网端口验收不确定**，须用独立IPv4/IPv6出口补测，不能推断全网不可达。
- 尚无本站公网路由；源站IP+Host/SNI、Cloudflare来源限制/mTLS未验收。回环、橙云或Full(strict)不能单独代替完整防绕过。
- 未修改整机80/443白名单、防火墙、SSH或无关业务。[端口证据](../evidence/P5-production-public-port-check.json)。

## Cloudflare、HTTPS与公网

公共根域A/AAAA检查为NOERROR但无Answer，当时HTTP/HTTPS无法解析；未访问Cloudflare管理账户或改DNS，账户SSL实际模式未知。未创建根域vhost/证书、www、HTTP跳转或HSTS。

**公网HTTPS、HTTP跳转、防源站绕过及生产域名HTTP/Lighthouse未验收**。Full(strict)为后续目标，禁止Flexible，不更改影响其他子域的全局设置。

## 其他服务、备份与恢复

部署前后15个既有容器的ID、镜像、启动时间、状态/健康均一致；8份代理配置SHA256一致，无新增代理配置。未停止、删除、重建无关容器，无全局prune或网络清理。该比较**不等于其他业务登录/数据写入完整回归**，未访问其他后台。

本站配置、完整SHA、健康镜像离线归档与校验和已保存独立受限目录，实际位置仅私有记录。配置归档0600，镜像归档26,266,624字节；未做离线恢复演练。首发无上一健康版本，previous不存在。

在私有记录的实际部署目录：

    # 下一版本经验证并推送后更新
    bash release.sh update <下一完整已验收SHA>
    # 未来更新需恢复本次健康镜像时
    bash rollback.sh git-2616ef60e7e9

脚本先构建再替换，构建失败保留旧容器，健康失败尝试恢复旧镜像；保留环境与模式。单副本不承诺零停机。服务器本轮未人为注入失败或做更新/回滚，历史隔离流程见P5-A，不冒称生产回滚已实测。**不要回滚到失败的git-53d063f85bf8**。回滚不回退checkout或外部代理/DNS。

撤销当前内部预览只需在本站目录：

    IMAGE_TAG=git-2616ef60e7e9 docker compose --env-file .env -f compose.yaml stop web

保留源码/环境/镜像，不操作其他项目。公网未配置，无本轮vhost/DNS需撤回。验收后关闭专属隧道并清理本机临时容器，服务器健康实例保留。再次预览先确认本机3109空闲：

    ssh -N -L 127.0.0.1:3109:127.0.0.1:3100 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes xiaowork-main

访问本机3109，不改通配绑定，无需将凭据写入仓库。

## Git与后续发布门槛

准备方案53d063f、权限修复2616ef6均已正常推送并远端核验。服务器保持完整2616ef60e7e9fd7ff6d62d26806bd56673525d52，不因后续纯文档提交自动更新运行版本。本文/进度/最终证据再次正常提交；自身SHA及推送结果以最终回复和远端查询为准，不强推或改写历史。

下一步：

1. 等待兼容安全修复复验，或用户明确接受剩余high风险；当前维持内部。
2. 独立IPv4/IPv6出口补测端口，审核仅本站生效的Host/SNI源站限制。
3. 放行后核对根域记录用途、根域证书/续期、Cloudflare Full(strict)与规则，备份后仅新增本站反代，不能覆盖未知业务或改全局策略。
4. 公开后重测HTTPS/跳转、生产域名HTTP/Lighthouse、主题/手机及其他站点回归。
5. Blog/Nav/ERP真实封面、栈、状态、地址及个人详细资料/可选简历后补，ERP素材必须确认公开且脱敏。

本次完成已授权的安全内部部署部分，**未满足全部正式发布门槛，没有强行上线**。

关联：[进度](../PROGRESS.md)、[部署方案](../P5-DEPLOYMENT-PLAN.md)、[发布清单](../P5-RELEASE-CHECKLIST.md)、[内容清单](../P5-CONTENT-CHECKLIST.md)。
