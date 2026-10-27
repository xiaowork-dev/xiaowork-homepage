# XiaoWork Homepage 项目进度

> 最后更新：2026-10-27（Asia/Shanghai）
> 当前阶段：**V1.1 P6-C 中文管理 UI 与真实草稿 API 已完成本地验收；下一步 P6-D 静态发布服务。V1.0 维持内部部署，公网安全门槛未解除。**

## 阶段状态

| 阶段        | 状态                                                      | 交付                                                                                                        |
| ----------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0～P2      | 需求、工程、首页视觉已验收，原件保留                      | [P0](../XiaoWork_Homepage_P0_Delivery.md)、[P1](deliveries/P1-delivery.md)、[P2](deliveries/P2-delivery.md) |
| P3、P4      | 项目/关于/SEO、交互/性能已验收                            | [P3](deliveries/P3-delivery.md)、[P4](deliveries/P4-delivery.md)                                            |
| P5-A        | 用户基本通过工程验收                                      | [P5-A](deliveries/P5A-delivery.md)                                                                          |
| P5-B        | OpenResty 回环内部部署完成；high 风险未获接受，公网未放行 | [生产交付](deliveries/P5-production-delivery.md)、[发布门槛](P5-RELEASE-CHECKLIST.md)                       |
| P6-A        | 架构、数据库/API/发布设计与隔离骨架已验收                 | [P6-A](deliveries/P6A-delivery.md)、[架构](architecture/V1.1-ARCHITECTURE.md)                               |
| P6-B        | 单管理员认证、草稿内容/图片 API、导入与持久化已验证       | [P6-B](deliveries/P6B-delivery.md)、[API](V1.1-API-USAGE.md)、[安全测试](P6B-SECURITY-TESTS.md)             |
| P6-C        | 中文 Vue 管理 UI、真实 HTTPS 浏览器验收完成               | [P6-C](deliveries/P6C-delivery.md)、[操作](V1.1-ADMIN-USAGE.md)、[测试](P6C-TEST-RECORD.md)                 |
| P6-D / P6-E | 未实现：静态发布与恢复 / 完整上线准备                     | [发布设计](architecture/V1.1-PUBLISHING.md)                                                                 |

## 最新完成与证据

- P6-C继续`feat/v1.1-admin-p6a`，开发基线`2a3111784dcf4f089b4501d69dc6e569ca035ef9`；没有改Go/schema、V1.0前台或正式部署脚本，没有连接生产。
- 独立`admin/` Vue3/TS/Vite中文应用：登录/Session恢复/过期重认/退出/改密、真实仪表盘、项目/分类CRUD/归档/完整排序、私有图片上传/确认/引用保护、品牌/个人资料与SEO设置。主域固定，全部只存草稿。
- 保留服务端Secure/HttpOnly/Strict Cookie、challenge/CSRF/nonce与限速，浏览器不持久化认证凭据。409保留输入并要求明确比较/确认；未保存离开保护；拖拽及键盘排序；双主题/手机抽屉。发布/预览/历史恢复明确禁用，显示P6-D。
- 最终管理ESLint/TypeScript、29单测、Prettier与Vite/Docker构建通过；Go48顶层测试/vet与V1.0规范/类型/4单测/build/generate/HTTP回归通过。
- 真实Chromium可信HTTPS：23功能组通过，5宽度×双主题×7页共70组无页面级溢出；手机表格具名区域键盘横滚，桌面素材卡片宽度有断言。实际双会话409→比较确认→200、匿名私有图401、引用图DELETE409、网络中断、过期/改密/退出及保卷重建均通过。[浏览器证据](evidence/P6C-browser.json)、[截图与测试](P6C-TEST-RECORD.md)。
- 日常开发API/frontend/gateway healthy，init退出0，gateway仅回环3210/3443；专用E2E与日常卷隔离，验收后停止专用项目保留卷，临时浏览器和证书信任移除，不留9323测试入口。[Docker证据](evidence/P6C-docker.json)。
- 管理npm审计0漏洞；原Nuxt仍7high/0critical，Go symbol0/package0/module1，风险与公网门槛未解除。[本阶段交付](deliveries/P6C-delivery.md)。

## P6-B 已验收基础

- 继续 `feat/v1.1-admin-p6a`，P6-B 开发基线 `e6205c074191a2a1ea021234cf7ae26cc70fbd7a`；main 保持 `14f9b1fba6504b1367aad6165a0b72c37e495927`，本轮不连接生产服务器。
- 真正的 TTY 隐藏密码初始化、Argon2id、SQLite Session、Secure/HttpOnly/Strict Cookie、login challenge、CSRF、限速、过期、退出、再认证和改密撤销全部旧会话。
- 项目/分类 CRUD、归档恢复、原子排序、资料/技术标签/社交/SEO 设置；所有编辑只写草稿，使用 `If-Match` revision 和事务历史/审计，冲突返回409。新增项目提供24h幂等请求保护。
- 图片真实格式/尺寸校验、JPEG/PNG/WebP解码重编码、私有持久化、引用保护及软删除；SVG上传禁止。上传图片不自动成为公开资源。
- 001原件保留，追加002，全部历史checksum核验；真实schema1→2保留卷升级。V1.0的3项目/3分类及品牌资料一次性导入，来源SHA/manifest/payload哈希登记；重复不覆盖编辑，状态和素材仍明确待确认。
- 可信本地 HTTPS `https://localhost:3443`；不信任CA时验证失败，显式信任公开CA后真实登录通过。API无宿主端口，gateway仅回环3210/3443，受信代理精确到私有control网络的gateway地址。[开发说明](V1.1-DEVELOPMENT.md)
- 最终隔离 Linux：**48个Go顶层测试、224条HTTP结果记录、0失败、0跳过**，go vet通过；POSIX密钥权限、软链接、独立绝对期限都实际执行。[Go证据](evidence/P6B-go-tests.txt)
- Docker重新构建并替换API/gateway，原管理员Session、revision、已编辑草稿与图片哈希保留；重复导入不覆盖；API/frontend/gateway healthy、init退出0。[Docker证据](evidence/P6B-docker.json)、[持久化](evidence/P6B-docker-persistence.txt)
- V1.0源码/正式Compose/部署脚本未改；TypeScript、ESLint、Prettier、4项前台测试、build、generate、三页/SEO/22资源/health/404 HTTP冒烟通过。未在本阶段重跑全浏览器视觉矩阵或Lighthouse。
- npm审计仍 **7 high / 0 critical**，node-forge1.4.0无本轮确认兼容修复；Go扫描symbol0/package0，module1为未导入openpgp的GO-2026-5932。[安全记录](P6B-SECURITY-TESTS.md)

