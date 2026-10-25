import type { Project, ProjectCategory, ProjectStatus } from '../types/project'
import { projectCovers } from './project-covers'

export const categoryLabels: Record<ProjectCategory, string> = {
  website: '网站',
  application: '应用与工具',
  'open-source': '开源与学习',
}

export const statusLabels: Record<ProjectStatus, string> = {
  unconfirmed: '资料待确认',
  planning: '筹备中',
  'in-development': '开发中',
  live: '已上线',
  maintained: '维护中',
}

// Placeholder content only. Real screenshots, stacks, status and public URLs await confirmation.
export const projects = [
  {
    id: 'xiaowork-blog',
    slug: 'blog',
    name: 'XiaoWork Blog',
    summary: '记录技术探索、开发过程与实践心得，让经验沉淀为可以分享的文字。',
    ...projectCovers.blog,
    category: 'website',
    techStack: [],
    status: 'unconfirmed',
    featured: true,
    order: 1,
    isPlaceholder: true,
  },
  {
    id: 'xiaowork-nav',
    slug: 'nav',
    name: 'XiaoWork Nav',
    summary: '把常用站点与开发资源有序收纳，为日常工作保留一个简洁、高效的起点。',
    ...projectCovers.nav,
    category: 'website',
    techStack: [],
    status: 'unconfirmed',
    featured: true,
    order: 2,
    isPlaceholder: true,
  },
  {
    id: 'xiaowork-erp',
    slug: 'erp',
    name: 'XiaoWork ERP',
    summary: '面向企业资源管理的系统开发实践，探索业务流程与软件工程的连接。',
    ...projectCovers.erp,
    category: 'application',
    techStack: [],
    status: 'unconfirmed',
    featured: true,
    order: 3,
    isPlaceholder: true,
  },
] satisfies Project[]

export const sortedProjects: Project[] = [...projects].sort((a, b) => a.order - b.order)
export const featuredProjects = sortedProjects.filter((project) => project.featured).slice(0, 6)
