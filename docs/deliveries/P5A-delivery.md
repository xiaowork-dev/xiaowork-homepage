# XiaoWork Homepage V1.0 — P5-A 发布准备交付

- 日期：2026-10-26（Asia/Shanghai）；版本 `1.0.0-p5a`；分支 `main`。
- 前置：用户已验收 P4，明确本次仅 P5-A，P5-B 必须独立授权。
- 状态：**P5-A 工程准备、本机验收和交付文档已完成**，Git 最终结果见本次交付回复与远端核验。**尚未获准正式发布**，正式资料、域名、生产环境及安全风险决定未齐备。
- 本阶段没有连接正式服务器，没有修改 DNS、Cloudflare、NPM 管理配置或其他项目容器。

## 1. 基线、资料与完成范围

已完整阅读 P0 规范/交付、P1～P4 交付、当前进度、README、内容和部署说明，查看已确认 PNG，并检查源码。起始工作区干净，`main` 和只读 GitHub 查询一致指向 `28e21164d84c2f97879b7482441b6aeb05ea2158`。使用既有授权 Git 身份，不修改全局配置或远端历史。

Nuxt 4 静态架构、P2 视觉、P3 内容机制、P4 交互全部保留，未修改 `app/`、`shared/`、`server/` 或公开页面资源。没有增加应用依赖，lockfile 只同步项目版本。三份原始 P0 文件 SHA256 与 P3/P4 一致，未编辑。

- 生成 [正式资料清单](../P5-CONTENT-CHECKLIST.md)，逐项核对品牌、介绍、三项目、封面、状态/栈/网址、GitHub 和个人公开资料。未把其他浏览器标签页、Git 邮箱或同品牌域名当作确认来源。
- Blog/Nav/ERP 继续为明确占位，没有真实栈、状态或外链；没有访问 ERP 权限/业务页面或采集敏感截图。本站 GitHub URL 已核对远端及未登录公开 HTTP 200，三项目自己的源码仍未知。
- 生成 [部署准备方案](../P5-DEPLOYMENT-PLAN.md) 与 [发布门槛](../P5-RELEASE-CHECKLIST.md)，区分 P5-A 工程条件、资料放行和独立生产授权。
- 复核现有 canonical、sitemap、robots、OG、分享图、独立标题/描述。正式 origin 为空，未写死公网域名。HTTP→HTTPS、别名规范化和证书/CDN操作只准备方案，没有生产实测。

## 2. 发布能力补齐

### 精确获取已审核源码

新增 `release.sh <deploy|update> <完整40位SHA>`：只允许确认的仓库、main、干净的专用 checkout；获取 origin main，校验目标提交属于远端 main 历史，且可由当前 HEAD 快进，精确快进到目标后调用已有部署脚本。标签为 `git-<SHA前12位>`，传递完整源码 SHA 到 OCI 标签。

脚本不自动认定 main 上任何提交都已验收；版本由操作者依据交付记录选定。不强制 reset、不追随未审核最新版本、不覆盖 `.env` 或部署状态。构建失败时 checkout 可能已前进，但运行容器与成功状态仍保留；源码回退与镜像回滚是不同操作。

### NPM 共网与配置保护

- 新增 `compose.proxy.yaml`，继承原运行约束，通过 `!reset []` 移除宿主端口，使用必填外部网络/唯一服务别名。要求 Compose 2.24.4+；不猜生产名称、不自动创建生产网络或改 NPM。
- `.deploy/compose-file` 在成功部署后记录配置，update/rollback 默认沿用，拒绝无意切换网络模式。首次失败未记录时重试需继续显式选择代理配置。
- 镜像记录构建 origin 和可选源码 revision。deploy 复用镜像时，origin 不匹配或 release 声明 SHA 与镜像不匹配会在替换前拒绝。域名改变必须新版本/新标签重建，不能复用旧静态产物。
- 保留非 root、只读、tmpfs、cap drop、no-new-privileges、健康检查、日志轮转；增加常见私钥/证书包/镜像备份的 Git 和构建上下文忽略规则。
- P4 旧镜像没有新标签，可能不能用 deploy 重复复用；显式 rollback 仍可恢复保留的旧镜像。默认回环模式、原 update/rollback 行为和短暂停机边界保留。

