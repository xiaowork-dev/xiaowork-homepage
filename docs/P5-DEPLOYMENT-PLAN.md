# P5 生产部署方案（准备稿，未执行）

日期：2026-10-26。P5-A 只准备和本机隔离验收。**没有生产服务器连接、DNS/CDN/证书修改或生产容器操作；P5-B 必须另获用户明确授权。**

## 拟定拓扑

访客 → Cloudflare（HTTPS）→ 现有 Nginx Proxy Manager（HTTPS/TLS 终止）→ 同机 Docker 共享网络 → XiaoWork 静态 Nginx `8080`。

应用使用 `compose.proxy.yaml`，继承 `compose.yaml` 的构建、只读/非 root、健康、日志和权限限制，通过 `ports: !reset []` 移除宿主映射。Compose 要求 **2.24.4+**。不安装/接管现有 NPM，不占其他应用端口，不暴露 Node 或数据库。若 NPM 不在同一 Docker 主机，此方案不能直接套用，需按实际私网拓扑另定访问控制。

## P5-B 前需要的信息

| 项目           | 需要确认的值                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 授权           | 明确允许 P5-B 的目标、操作范围、变更窗口和验收/回退标准                                                              |
| 服务器         | 本机已有 SSH Host 别名、目标主机/架构、部署绝对路径、操作用户与 Docker 权限、磁盘/内存余量；无需在聊天发送密码或私钥 |
| 现有环境       | Docker/Compose 版本、现有容器和端口、NPM 所在主机/容器、现有共享 Docker 网络名                                       |
| 路由           | 唯一 `PROXY_SERVICE_ALIAS`、是否已有同域 Proxy Host、现有上游和回退配置                                              |
| 域名           | 正式 HTTPS origin、www/根域别名及唯一规范入口、DNS 记录类型/目标、Cloudflare 代理状态                                |
| TLS/Cloudflare | 证书签发方式、NPM 到源站证书条件、当前 SSL/TLS 模式、现有重定向/缓存规则；不传 API Token                             |
| 版本/资料      | 已验收完整 SHA、[资料发布范围](P5-CONTENT-CHECKLIST.md)、上游 high 风险的修复或明确接受决定                          |
| 恢复           | 旧镜像、原 Proxy Host 与 DNS 配置备份、`.env` / `.deploy` 的项目外备份位置                                           |

## 域名与 HTTPS 准备

- 唯一构建变量 `NUXT_PUBLIC_SITE_URL`：正式 HTTPS origin，不含路径、查询、片段、账号或密码。当前保持空；不指定或继承其他站点域名。
- `shared/seo.ts` 维护三页 title/description；`useSiteSeo` 输出 canonical、OG/Twitter、1200×630 分享图；sitemap/robots 在构建时生成。域名未配时不伪造地址，sitemap 为 404。
- 配置正式域名必须使用新标签重建，不能只修改容器环境或重启。旧镜像回滚会一并恢复旧 SEO origin。
- 计划在 Cloudflare 使用 **Full (strict)**，源站 NPM 提供匹配主机名且有效的证书。不使用 Flexible，避免 HTTPS 重定向循环；签发流程和 DNS 条件按实际环境确认。
- 证书可用后由 NPM 对正式站点开启 Force SSL；若 Cloudflare 已有 Always Use HTTPS，先核对双方链路及别名规则，确保跳转收敛到唯一 HTTPS origin。不可让静态应用按内部 HTTP 无条件再跳转而形成循环。
- 现有 Nginx 使用相对重定向，保留代理访问的外部 origin/端口。应用容器内部 HTTP 不等于公网明文暴露；TLS 在边缘与 NPM 验收。HSTS 等证书和子域条件明确后再决定。
- CDN 缓存：不为全部 HTML 配置长期 Cache Everything。哈希 `/_nuxt/` 一年 immutable、图片一天、HTML/主题脚本重新验证；更换封面/分享图用新文件名。Cloudflare 不应覆盖既有安全头。

## 准备操作步骤（仅获得 P5-B 授权后执行）

宿主需要 Git、Bash、Docker Engine、Compose 2.24.4+、构建所需网络与内存；无需宿主 Node/npm。先只读检查存量服务和端口，确认网络已存在，不自动创建或修改他人网络。

