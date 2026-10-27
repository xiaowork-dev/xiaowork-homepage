# P6-C 实际测试记录

日期：2026-10-27（Asia/Shanghai）。范围为本机独立开发与验收环境，不连接生产，不开放公网后台。浏览器使用真实 Go API、SQLite 和持久图片卷，不用成功响应模拟保存。

## 可信 HTTPS 与验收隔离

- 验收项目为 `xiaowork-homepage-v11-p6c-e2e`，与日常 `xiaowork-homepage-v11-dev` 的数据库、图片、秘密、TLS 卷分离。
- 真实 Chromium 经本地 HTTPS `https://localhost:3444` 操作，`ignoreHTTPSErrors=false`。不信任开发 CA 时实际得到 `ERR_CERT_AUTHORITY_INVALID`；临时 NSS 信任确切 CA 后，以 TLS 1.3 完成登录和后续请求。
- 浏览器 sidecar 非 root、只读根、限权；没有数据库、Docker socket、会话密钥或 CA 私钥。证书信任只在临时容器内，结束即删除；宿主信任库未修改。
- 随机验收密码只在进程内，经真实 Docker PTY 隐藏输入初始化或重置专属测试管理员，不通过参数、环境变量、文件或管道传密码。不保存 storageState、Cookie、CSRF、密码或私钥。
- 会话过期由离线预编译夹具在核验专属卷标签后，仅修改当前测试会话期限；真实 API 随后拒绝请求。网络失败使用请求中断；CSRF 用例仅移除请求头，响应仍由真实 Go 服务产生。

## 浏览器请求、预期与实际

完整脱敏方法、路径、HTTP 状态与响应式结果见 [P6C-browser.json](evidence/P6C-browser.json)。下表的「通过」是实际执行结果；没有把源码阅读当作浏览器测试。

| 操作 / 实际请求                                         | 预期                                       | 实际                                                |
| ------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| challenge 后错误密码 `POST /auth/login`                 | 401，中文失败反馈                          | 401，页面提示                                       |
| 同一测试账户/来源累计失败后第 6 次登录                  | 429，等待提示                              | 429，页面显示限速                                   |
| 正确密码 `POST /auth/login`，刷新后 `GET /auth/session` | 200，恢复管理员界面                        | 200，Cookie 为 Secure/HttpOnly/SameSite Strict      |
| `POST /auth/logout` 后 `GET /workspace`                 | 204 后 401                                 | 204、401，回到登录页                                |
| 专属测试会话过期后读取设置                              | 401，重新登录且保留页面输入                | 401，重认证遮罩，登录后恢复                         |
| 当前密码错误 `POST /auth/password`                      | 401，但有效 Session 不被清除               | 401，仍能读取工作区，没有错误弹出过期遮罩           |
| 正确改密，再用旧密码/新密码登录                         | 204、401、200                              | 204、401、200，要求重新登录                         |
| 去掉 CSRF 的项目 PUT                                    | 403，表单保留                              | 403，中文安全提示，输入保留；恢复合法请求后 200     |
| 项目创建、PUT、筛选、刷新读取                           | 201 / 200，SQLite 保留字段                 | 通过；不是前端数组临时保存                          |
| 完整项目 ID 集合排序 PUT                                | 200，原子顺序改变                          | 键盘上移及 dragTo 均 200，读取核对顺序改变          |
| 两个独立浏览器会话编辑同一项目                          | 第二次 409，保留输入，拒绝静默覆盖         | 409，取消离开仍保留字段；核对最新值并明确确认后 200 |
| 项目归档与恢复                                          | 200，恢复不自动公开                        | 200，visible 仍为 false                             |
| 分类创建、编辑、排序、未引用删除                        | 201 / 200 / 204                            | 通过；有项目引用时 UI 禁用删除                      |
| 真实 PNG `POST /media`                                  | 201，重编码并存入独立卷                    | 201，私有预览可用                                   |
| 匿名 `GET /media/{id}/content`                          | 401                                        | 401，不是公开图片地址                               |
| PATCH 图片确认信息、绑定项目封面                        | 200，保存媒体引用                          | 200，重新读取项目 cover.id 一致                     |
| 尝试 DELETE 被引用图片                                  | UI 禁用；服务端 409 MEDIA_REFERENCED       | 两者均符合，未删除使用中的图片                      |
| 未引用的独立测试图片软删除                              | 200，保留物理数据/审计                     | 200，没有清理卷或物理文件                           |
| 个人资料和网站设置 PUT，刷新                            | 200，字段保留，无域名编辑器                | 通过，正式 origin 保持固定                          |
| 中断设置 GET 请求                                       | 明确网络错误，保留已加载字段               | 通过，没有伪报成功                                  |
| 保留卷重建 API/gateway                                  | Cookie、revision、项目/资料/设置和图片保留 | 全部一致，认证读取图片仍 200                        |
| 发布、预览、历史恢复操作                                | 明确 P6-D，禁用，不发成功任务              | 符合；后端 503 基线由 Go 集成测试回归               |

