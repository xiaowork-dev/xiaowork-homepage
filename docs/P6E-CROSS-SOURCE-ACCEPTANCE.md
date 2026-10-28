# P6-E 最终发行组跨源码升级与回退验收

本报告补充已有同源码重封装测试，不替换旧证据。范围仅为本机 Docker Desktop 的独立模拟项目 `xiaowork-homepage-v11-p6e-cross-source`，回环 HTTP `3226`、可信 HTTPS `3459`、内部网段 `192.168.241.0/28`；不连接正式德国服务器，不改 V1.0、OpenResty、Cloudflare、main 或旧 `.env/.deploy`。

## 兼容策略

代码更新与回退仅接受相同且已审查的 SQLite schema3，现有不可变静态 manifest 格式为1。维护器在停写状态完整核验 SQLite integrity/FK、迁移校验和、全部上传图片、快照、当前及历史 release manifest/文件 SHA256；新版本维护器在替换前也必须能读取同一份数据。

候选启动后再次停写，新维护器与更新前的新检查结果完全比较，旧维护器也与原备份状态比较；新增逻辑内容摘要覆盖17张固定业务/schema/历史表，检测不改变 revision/数量的内容变化。Session、登录 challenge、限速、审计及幂等控制表不进入该逻辑摘要，但完整备份仍校验其物理文件。摘要不导出账户密码哈希或数据内容。SQLite schema变化一律先拒绝，不自动迁移或破坏性降级。

公开静态内容在代码更新时保持原不可变版本，不根据运行代码标签重写历史 manifest。历史源版本的已成功任务继续使用其原 source/builder 核验。后台的**内容版本恢复仍要求同源码与同 Worker 身份**，不因代码更新而自动放松：需要新模板的内容应通过该源码正常重新发布。该保守限制与静态站可以继续服务历史自包含资源是两个不同事实。

候选健康不等于更新成功。生命周期核验首页、项目、关于、robots、sitemap、真实后台 JS/CSS；通过显式本地CA验证HTTPS Session401、登录challenge200和 Secure/HttpOnly/SameSite Cookie；还会按备份当前 manifest 对公开全部文件逐项 HTTP 比较大小和 SHA256，防止图片返回200但字节损坏。

候选异常时不恢复备份覆盖新数据。先停候选写入，用旧/新维护器证明数据与更新前一致，再恢复旧镜像、核对 HTTP 后解除本站操作锁。停写失败、文件损坏、未知任务或逻辑状态改变均保留 `recovery-required.json` 和 `operation.lock`，要求明确人工核对，不允许盲目重跑。

备份必须使用其 `bundle.json` 所记录的维护镜像验证和恢复。最终维护器新增逻辑内容摘要，不能假定它可以直接验证旧版不含该字段的备份状态；跨源码测试采用**旧备份与配套旧维护镜像还原到空卷，再由新旧维护器读取现有数据并升级**。不得为了兼容而删改旧备份manifest或跳过校验，配套旧镜像也必须随备份策略保留。

## 实际验收入口

```powershell
node scripts/v11-cross-source-test.mjs <最终六角色manifest.json> .cache/v11-backups/p6e-complete-1793181418107
```

测试器从原已验证一致性备份恢复到全新独立卷，再启动原完整 `be5c96857c5a7098a9b8f80931ced47d0efcab89` 六角色镜像。最终候选必须具有不同完整源码 SHA，记录实际 Git diff；不能把换tag或同源码重打包算作跨源码升级。

受限测试故障使用独立派生镜像（缺少 Nginx 可执行文件、缺后台JS、公开503、指定图片200但字节错误）和固定项目宿主CLI preload（拒绝候选停写）。这些会明确标注 fixture 镜像ID，不是最终六角色正式镜像。preload仅由本地测试命令显式导入，不被API、Worker、maintenance构建复制或公开调用。停写边界注入不等同于整个Docker daemon真实故障，也不假称实际物理数据库损坏。

## 结果

实际旧组六角色源版本为 `be5c96857c5a7098a9b8f80931ced47d0efcab89`，最终组六角色源版本为 `817aa533741bdd5de23f322fa5e5171442cb28a9`。源码差异包括 API 恢复成功诊断修复、维护器受审残留链接修复及逻辑内容摘要、宿主生命周期逐文件核验；不是换tag或同源码镜像重封装。

以下12项已真实通过，控制器退出0，项目已精确停止并保留卷与镜像；完整命令、完整源码、全部镜像ID、差异及恢复意图写入 [最终跨源码证据](evidence/P6E-cross-source-final.json)，不覆盖旧版同源码报告。

| 项目                             | 实际结果                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| 原旧版从独立新空卷还原并启动     | 可信HTTPS真实登录、草稿与私有上传图片可读                                                     |
| be5c完整组六角色→817aa完整最终组 | 旧新维护器均接受数据，公开全部manifest资源HTTP大小/SHA核验，草稿与私有图片相同                |
| 817aa→be5c代码回退               | 六个旧镜像身份恢复，未回到旧时点数据库，公开HTML/SEO与图片不变                                |
| 缺Nginx可执行文件候选            | 实际候选启动失败，自动恢复原服务并重新核验HTTP与DB                                            |
| 公开根路径503候选                | 容器健康仍能通过，但生命周期HTTP拒绝候选，恢复原服务                                          |
| 后台JS缺失候选                   | 后台shell可返回200，但实际资源404导致拒绝，恢复原服务                                         |
| 发布图片错误字节候选             | 200不代表图片正确；完整manifest字节核验拒绝，恢复原服务                                       |
| schema4更新和回退描述符          | 在替换写服务前均拒绝；未执行实际schema迁移或降级                                              |
| 已存在本站操作锁                 | 新更新拒绝且原锁保留，未删除其他操作者锁                                                      |
| 候选写入者状态不确定             | 真实坏候选后，测试专属宿主preload拒绝第二次stop；保留人工恢复意图及锁，再次更新被拒绝         |
| 明确人工恢复                     | 确实停止候选后，用新旧维护器核验原数据，恢复原Compose及镜像，复验管理、图片、HTTP后才移交守卫 |
| 守卫解除后再次升级               | 真正新组升级成功，仅所选项目down且不带-v                                                      |

