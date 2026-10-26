# P6-A：V1.1 后台需求、架构与隔离开发环境交付

日期：2026-10-26（Asia/Shanghai）。完成状态：**本阶段架构与本地工程骨架已完成；后台业务功能尚未实现，不具备V1.1生产发布条件。**

## 1. 范围与现状核对

已阅读P0设计规范和确认效果图、P0～P5全部交付、进度、项目/品牌/关于/封面数据、SEO、静态生成、Docker与五份部署脚本。原始资料和前台源码、V1.0生产脚本保持原样。

- 开始时本地main与GitHub main均为`14f9b1fba6504b1367aad6165a0b72c37e495927`，工作区干净；本阶段使用`feat/v1.1-admin-p6a`。
- 本轮仅通过用户确认的`xiaowork-main`做只读版本/健康核对：服务器源码及镜像revision均为`2616ef60e7e9fd7ff6d62d26806bd56673525d52`，checkout干净，镜像`xiaowork-homepage:git-2616ef60e7e9`，healthy、restart=0，非root/只读，仅回环3100。三页及health均200。
- main比运行镜像多纯文档交付；没有在服务器执行pull、构建、迁移、重启或配置写入。OpenResty host拓扑沿用P5实查，本轮未重新审计其他服务或公网DNS/TLS。
- V1.0仍仅内部部署。用户允许明确占位，但没有接受剩余high风险；本次不解除门槛。实际服务器路径、备份和凭据不写公开文档。

脱敏基线见[P6A-baseline.json](../evidence/P6A-baseline.json)。

## 2. 架构决策与完整设计

| 文档                                              | 内容                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [后台架构](../architecture/V1.1-ARCHITECTURE.md)  | 实际现状、取舍、组件/容器权限、迁移、部署兼容和P6-B～E验收计划                               |
| [数据库设计](../architecture/V1.1-DATABASE.md)    | 单管理员、会话/nonce/限速、工作区/项目/分类、素材引用、不可变快照、任务/版本/审计和备份      |
| [API与安全](../architecture/V1.1-API-SECURITY.md) | 字段、端点、页面结构、Argon2id、Session/Cookie/CSRF、限速、上传、URL/XSS/SQL约束、幂等和并发 |
| [发布与恢复](../architecture/V1.1-PUBLISHING.md)  | 草稿隔离、受限离线构建、完整HTML/SEO、原子指针、旧资源保留、认证预览、失败对账与内容回滚     |
| [开发环境](../V1.1-DEVELOPMENT.md)                | 真实可运行的本地Compose、健康/冒烟、Go命令、端口/数据卷及网络说明                            |

选定静态Nuxt前台 + 独立Vue管理UI + Go API/SQLite + 固定源码的离线发布worker。访客不依赖数据库/API；管理端不进入访客bundle。Go持有数据库与草稿素材，worker不持有DB、Docker socket、SSH或GitHub凭据，不执行公网请求提供的任意命令。

保存草稿不会改变公开站。发布冻结白名单快照和媒体引用，worker在staging重新生成三页、hydration内容、SEO、sitemap/robots和版本资源，验证并落盘后原子替换current相对链接。API通过只读发布根与内网HTTP独立核验本任务proof后才记成功；202仅表示排队。DB、current和receipt没有共同事务，崩溃必须对账或恢复。每次激活记录放私有job目录，回滚不修改旧artifact，不覆盖草稿/账号/数据库。

不采用每次内容修改写Git并触发远程构建，减少在线令牌和构建权限。代价是需要受限worker、磁盘保留、构建等待及P6-D故障测试。旧标签页资源版本化、关闭payload extraction及快照适配目前是设计约束，尚未改造前台实现。

## 3. 实际实现与修改文件

- `backend/go.mod/go.sum`：锁定纯Go `modernc.org/sqlite v1.61.0`，Go1.27；实测SQLite核心3.54.1。
- `backend/migrations/{embed.go,001_initial.sql}`：可执行初始schema；runner独立记录版本/checksum，无账户、workspace或业务seed。后续已使用迁移不能原地改写。
- `backend/cmd/homepage-api/main.go`、`backend/internal/store/`：显式migrate/info/serve/healthcheck；缺库、未知/更高schema或同版本SQL校验和变化拒绝；每连接外键/WAL/busy timeout/synchronous配置。
- `backend/internal/httpapi/`：health/readiness和明确关闭的管理接口；没有假登录或临时CRUD。`/api/admin/v1`及子路径返回503、no-store、noindex且不创建Cookie。
- `backend/Dockerfile`及专用ignore：多阶段构建、scratch运行、UID10001、只读根；依赖下载与编译分离，编译GOPROXY=off。
- `compose.admin-dev.yaml`、`deploy/admin-dev/nginx.conf`：独立项目、回环3210网关、内网API/前台、独立DB/uploads卷；无Docker socket、生产.env或共享NPM网络。
- `admin/README.md`：管理应用边界，P6-C才创建真实Vue表单和构建依赖。
- `scripts/admin-dev-smoke.mjs`：仅允许本机目标，验证健康和管理端关闭状态。
- `.gitignore/.dockerignore`：排除数据库/临时文件与无关构建上下文；README/PROGRESS及本阶段文档/脱敏证据同步。

前台仍使用原TS配置；Blog/Nav/ERP仍为明确占位、空技术栈、unconfirmed、无未确认外链。实际数据一次性导入留P6-B，没有提前建立账户或导入生产资料。

## 4. 实际测试与结果