```bash
git clone https://github.com/xiaowork-dev/xiaowork-homepage.git xiaowork-homepage
cd xiaowork-homepage
cp .env.example .env
# 编辑 .env：正式 NUXT_PUBLIC_SITE_URL、现有 PROXY_NETWORK、唯一 PROXY_SERVICE_ALIAS
# 以下 SHA 必须替换为本次资料和域名版本的完整、已经验收的提交。
REVIEWED_SHA="<已验收的40位SHA>"
XIAOWORK_COMPOSE_FILE=compose.proxy.yaml bash release.sh deploy "$REVIEWED_SHA"
```

`release.sh` 只接受确认仓库的 `main`、干净专用 checkout 和完整 SHA；从 origin 获取 main，要求该 SHA 在获取的 main 历史中、可从当前 HEAD 快进，随后 `merge --ff-only` 到精确 SHA，再调用已有 deploy/update。它不判断某提交是否经过人工验收，调用者必须从交付记录选定 SHA；不随意跟随最新 main，不强推/reset，不覆盖本地文件。

镜像标签为 `git-<SHA前12位>`，记录 OCI 源码和构建 origin。手动 deploy 若复用镜像，发现 origin 或已声明源码 SHA 不匹配会在替换前拒绝。改变域名或其他构建配置时仍必须创建新发布版本/标签；需要同源码不同配置的人工发布使用 `update.sh <新的唯一配置版本标签>`，并另行记录 SHA/配置对应关系。

首次成功后 `.deploy/compose-file` 记录模式。后续 update/rollback 默认读取该文件，防止忘记代理模式时重新映射端口；显式模式与已有记录不同则拒绝，网络迁移必须另作计划。`.env` 和 `.deploy` 不进入 Git，不被正常拉取或镜像重建覆盖。

NPM Proxy Host：正式域名，scheme `http`，Forward Hostname 为确认的 `PROXY_SERVICE_ALIAS`，port `8080`；加入现有同一共享网络。只修改此站对应项。Cloudflare DNS/代理与 Full (strict) 在用户授权范围内配置。所有真实名称在 P5-B 记录，不在本稿猜测。

## 一键更新与回滚

```bash
bash release.sh update "<下一已验收完整SHA>"
# 或源码已准备好时：bash update.sh <新唯一版本标签>
bash rollback.sh
# 或：bash rollback.sh git-<保留的旧SHA前12位>
```

更新先构建后替换；构建失败保留旧容器。新容器不健康则尝试恢复旧镜像，返回非零，成功部署记录不变。回滚只用本地已有镜像，不以新源码重建旧版本。单副本更新可能短暂停机，旧镜像也不健康/Docker故障/磁盘满时自动恢复可能失败。

发布前将 `.env`、`.deploy`、Git SHA、必要旧镜像和 NPM/DNS 旧配置保存至项目外。没有数据库或上传数据；镜像本身包含静态内容。应用回滚不会自动撤回 DNS、NPM、证书或 Cloudflare 变更，也不会回退源码 checkout；这些需依备份独立恢复。禁止 `down -v`、全局 prune 或删除其他项目镜像/容器。

## 上线验收与停止条件

依次验收容器 healthy/权限/无宿主映射、共享网内路由、NPM origin HTTPS、Cloudflare 公网 HTTPS/证书、HTTP 与别名跳转、三页 SEO/sitemap/robots/分享图、缓存/安全头、真实浏览器主题/交互/手机和日志。公网冒烟须传入正式 build origin。首次发布前后保留真实检查时间、版本、响应与截图。

域名或 TLS 错误、页面非 200、错误 canonical、泄露内部端口、其他站受影响、无效入口或未批准的敏感素材出现时停止并按记录回退。仅本机 Docker 共网反代测试不等于 NPM、Cloudflare 或公网 HTTPS 验收。

官方参考（准备阶段只读核对）：[Compose 合并/reset](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)、[NPM 网络配置](https://nginxproxymanager.com/advanced-config/)、[Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)、[重定向循环](https://developers.cloudflare.com/ssl/troubleshooting/too-many-redirects/)。