## 3. 主要修改文件

| 文件                                                           | 用途                                         |
| -------------------------------------------------------------- | -------------------------------------------- |
| `release.sh`                                                   | 获取精确已审核 main 提交并调用一键部署/更新  |
| `compose.proxy.yaml`、`deploy/common.sh`                       | 无宿主映射的反代模式及成功模式记忆/保护      |
| `Dockerfile`、`compose.yaml`、`deploy.sh`                      | 源码/origin 标签、复用保护，p5a 默认标签     |
| `.env.example`                                                 | 代理网络/唯一别名占位，正式 origin 仍为空    |
| `.gitignore`、`.dockerignore`                                  | 忽略常见私钥和备份文件                       |
| `.prettierignore`、`eslint.config.mjs`                         | 排除已忽略的内部 `.cache` 测试副本           |
| `package.json`、`package-lock.json`                            | 仅阶段版本 `1.0.0-p5a`，依赖版本未改         |
| `README.md`、`docs/DEPLOYMENT.md`、`docs/RELEASE-CHECKLIST.md` | 当前运行、精确发布、代理、回滚和新清单入口   |
| `docs/P5-CONTENT-CHECKLIST.md`                                 | 必须确认/可后补的资料与逐项目状态            |
| `docs/P5-DEPLOYMENT-PLAN.md`、`docs/P5-RELEASE-CHECKLIST.md`   | Cloudflare/NPM/TLS准备、输入信息、放行及回退 |
| `docs/PROGRESS.md`、本文件、`docs/evidence/P5A-*`              | 进度、实际运行报告和截图                     |

## 4. 最终本机验证

环境：Windows PowerShell、Node 24.22.1、npm 11.19.1、Git Bash；Docker Desktop Linux Engine 29.8.2、Compose 5.6.0。初次沙箱网络/管道访问受限，获本机测试权限后完成真实检查；没有以权限失败推断通过。

| 检查                   | 实际结果与证据                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm test               | 四项通过：搜索/分类组合、排序、查询边界、SEO origin                                                                                                                                                                                              |
| ESLint / Prettier / TS | 最终 `npm run check` 全通过，ESLint零警告；[代码检查](../evidence/P5A-code-checks.txt)。早期新JSON格式和手动指定无解析器文件的格式化命令曾报错，按支持格式处理后最终检查通过                                                                     |
| 生产 build             | 通过；[日志](../evidence/P5A-build-check.txt)                                                                                                                                                                                                    |
| 静态 generate          | 通过，默认 9 个预渲染产物；[日志](../evidence/P5A-generate-check.txt)                                                                                                                                                                            |
| Docker 独立安装/构建   | npm ci + prepare + generate通过；浏览器/Lighthouse候选 `p5a-qa-final`，补齐忽略规则后以新标签 `p5a-release-candidate` 最终构建/启动通过；[最终构建](../evidence/P5A-release-image-check.txt) / [启动](../evidence/P5A-release-runtime-check.txt) |
| 无域名 HTTP/SEO        | 三页五种路径、22资源、health/404、重定向、gzip、缓存、安全头通过；[证据](../evidence/P5A-http-smoke-domainless.txt)                                                                                                                              |
| origin 分支 HTTP/SEO   | `p5a-seo-check` 使用 `http://127.0.0.1:3107`，canonical/OG/三页sitemap/robots通过；[证据](../evidence/P5A-http-smoke-origin-configured.txt)；此镜像禁止用于生产                                                                                  |
| 配置/Bash              | 两种 Compose 配置、五个 Bash 文件分别 `bash -n` 通过                                                                                                                                                                                             |
| 源码发布入口           | 本地真实 Git/bare 远端验证精确快进、SHA/标签传递、保留环境/状态；拒绝短SHA、错误操作、脏工作区、非main、错误仓库、main外提交、旧提交；[记录](../evidence/P5A-release-source-check.txt)                                                           |
| 一键正常路径           | 隔离副本实际 deploy→update→rollback→重复deploy→恢复新版；请求探针确认 base/updated 内容变化，配置哈希不变，已有标签拒绝；[全过程](../evidence/P5A-deployment-check.txt)                                                                          |
| 失败恢复               | 构建失败保留旧健康容器；健康失败返回非零、自动恢复 `p5a-qa-update`，current未改变；origin/SHA错配和模式误切拒绝                                                                                                                                  |
| 运行约束               | 最终/代理 nginx用户、healthy、readonly、cap drop、no-new-privileges、10MB×3日志；实测无Node，根写入拒绝，/tmp可写                                                                                                                                |
| 代理模式               | 真实应用无宿主映射，外部测试网络/唯一别名可达；本机隔离 Nginx edge /3108 经共享网完成同样 HTTP 冒烟；[记录](../evidence/P5A-proxy-check.txt)                                                                                                     |
| 原始资料               | 三份 P0 SHA256 与 P3/P4 相同，原件未修改                                                                                                                                                                                                         |

