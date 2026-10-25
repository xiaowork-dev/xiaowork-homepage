# 项目、封面与关于页配置

## 当前资料边界

Blog、Nav、ERP 的名称和展示定位来自已确认的 P0/P2 内容。用户在 P3 明确其他站点仍在修复和开发，真实资料后续提供。因此暂不填写各项目的真实技术栈、具体状态、官网、源码或截图；没有访问、截图或公开本机 ERP 业务界面。

已确认可用的公开链接只有本站 GitHub 仓库。Git 身份和提交邮箱仅用于提交，不自动作为公开个人资料。

## 新增或修改项目

在 `app/data/projects.ts` 添加一个对象即可自动进入项目列表、对应分类计数与筛选；`featured: true` 也会进入首页（最多六项）。例如不含未经确认资料的新项目：

```ts
{
  id: 'new-project',
  slug: 'new-project',
  name: '待确认的项目名称',
  summary: '待本人确认的项目简介。',
  cover: '/images/projects/placeholder.svg',
  coverAlt: '项目封面占位图，真实截图待补充',
  coverKind: 'placeholder',
  category: 'website',
  techStack: [],
  status: 'unconfirmed',
  featured: false,
  order: 10,
}
```

不要把以上示例直接当作真实项目上线。保持 `id` 和 `slug` 唯一，`order` 使用明确顺序；分类可用 `website`、`application`、`open-source`。分类文案集中在 `categoryLabels`，空分类会提供空状态和恢复全部按钮。当前筛选为页面内状态，重新进入页面恢复全部项目。

状态可选 `unconfirmed`、`planning`、`in-development`、`live`、`maintained`。没有逐项确认时保留 `unconfirmed`，不要根据封面或仓库存在推断上线状态。`isPlaceholder` 是保留的兼容字段，不覆盖状态显示；封面类型由 `coverKind` 管理。

官网字段 `demoUrl`、GitHub 源码字段 `repositoryUrl` 仅填写本人确认、实际可访问的 HTTPS 地址；未开放或失效时删除对应字段，界面自动隐藏该按钮。两个字段都缺省时显示不可点击的“入口待确认”。不要填写 `#`、猜测域名或内部管理后台地址。外链确认是人工内容流程，不在访客浏览时实时探测第三方网站。

## 封面资源

各项目资源目录为 `public/images/projects/<slug>/`。前三个项目通过 `app/data/project-covers.ts` 单独注册。可以新增真实封面并更新该注册表，也可以在项目对象直接配置封面字段，不需要修改组件。

详见 [封面接入说明](../public/images/projects/README.md)。真实截图建议 16:10，提供准确 alt。截图类型与真实状态分开维护；ERP 必须先确认是可公开的演示截图且没有业务、客户、账号或权限敏感信息。错误图片路径会回退到明确占位图。

## 关于页与公开联系

- `app/data/site.ts`：首页已确认的品牌标题、介绍、技术标签和本站源码地址。
- `app/data/about.ts`：品牌说明、个人介绍段落、技术展示分组、项目开发原则、公开联系方式及可选简历。
- `personalIntroduction` 暂为空：页面显示资料待补充提示。只接入本人确认的真实介绍，不虚构工作、教育、获奖或技术熟练度。
- `contacts` 可追加带 `label`、`description`、`url` 的公开联系项，支持 HTTPS 或 `mailto:`。不要把提交邮箱自动移入这里。
- `resume` 默认缺省、不渲染。本人确认后可设置 `label` 与 `url`，支持本站公开文件路径或 HTTPS。简历文件也必须经过公开内容确认。

“项目开发原则”来自本项目已确认的工程与体验要求，不作为未经确认的个人履历或经历声明。

## SEO 与域名

`shared/seo.ts` 集中维护标题、描述、规范路径；`app/composables/useSiteSeo.ts` 共用 Open Graph / Twitter 逻辑。正式域名通过构建变量 `NUXT_PUBLIC_SITE_URL` 设置。未配置时不编造绝对 URL，sitemap 暂停；配置后生成三页 sitemap 与绝对 canonical、分享图 URL。静态镜像必须重新构建。详细操作见 [README](../README.md) 和 [部署指南](DEPLOYMENT.md)。

分享图 `public/images/social/xiaowork-share.png` 为自有品牌排版图，1200×630；它不冒充任何项目截图。可按同样尺寸替换为本人确认的品牌素材。
