# XiaoWork Homepage 项目进度

> 最后更新：2026-10-28（Asia/Shanghai）
> 当前阶段：**P6-D 本地正常发布闭环已通过，完整故障验收部分完成；正式发布保持关闭。**

## 本轮实际交付

继续 `feat/v1.1-admin-p6a`。已实现不可变公开快照、独立离线 Worker、认证预览、全站静态构建、原子 current、独立 HTTP/SQLite 对账及同构建器内容恢复。中文后台调用真实服务。未合并 main，未连接生产，未修改 OpenResty、Cloudflare、V1.0 `.deploy` 或生产数据。

验收运行源码 SHA：`16adc47b1f20a65f8ec0218ac4e9cbebac7ba1d2`。完整结论见 [P6-D交付](deliveries/P6D-delivery.md)，最终文档提交及远端状态以 Git 和交付回复为准。

- Linux Go全包：93个顶层PASS、335条HTTP预期/实际记录、0失败、0跳过，vet通过。[Go证据](evidence/P6D-go-tests.txt)
- 真实Chromium可信HTTPS：10功能组通过。私有预览→发布A→保存B不改A→发布B→A旧标签导航仍A→刷新B→恢复A，草稿B仍保留。匿名/退出/Session到期后，预览HTML/JS/CSS/图片均401。[浏览器](evidence/P6D-browser.json)
- 公开三页×5宽度×双主题30组，管理发布页10组，320/390/768/1024/1440px无页面级横向溢出。全部图片滚动后decode，无记录到的hydration/CSP/pageerror；截图在 `docs/evidence/P6D-*.png`。
- 保卷重建API/Worker/static/gateway后，原Session、草稿B ws-44、公开A、历史、私有预览及图片保留。[Docker](evidence/P6D-docker.json)
- 恢复后3页独立title/description/canonical/OG/版本一致，22个immutable资源200，robots/sitemap使用固定正式origin，私有目录404。[HTTP/SEO](evidence/P6D-public-http-seo.json)
- 实际SQLite入队/结果事务失败、并发幂等、Linux进程崩溃边界、整组超时、128KiB真实ENOSPC均有分层证据。[18项故障矩阵](P6D-FAULT-TESTS.md)
- 真实Nuxt构建中SIGKILL专用Worker后，旧站三页及版本文件SHA不变；新任务409/停机到期503。重启、等待实际120秒租约后，同任务被标为切换前中断失败，草稿不变、没有虚假成功。[中断证据](evidence/P6D-worker-interruption.json)。此轮active基线独立于正常A/B验收，详见最终交付。
- 前台/后台规范、类型、8项前台及34项后台单测、Vite/Nuxt构建和静态生成通过；V1.0日常隔离站HTTP/SEO/资源/健康/404回归通过。

## 安全与未完成门槛

默认Worker不启动、发布gate=0，仅显式启用localhost HTTPS独立测试。正式 `https://xiaoworks.com` 管理origin被服务端拒绝开启，不能用本地成功绕过生产批准。

10月27日兼容更新node-forge1.4.0→1.4.1，官方npm gitHead和tag commit相同、integrity与lock一致。10月28日最终根审计 **7 low / 0 high / 0 critical**，均沿deepmerge4.3.1构建链；官方最新仍4.3.1，未强制降级Nuxt。admin审计0。[审计](evidence/P6D-npm-audit.json)

node-forge旧官方告警仍无first_patched_version，影响范围列为<=1.4.0；记录当前版本及工具结果，不将其等同所有安全问题消除。生产旧镜像未更新，原安全门槛未解除。[来源](evidence/P6D-node-forge-source.json)

Go扫描symbol0/package0/module1，为未导入openpgp的GO-2026-5932，无修复；不宣称模块风险清零。[Go扫描](evidence/P6D-govulncheck.txt)

完整真实Nuxt切换/恢复组合故障、离线备份恢复、跨代码升级、镜像OS扫描、容量/配额/预览物理GC、25M像素峰值、真实移动硬件/多浏览器/读屏尚未完成。派生媒体32MiB与预览/独立HTTP核验16MiB上限仍需统一；超限安全拒绝，不能称全部大图发布已验收。

## P6-E 下一步

1. 补齐故障矩阵中真实Nuxt错误/超时、切换后退出、结果写入和恢复再次失败等全栈组合；未知状态保持阻断。
2. 实际离线备份恢复SQLite/媒体/快照/发布根，明确跨代码升级范围；当前内容恢复要求相同源码SHA、Worker镜像ID及schema。
3. 统一媒体容量契约，添加磁盘告警、任务/预览配额和可审核保留策略。成功版本默认一直保留，不能删卷或全局prune。
4. 完成资源峰值、镜像CVE、性能、可访问性及正式OpenResty部署预检，再独立评审生产门槛。V1.0镜像脚本不能直接升级此分支。

Blog/Nav/ERP真实截图、状态、技术栈、地址与更多个人资料仍待用户补充。合成验收图仅在专用本地卷，明确不是项目截图。

## 阶段与历史索引

| 阶段   | 状态                                           | 交付                                                                                                        |
| ------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0～P2 | 需求、工程与首页视觉已验收；原件保留           | [P0](../XiaoWork_Homepage_P0_Delivery.md)、[P1](deliveries/P1-delivery.md)、[P2](deliveries/P2-delivery.md) |
| P3、P4 | 项目/关于/SEO、交互/性能已验收                 | [P3](deliveries/P3-delivery.md)、[P4](deliveries/P4-delivery.md)                                            |
| P5-A   | 用户基本通过工程验收                           | [P5-A](deliveries/P5A-delivery.md)                                                                          |
| P5-B   | OpenResty回环内部部署完成，公网未放行          | [生产交付](deliveries/P5-production-delivery.md)                                                            |
| P6-A   | 架构/数据库/API设计与隔离环境已验收            | [P6-A](deliveries/P6A-delivery.md)                                                                          |
| P6-B   | 认证、草稿/媒体API及持久化已验收               | [P6-B](deliveries/P6B-delivery.md)                                                                          |
| P6-C   | 中文Vue管理UI与真实HTTPS已验收                 | [P6-C](deliveries/P6C-delivery.md)                                                                          |
| P6-D   | 本地正常闭环已通过，故障验收部分完成，生产关闭 | [P6-D](deliveries/P6D-delivery.md)                                                                          |
| P6-E   | 待补齐故障/备份恢复/升级与上线准备             | [发布设计](architecture/V1.1-PUBLISHING.md)                                                                 |

main基线为 `14f9b1fba6504b1367aad6165a0b72c37e495927`。服务器历史运行实现 `2616ef60e7e9fd7ff6d62d26806bd56673525d52` 仅引用此前P5/P6-A交付，本轮未连接重查。既有德国主机使用1Panel OpenResty host，Homepage仅回环3100，不使用NPM。原公网代理/DNS/证书/Full(strict)/Host-SNI防绕过及用户安全接受门槛继续有效。敏感服务器信息仅私有记录。