源码发布测试使用本地 bare 仓库与 deploy/update 命令桩，未向 GitHub 提交测试历史；Docker 脚本实际运行单独覆盖。测试 Git Bash 路径与 `git rev-parse` 的 Windows 路径表示差异已处理，未以字符串比较误拒绝正常 checkout。

代理第一次测试失败：仅测试 edge 的 Nginx 临时目录未全部移到 /tmp，导致只读根目录 mkdir 失败、HTTP连接拒绝。修正测试配置后重启该隔离 edge，内网 health 与完整 HTTP 冒烟通过；应用发布配置本身不受影响。完整日志保留初次失败与重跑成功。

Windows 中文路径 Nitro cache-driver external warning 仍出现，build/generate成功；日志将 NUL 转成可读 `\0` 并规范换行/尾部空白，未修改测试结果。Linux 镜像构建成功，没有修补 node_modules。

## 5. 浏览器、视觉和可访问性

实际 in-app Chromium 检查 `p5a-qa-final` / `127.0.0.1:3106`；最终 `p5a-release-candidate` 另经重新加载与HTTP复验，全部JS/CSS哈希与已测候选相同（[等价核对](../evidence/P5A-artifact-equivalence.txt)、[最终HTTP](../evidence/P5A-http-smoke-final.txt)）；五档宽度 × 三页 × 两主题共30组，每页一个h1，滚动宽等于内容宽，项目卡片无重叠。[几何记录](../evidence/P5A-responsive-results.json)。

| 视口宽度 | 内容宽/滚动宽 | 项目列数 | 首页/项目/关于 × 双主题 |
| -------- | ------------- | -------- | ----------------------- |
| 320      | 305 / 305     | 1        | 通过                    |
| 390      | 375 / 375     | 1        | 通过                    |
| 768      | 753 / 753     | 2        | 通过                    |
| 1024     | 1009 / 1009   | 2        | 通过                    |
| 1440     | 1425 / 1425   | 3        | 通过                    |

- 实测网站分类2项、名称正/倒序、精选排序、Nav搜索、组合0结果、空分类、重置及焦点、浏览器返回/前进、查询刷新保存；[交互记录](../evidence/P5A-browser-checks.json)。只有三项精选，精选排序并不虚构额外项目。
- 菜单Enter展开、Escape关闭并恢复焦点、当前页链接关闭菜单、跳转关于后收起；关于“浏览作品”、Hero“探索项目”与品牌首页内链实际可用。
- 深浅切换后分别刷新，偏好正确保存。首页/项目/关于外链仅已确认本站GitHub，target/rel安全属性正确；未确认入口为不可交互说明，没有假按钮。
- 配置扫描未发现页面 `debugger`、console.log/debug、TODO/FIXME、空href、href="#" 或 example公网地址；已知占位全部列入资料清单。扫描不等于完整人工代码/秘密审计。
- 图片具备alt/尺寸及懒加载策略，语义/焦点/reduced-motion规则保留；本阶段没有修改图片逻辑，P4的故障注入证据仍保留，不冒称本次重新做了图片故障测试。
- Lighthouse默认深色自动可访问性/对比度、最佳实践、SEO均100；浅色逐页实际浏览器检查，未单独跑浅色Lighthouse。未做完整读屏、真实手机、Firefox/Safari或系统reduced-motion仿真，不等于完整WCAG认证。
- 原始P0效果图与P2视觉保持，源码及生成JS/CSS未改；真实封面未提供，不能判定真实项目内容视觉完成。