| 检查                                                          | 结果及范围                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `go test -count=1 -v ./...`                                   | 10个顶层测试通过，含媒体引用4个子场景；迁移/重跑/重开持久化、未知schema/checksum拒绝、nonce期限与一次消费、幂等作用域/保留/不可变、素材引用保护、再认证边界、不可变快照、本次发布/回滚证明、关闭管理接口与readiness |
| `go vet ./...`                                                | 通过                                                                                                                                                                                                                |
| `govulncheck@v1.9.0 ./...`                                    | 无发现；不是完整认证或生产安全验收                                                                                                                                                                                  |
| ESLint / Prettier / TypeScript                                | 通过；Go另用gofmt                                                                                                                                                                                                   |
| `npm test`                                                    | 原有4项查询/排序/SEO测试通过                                                                                                                                                                                        |
| `npm run build`                                               | 成功；仅验证框架构建，未启动Node生产服务                                                                                                                                                                            |
| `NUXT_PUBLIC_SITE_URL=https://xiaoworks.com npm run generate` | 成功，10个静态路由产物；前台依旧静态架构                                                                                                                                                                            |
| Docker构建/Compose配置/启动                                   | 通过；前台generate构建与API镜像实际成功，依赖下载层有缓存，未声称全量无缓存安装                                                                                                                                     |
| Docker权限与网络                                              | API UID10001，前台/gateway为nginx；只读根/cap-drop/no-new-privileges；仅gateway映射127.0.0.1:3210，API无宿主映射                                                                                                    |
| Docker重建持久化                                              | force-recreate全栈、重跑api-init成功；空库重建前后SHA256相同，uploads测试标记保留后已定向删除；最终卷保留                                                                                                           |
| 前台HTTP冒烟                                                  | 三页5路径、正式origin的独立SEO/robots/sitemap、22资源、health/404、gzip/缓存/安全头均通过                                                                                                                           |
| 管理HTTP冒烟                                                  | 25条健康/重定向/管理路径与方法组合通过；管理503/no-store/noindex/no-cookie符合P6-A关闭策略                                                                                                                          |
| 浏览器                                                        | 本地三页及/admin阶段说明实际查看；没有重新执行完整双主题/五档宽度矩阵、Lighthouse或后台UI功能测试                                                                                                                   |
| `npm audit --json`                                            | **未通过：7 high、0 critical**，既有node-forge链未修复；无强制升级或override                                                                                                                                        |

证据：[Go测试](../evidence/P6A-go-tests.txt)、[Go漏洞扫描](../evidence/P6A-govulncheck.txt)、[Docker](../evidence/P6A-docker.json)、[前台HTTP](../evidence/P6A-http-smoke.txt)、[管理HTTP](../evidence/P6A-admin-smoke.txt)、[npm审计](../evidence/P6A-npm-audit.json)。

## 5. 发现并修复的问题与局限

- 修正Windows SQLite file URI，统一SQL LF换行以保证本机/容器/克隆的迁移checksum一致。
- 本机Docker访问官方Go代理出现TLS证书错配；未关闭TLS/Go sum校验，显式用HTTPS模块镜像构建，默认仍官方代理。编译阶段离线，详见开发说明。
- 修正只读gateway临时目录；仅internal网络在当前Docker Desktop未提供有效宿主回环入口，gateway另接本项目edge网络，API/前台仍只internal。
- 最终schema冻结前只替换本轮刚创建、无账户/内容的原型测试卷；冻结后验证容器替换保留最终卷。不执行全局prune，不影响原3100服务。
- Nuxt构建仍提示cache-driver外部依赖解析告警，generate另有插件耗时告警；命令退出0、静态Nginx HTTP实际通过。未用大规模重构或压制告警宣称已修复。
- 当前HTTP开发栈没有认证能力；后续Secure Cookie验收必须使用明确本地HTTPS，不能用HTTP结果替代。

## 6. 风险、未完成与下一阶段

npm审计仍有7个high条目，根因同一node-forge `GHSA-86w9-cpqp-85rv`，本轮官方公告仍无patched版本。V1.0最终静态镜像不运行Node，但未来常驻构建worker会扩大构建链攻击面；须继续离线/输入/资源隔离并等待兼容修复，不能当作漏洞已解决。用户未接受剩余风险，公网门槛不变。Go扫描无发现也不能替代OS镜像CVE、真实鉴权、恶意图片、备份恢复或发布故障测试。

未实现登录/改密/Session/CSRF/限速、项目与分类CRUD、上传/公开确认、实际迁移、管理Vue页面、worker/UDS、草稿预览、正式快照生成/激活/回滚及V1.1生产部署脚本。没有修改正式数据库或现有生产反代。

下一步P6-B按设计实现认证与受控CLI → 工作区版本及CRUD → 素材解码/引用 → TS资料一次性迁移和API安全测试。P6-C做中文管理UI；P6-D打通静态发布与崩溃恢复；P6-E执行升级/回滚、备份恢复及完整安全/浏览器/性能预检，生产执行另取授权。

## 7. Git与交接

分支`feat/v1.1-admin-p6a`；开发基线与服务器实际完整SHA见第1节。代码、设计、交付、进度和证据同次提交为`6d9a0680df44063336ef1d0a800294b52347fbd7`。2026-10-26正常推送成功，并以`git ls-remote`确认远端功能分支指向该SHA；main仍为`14f9b1fba6504b1367aad6165a0b72c37e495927`。

本段在后续纯文档提交中记录已发生的推送事实，不改写实现提交；该记录提交自身最终SHA见最终回复与远端Git。不会自动合并main、强推或更新生产。

启动方法见[README](../../README.md)；当前本地预览`http://127.0.0.1:3210`。此交付确认P6-A阶段完成，不代表V1.1后台成品或生产安全验收通过。