宿主stop边界注入时，坏网关仍存在，公开入口实际不可用；直到操作者核验并恢复原服务才恢复，不声明自动零停机或所有故障都可无人工处理。

追加专项也已实际通过4项，原始请求、任务、HTTP与manifest身份见 [新内容跨代码回退证据](evidence/P6E-cross-source-new-content.json)：

1. 最终817aa组六角色从保留卷启动，真实TTY重置隔离账户、可信HTTPS登录；修改隔离草稿并由固定Nuxt实际构建，任务 `job_fd460c7dfb753d495d18f1a38b4d5fa6` 成功产生新版本 `rel_cd697f5e03d06678a8f3823d64eef90a`，`ws-6 / error:null / activeVerified:true`。图片是明确确认的合成测试位图，未作为Blog/Nav/ERP真实截图。
2. 带着这个**新源码新发布内容和新草稿**，真正回退所有代码镜像到旧be5c；旧API读取原新源码任务与manifest，独立验证公开HTTP后仍为 `activeVerified:true`，公开HTML/SEO、编辑后的workspace及私有图片SHA相同。没有恢复旧时点SQLite。
3. 直接调用旧API尝试恢复新source内容，HTTP202只表示入队；任务 `job_fe97dbcf212b58617bbfafbd9e896bd9` 实际终态为 `failed / ROLLBACK_TARGET_INVALID`，current和草稿保持。旧版本能够服务已验证的自包含新静态页面，不代表有权使用不兼容Worker恢复它。
4. 再次真正升级全部角色到817aa，接受旧代码运行期间新增的失败任务历史，草稿与新公开内容保持，随后精确停止所选项目。

实际命令：

```powershell
node scripts/v11-cross-source-test.mjs docs/evidence/P6E-final-runtime-manifest.json .cache/v11-backups/p6e-complete-1793181418107
# 仅在上述已说明的测试器失败后，分别以 --resume-prepared / --resume-guard 继续同一已核验基线。
node scripts/v11-cross-source-new-content-test.mjs docs/evidence/P6E-final-runtime-manifest.json
node scripts/v11-cross-source-retention.mjs
```

最后一次独立只读 [保留与停止复核](evidence/P6E-cross-source-retention.json) 通过：本站容器已全部停止/移除、3226/3459实际拒绝连接；七个本站卷、旧新两份共十二个角色镜像身份仍存在；最终维护器再次核验 schema3、ws6、1管理员、3项目、1上传、4快照、6任务、4版本、0未完任务，current仍为上述新版本。保留旧/新source与Worker身份，逻辑内容SHA256为 `5846da0fbfe244e1b049a2db46801da4efac30387c30bdaa30bf9fbd9481f8a1`。未执行全局Docker清理。

首轮测试器在重置恢复账户密码后错误返回一个新测试用户名，而安全的 `reset-admin` 仅更换原账户密码，导致真实登录401。该失败保留于 `P6E-cross-source-harness-username-before.json`，不是产品认证绕过或错误成功。修正测试器为已知原隔离测试用户名后，仅以显式 `--resume-prepared` 继续同一份已恢复基线；该选项先检查完整旧版本描述符、固定端口/网段且无操作锁或恢复记录，不删除、重建或再次覆盖卷。

第9项之后，测试器把Windows绝对路径直接传给Node `--import`，在执行生命周期脚本之前被ESM loader拒绝。失败原文保留于 [import失败证据](evidence/P6E-cross-source-harness-import-before.json)。改用规范的 `file:` URL 后，`--resume-guard` 只在已有9项通过、旧完整描述符与固定拓扑一致、无锁或未决守卫时继续剩余阶段；不重置数据库，也不把测试器失败改成产品通过。最终证据保留完整命令序列与失败退出码。

## 三种恢复的边界

| 操作           | 改变的内容                                                                  | 不会自动执行的内容                                               |
| -------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 代码回退       | 切换六角色代码/镜像到经过核验的旧描述符；必须接受现有 schema 与完整数据     | 不恢复旧时点SQLite，不删除图片，不降级schema，不重写历史静态内容 |
| 内容版本恢复   | 按已验证且兼容的历史 manifest 原子切换公开静态 release                      | 不回退代码、Docker镜像、草稿或schema                             |
| 数据库灾难恢复 | 从完整一致性备份恢复到独立空卷，恢复图片/快照/历史/current，并撤销旧Session | 不覆盖原卷，不保证保留备份之后的编辑，不当作普通内容恢复         |

正式切换应安排维护窗口；容器更新或显式恢复期间可能出现短暂HTTP拒绝连接，不声明零停机。真实服务器拓扑、外部域名TLS和源站保护需未来独立上线授权后验证。