截图为真实浏览器JPEG视口，未拼接、合成或改写页面内容。全页截图接口本次不可用，改存视口截图。初次快速切主题抓到上一帧的图片已分步补拍并复核，不保留错误主题证据。首屏之外的内容已通过滚动/功能/几何检查，不把视口截图称为全页。

| 页面 | 桌面深/浅                                                                                          | 手机深/浅                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 首页 | [深](../evidence/P5A-home-desktop-dark.jpg) / [浅](../evidence/P5A-home-desktop-light.jpg)         | [深](../evidence/P5A-home-mobile-dark.jpg) / [浅](../evidence/P5A-home-mobile-light.jpg)         |
| 项目 | [深](../evidence/P5A-projects-desktop-dark.jpg) / [浅](../evidence/P5A-projects-desktop-light.jpg) | [深](../evidence/P5A-projects-mobile-dark.jpg) / [浅](../evidence/P5A-projects-mobile-light.jpg) |
| 关于 | [深](../evidence/P5A-about-desktop-dark.jpg) / [浅](../evidence/P5A-about-desktop-light.jpg)       | [深](../evidence/P5A-about-mobile-dark.jpg) / [浅](../evidence/P5A-about-mobile-light.jpg)       |

另有[平板深](../evidence/P5A-projects-tablet-dark.jpg)/[浅](../evidence/P5A-projects-tablet-light.jpg)、[空分类](../evidence/P5A-projects-empty-category.jpg)、[搜索无结果](../evidence/P5A-projects-search-empty.jpg)。

## 6. Lighthouse与资源体积

Lighthouse **13.5.0**、Chrome **155**、独立静态Nginx；默认手机412×823、DPR1.75、4×CPU、150ms RTT、1638.4Kbps。首页三次，中位数；其余单次。检测期间未并行构建或浏览器验收，其他日常服务保持运行，非专用性能机器。原始六份JSON和[汇总](../evidence/P5A-performance-summary.json)均保存。

| 首页手机指标 | P4最终中位数 | P5-A中位数         |
| ------------ | ------------ | ------------------ |
| 性能         | 98           | 98（三次98/98/98） |
| FCP          | 1713.33ms    | 1714.27ms          |
| LCP          | 2041.65ms    | 2035.54ms          |
| CLS          | 0            | 0                  |
| TBT          | 39.50ms      | 46.50ms            |
| Speed Index  | 3170.32ms    | 3110.92ms          |
| 总传输       | 127,539B     | 127,538B           |

本阶段无应用JS/CSS或视觉改动，差异不能归为性能优化收益，TBT略升也如实保留。全部生成JS/CSS仍为 **267,172B**，逐文件gzip **98,327B**（含懒加载和错误页，不是首页初始载入）。保持系统字体，不引入远程字体或第三方业务脚本。

| 单次报告 | 性能/可访问性/最佳实践/SEO | LCP       | CLS | TBT     |
| -------- | -------------------------- | --------- | --- | ------- |
| 首页桌面 | 100/100/100/100            | 452.56ms  | 0   | 0ms     |
| 项目手机 | 99/100/100/100             | 2037.30ms | 0   | 6ms     |
| 关于手机 | 98/100/100/100             | 1812.97ms | 0   | 32.50ms |

报告仍有网络依赖树、部分forced reflow、关于页小型同步脚本阻塞提示，以及bfcache检查内部错误；不靠改视觉或取消主题恢复追分。实验室TBT不替代INP；正式域名/真实用户数据尚无，INP与CrUX未测，真实封面接入后须重测。

