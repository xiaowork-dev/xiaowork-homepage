# XiaoWork Homepage V1.0 项目进度

> 最后更新：2026-10-26（Asia/Shanghai）  
> 当前阶段：**P5-B 内部部署与验收完成；公网发布受阻，未正式上线。**

## 阶段状态

| 阶段          | 状态                                        | 交付                                                                                                        |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0～P2        | 需求、工程、首页视觉已验收，原件保留        | [P0](../XiaoWork_Homepage_P0_Delivery.md)、[P1](deliveries/P1-delivery.md)、[P2](deliveries/P2-delivery.md) |
| P3、P4        | 项目/关于/SEO、交互/性能已验收              | [P3](deliveries/P3-delivery.md)、[P4](deliveries/P4-delivery.md)                                            |
| P5-A          | 用户基本通过工程验收                        | [P5-A](deliveries/P5A-delivery.md)                                                                          |
| P5-B 预检     | 历史本机预检完成，旧NPM方案已替换           | [预检](deliveries/P5B-preflight.md)                                                                         |
| P5-B 内部部署 | OpenResty回环方案、权限修复、服务器验收完成 | [生产交付](deliveries/P5-production-delivery.md)、[修复](deliveries/P5-permission-fix.md)                   |
| P5-B 公网发布 | 未放行：用户不接受剩余high风险              | [发布门槛](P5-RELEASE-CHECKLIST.md)                                                                         |

## 最新完成与证据

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

## 阻塞与下一步

| 项目 | 当前事实及下一步                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 安全 | 7 high/0 critical，同一node-forge GHSA；官方无兼容修复，用户暂不接受。等待修复复验或明确风险决定，不能判安全通过   |
| 端口 | 服务器监听和DNAT只127；本机IPv4 TCP与HTTP超时结果不一致，IPv6 AccessDenied。须独立双栈出口补测，不能宣称完整防绕过 |
| 公网 | 未新增根域vhost、证书/跳转、DNS或Cloudflare配置；Full(strict)实际设置未知，Host/SNI限制未验收                      |
| 内容 | 用户允许首版明确占位；Blog/Nav/ERP真实封面/栈/状态/地址、更多个人资料及可选简历后补，ERP需脱敏授权                 |
| 覆盖 | 公网Lighthouse/真实INP、OS镜像CVE、离线恢复、Firefox/Safari/真实设备/完整读屏未覆盖                                |

安全放行后再仅配置本站OpenResty、根域证书与Cloudflare，补测公网和防绕过，不改整机80/443白名单影响其他站。

## Git与交接

- main正常提交推送：方案53d063f85bf8dd6bdf461cc5f30334808f1d66cf、修复2616ef60e7e9fd7ff6d62d26806bd56673525d52均已核验。服务器保持精确已审修复版，不因纯文档提交自动更新。
- 本次交付/脱敏证据同次提交；自身最终SHA/推送结果见最终回复和远端查询，不强推或改写历史。
- 最新交付：[P5生产部署（内部完成）](deliveries/P5-production-delivery.md)。实际目录/备份/主机信息仅.cache/p5-production-private/，已Git忽略，禁止推送。
- 下次先读本页、交付和发布清单。代理方案授权不等于用户接受high风险，不擅自开放公网。