浏览器记录共 23 个功能组；HTTP 数量和生成时间以最终 JSON 为准，包含轮询、刷新及故障请求，不能把每条记录算作一个独立测试。后端 Go 全包另外覆盖鉴权、限速、nonce、CSRF、未知字段、SQL/XSS/URL、恶意图片、引用约束及真实持久化，见 [Go 日志](evidence/P6C-go-tests.txt)。

## 响应式、主题与键盘

工作区、项目、分类、图片、资料、设置、账户七页，分别在 320、390、768、1024、1440px 与深浅两主题下检查，共 70 组；全部无页面级横向溢出。手机项目表格保持可读列宽，仅表格内部横滚；滚动区域有名称和键盘焦点，方向键实测能滚动。1440px 素材卡片宽度实测至少 280px。

另实际执行菜单 Escape 关闭、键盘激活项目上移、主题刷新持久化、未保存内部离开取消。表单原生标签、焦点样式、跳至主内容、原生对话框与减少动态效果均保留；这不是完整 WCAG 认证或屏幕阅读器全套验收。浏览器未观察到 pageerror 或 CSP 拒绝。

截图：

- [登录](evidence/P6C-login.png)
- [深色仪表盘](evidence/P6C-dashboard-dark.png)、[浅色仪表盘](evidence/P6C-dashboard-light.png)
- [项目列表](evidence/P6C-project-list.png)、[项目编辑](evidence/P6C-project-form.png)
- [图片上传](evidence/P6C-media-upload.png)
- [手机列表](evidence/P6C-mobile.png)、[手机表单](evidence/P6C-mobile-form.png)

## 规范、构建与回归

| 检查          | 本轮结果与证据                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vue/TS/ESLint | 管理端 `npm run check` 通过；包含零警告 ESLint、vue-tsc 和 29 项单元测试，0 跳过                                                                          |
| Prettier      | 管理端独立格式检查、根工程完整格式检查通过；原始设计资料排除                                                                                              |
| Vite / Docker | 管理端构建和最终 gateway 多阶段镜像构建通过；镜像、健康与安全属性见 [Docker 证据](evidence/P6C-docker.json)                                               |
| HTTP 网关     | 管理路由 200、`/admin` 307、缺失资源/未知页 404；所测 HTTP 管理 API GET/POST/PUT/DELETE 均 426，无 Cookie；见 [网关日志](evidence/P6C-http-guard.txt)     |
| Go            | Linux 全包 48 个顶层测试通过，0 失败/跳过；`go vet ./...` 通过；[日志](evidence/P6C-go-tests.txt)                                                         |
| V1.0          | 根 ESLint/Prettier/TypeScript、4 项单测、Nuxt build/generate 通过；首页/项目/关于、SEO/22资源/health/404 [HTTP 回归通过](evidence/P6C-frontend-smoke.txt) |
| 持久化        | 真实浏览器在 API/gateway 保留卷重建后核对原数据和会话；不是灾难恢复验收                                                                                   |
| 管理端 npm    | [独立审计](evidence/P6C-admin-npm-audit.json) 0 漏洞                                                                                                      |
| 既有 Nuxt npm | [审计](evidence/P6C-npm-audit.json) 7 high / 0 critical，未修复、未 force                                                                                 |
| Go 漏洞       | [govulncheck](evidence/P6C-govulncheck.txt)：可达符号0、受影响导入包0、required module1（未导入 openpgp 的 GO-2026-5932），未宣称模块风险清零             |

## 失败、修正与边界

本轮真实遇到的失败包括 Vue 模板语法导致构建失败、浏览器测试选择器歧义、204 无响应体等待、重复上传已软删除内容返回保护性 409，以及宿主 Windows 证书接口超时。分别修正模板/测试等待/选择器和独立图片夹具，最终采用临时 Linux NSS 信任完成真实 HTTPS 浏览器验收；没有放宽 TLS、Cookie 或后端校验。Nuxt 首次本地构建因沙箱目录创建 EPERM 失败，经授权在相同源码重跑通过，没有改构建逻辑掩盖错误。

截图复核后将手机表格改为局部横滚，素材卡片加宽；并修复旧工作区响应覆盖新缓存、错误当前密码被误判会话过期、请求中表单重复编辑等问题。最终镜像包含这些修正。

未执行：生产访问/部署、正式 worker/预览/发布/恢复、完整离线备份恢复、镜像 OS CVE、峰值/DoS、真实移动硬件、Safari/Firefox、屏幕阅读器和 Lighthouse。本阶段没有使用 V1.1 开发解除 P5 公网安全门槛。未测全部图片格式的浏览器上传组合、旧素材解除引用后再删除的完整 UI 链；对应后端格式/引用规则由 Go 测试覆盖，不冒充浏览器已测。