## 7. 安全审计与实际攻击面

本次 `npm audit --json` **仍报告7个high条目，审计未通过**。同源 `GHSA-86w9-cpqp-85rv`，RSA PKCS#1 v1.5验签接受额外嵌套DigestAlgorithm，CVSS 7.5（CWE-347），并非7个独立漏洞。

依赖链实查：Nuxt4.6.2 → @nuxt/nitro-server4.6.2 → Nitro2.13.5 → listhen1.10.1 → node-forge1.4.0。2026-10-26官方GitHub公告API仍为受影响 `<=1.4.0`、`first_patched_version=null`；上述五项npm最新版本均等于安装版本，未发现兼容安全更新。证据：[审计](../evidence/P5A-npm-audit.json)、[公告](../evidence/P5A-advisory-check.json)、[版本](../evidence/P5A-registry-versions.json)。

审计建议回退Nuxt4.1.3，未执行force、框架降级或传递依赖override。Nuxt虽列在package dependencies，本站架构中只用于开发/静态构建；最终Nginx容器实际无Node。listhen引用forge处理开发证书/密钥功能，本站没有RSA验签接口，也不向构建输入未可信的签名/证书；静态公开访问不直接运行该Node链。但这不等于漏洞已修复，开发/构建供应链high风险继续保留。

缓解：开发仅回环、精确lockfile、隔离构建、限制证书/签名输入、禁止暴露开发/构建服务；发布前与每周复查官方公告和兼容版本，修复发布后重跑全套检查。用户尚未明确接受剩余风险；若不能接受，应延期发布。

本次秘密模式扫描无命中，`.env`、私钥/证书包/备份均忽略；这不是完整秘密扫描或OS审计。基础镜像锁版本而未锁digest，未做OS镜像CVE扫描、生产拓扑/TLS/DNS/Cloudflare安全验收或异地备份恢复；均是P5-B前待办。

## 8. 放行结论与下一步

网站已具备本机静态构建、功能、性能与部署/更新/回滚的工程准备能力，**还不满足立即正式发布的完整放行条件**。

必须确认正式HTTPS origin、当前文案/公开范围、三项目补齐资料或明确允许保留待确认状态、截图/ERP公开边界，以及剩余high风险的处置决定。详细个人履历、简历、额外社交和未公开项目的外链可后补，不能要求用户为了上线开放私有业务或源码。

P5-B还需目标SSH Host别名、部署路径/操作用户、Docker/Compose/架构/资源、NPM位置/共享网络/唯一别名、现有Proxy Host、域名/DNS/Cloudflare代理及TLS方案、变更窗口和回退备份。不要在聊天提供密码/私钥/API Key。取得明确生产授权后，先只读巡检，再按 [部署计划](../P5-DEPLOYMENT-PLAN.md) 准备具体可审核变更；本次不自动进入P5-B。

## 9. Git与交接

本文件、进度、代码/配置及本次证据在同一P5-A实现提交内交付。当前提交自己的最终SHA和推送状态不能在提交前写入自身；以本次最终回复、Git历史和远端只读核验为准，不制造循环自引用提交。沿用 `main` / `origin/main`、正常提交推送，不强推或覆盖历史。

本次五个隔离容器、三个测试网络及三个源码副本已清理；故障、探针和localhost SEO测试镜像已删除，保留两项真实源码候选镜像和全部证据。原3100开发预览已重新加载并保留。清理只针对明确命名资源，无全局prune或生产连接；[清理日志](../evidence/P5A-cleanup-check.txt)。起止清单中另一个既有容器发生了变化，本任务未操作它，也未擅自恢复，不据此声称所有其他服务原样不变。

关联：[P0](../../XiaoWork_Homepage_V1_Design_Spec.md)、[P1](P1-delivery.md)、[P2](P2-delivery.md)、[P3](P3-delivery.md)、[P4](P4-delivery.md)、[进度](../PROGRESS.md)、[README](../../README.md)。
