import type { Project, ProjectCategory, ProjectStatus } from '../types/project'

export const categoryLabels: Record<ProjectCategory, string> = {
  website: '网站',
  application: '应用与工具',
  'open-source': '开源与学习',
}

export const statusLabels: Record<ProjectStatus, string> = {
  planning: '筹备中',
  'in-development': '开发中',
  live: '已上线',
  maintained: '维护中',
}

// P1 sample content only. Real screenshots, stacks, status and public URLs await confirmation.
export const projects = [
  {
    id: 'xiaowork-blog',
    slug: 'blog',
    name: 'XiaoWork Blog',
    summary: '技术文章、经验与开发过程的记录空间。项目内容与公开入口待确认。',
    cover: '/images/projects/placeholder.svg',
    coverAlt: 'XiaoWork Blog 封面占位图，真实截图待补充',
    category: 'website',
    techStack: [],
    status: 'planning',
    featured: true,
    order: 1,
    isPlaceholder: true,
  },
  {
    id: 'xiaowork-nav',
    slug: 'nav',
    name: 'XiaoWork Nav',
    summary: '个人常用站点的快捷导航工具。本站仅展示项目，不重复提供收藏导航。',
    cover: '/images/projects/placeholder.svg',
    coverAlt: 'XiaoWork Nav 封面占位图，真实截图待补充',
    category: 'website',
    techStack: [],
    status: 'planning',
    featured: true,
    order: 2,
    isPlaceholder: true,
  },
  {
    id: 'xiaowork-erp',
    slug: 'erp',
    name: 'XiaoWork ERP',
    summary: '企业资源管理系统的项目展示。演示方式与可公开内容待确认。',
    cover: '/images/projects/placeholder.svg',
    coverAlt: 'XiaoWork ERP 封面占位图，真实截图待补充',
    category: 'application',
    techStack: [],
    status: 'planning',
    featured: true,
    order: 3,
    isPlaceholder: true,
  },
] satisfies Project[]

export const sortedProjects: Project[] = [...projects].sort((a, b) => a.order - b.order)
export const featuredProjects = sortedProjects.filter((project) => project.featured).slice(0, 6)
