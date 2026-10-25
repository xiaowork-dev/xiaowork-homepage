export const pageSeo = {
  home: {
    path: '/',
    title: 'XiaoWork — 个人品牌与项目展示',
    description:
      'XiaoWork 个人品牌主页，分享网站、应用与实用工具的开发实践，探索精选作品与技术方向。',
  },
  projects: {
    path: '/projects/',
    title: '项目与作品 — XiaoWork',
    description:
      '浏览 XiaoWork Blog、XiaoWork Nav 与 XiaoWork ERP，按分类探索网站、应用和工具，了解项目资料与公开入口。',
  },
  about: {
    path: '/about/',
    title: '关于 XiaoWork — 开发者与创作',
    description: '了解 XiaoWork 品牌、开发方向与项目开发原则，查看已确认的公开联系入口与本站源码。',
  },
} as const

// An empty origin is intentional until a real domain is confirmed.
export function normalizeSiteUrl(value: string | undefined): string {
  const input = value?.trim()
  if (!input) return ''
  const url = new URL(input)
  const localHttp =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !localHttp) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'NUXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or fragment (HTTP localhost is allowed).',
    )
  }
  return url.origin
}