## V1.0 运行与验收基线

- 德国目标由用户确认SSH别名xiaowork-main，复用1Panel OpenResty host；独立部署目录及网络，仅127.0.0.1:3100→8080，不接NPM网络。
- 部署完整SHA 2616ef60e7e9fd7ff6d62d26806bd56673525d52，已推送并远端核验；镜像xiaowork-homepage:git-2616ef60e7e9，healthy、restart0。
- 正式origin https://xiaoworks.com（无www）已服务器重构建，revision/site-url标签与实际SEO一致；环境0600、非root/只读/限权/健康/日志均实测。
- 首发因本轮操作者umask077使配置0600、非root读取失败；只停止本站容器，Dockerfile两行显式COPY权限修复经真实0600回归后，新SHA重试成功。失败标签不能作为可用回滚版本。
- OpenResty host内四条上游路径200；SSH隧道三页/路径变体、canonical/OG/robots/sitemap、分享图/favicon/22资源、health/404、gzip/缓存/安全头冒烟通过。
- 三页×双主题×320/390/768/1024/1440共30组无横向溢出；分类/搜索/排序/空分类/重置/返回、菜单/路由及主题刷新通过。[浏览器证据](evidence/P5-production-server-browser.json)与截图供人工验收。
- 隧道手机Lighthouse单次82，可访问性/最佳实践/SEO100，LCP3651.26ms、CLS0、TBT39.5ms。CPU警告及跨境延迟影响，非Cloudflare公网结果，不与历史本机98分算优化收益。
- 部署前后15个既有容器ID/镜像/启动时间/状态和8份代理配置哈希一致；未做其他业务登录/写入回归，未访问后台。
- 健康镜像离线归档、环境/状态、源码SHA与校验和已独立受限备份，实际路径只私有记录；未离线恢复演练。首发无previous。
- 专属SSH隧道及本轮本机测试资源已清理；服务器内部健康实例和原开发服务保留。无全局清理、DNS/证书/防火墙/SSH或无关容器变更。
- 默认部署文档已改1Panel OpenResty，应用、依赖、视觉原件与既有更新/回滚脚本保留。

## 阻塞、范围与下一步

P6-C已接入上述真实接口与中文管理界面，`https://localhost:3443/admin/`为本地入口；账户由TTY安全初始化。操作步骤见[管理说明](V1.1-ADMIN-USAGE.md)。前台公开内容仍不读取私有草稿。

P6-D才实现静态快照、受限worker、私有预览、发布、任务对账及版本恢复。当前相关API经认证后503，不伪报发布成功。P6-E执行完整备份恢复、发布故障/多服务升级回滚、资源峰值、安全/浏览器/性能与生产预检。V1.0发布脚本不能直接升级此功能分支。

| 项目     | 当前事实                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安全     | npm high仍未修复，用户未接受公网风险。Go未用openpgp的模块级告警保留；不得把局部测试当完整安全认证。                                                |
| 内容     | Blog/Nav/ERP真实封面/技术栈/状态/地址，更多公开个人资料与简历后补；ERP截图需要脱敏确认。                                                           |
| 公网     | 本阶段无生产访问或变更；根域代理、证书、DNS、Full(strict)及Host/SNI防绕过未因V1.1开发放行。                                                        |
| 验证边界 | 管理Chromium浏览器验收已完成；真实EXIF/GPS全集、25M像素峰值/DoS、OS镜像CVE、离线恢复、worker切换恢复、真实移动硬件/多浏览器/读屏及公网性能未验证。 |

## Git 与交接

P6-C代码、配置、交付和证据将同次正常提交推送当前功能分支；实现SHA与远端核验在提交后登记，最终文档提交SHA以最终回复及Git为准。main不合并、不强推、生产不更新。

P6-B代码、说明、证据、交付与进度已同次正常提交为`ae05c1fe7e76e84cbaa0171ccbef8da7bd06656b`，成功推送`feat/v1.1-admin-p6a`并通过`git ls-remote`核验，main仍为`14f9b1fba6504b1367aad6165a0b72c37e495927`。本段为随后纯文档登记，最终文档提交SHA与再次推送结果以最终回复为准。P6-A实现SHA为`6d9a0680df44063336ef1d0a800294b52347fbd7`，已推送。

本轮不合并main、不强推、不更新服务器。V1.0服务器历史版本`2616ef60e7e9fd7ff6d62d26806bd56673525d52`仅引用已有交付，本轮未重新连接核验。

最新交付：[P6-C](deliveries/P6C-delivery.md)。下次先读本页、API使用、发布设计和交付；本地私有会话/密钥/数据只在忽略目录与开发卷，禁止推送。
