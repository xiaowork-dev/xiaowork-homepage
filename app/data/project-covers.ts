import type { ProjectCover } from '../types/project'

// Keep each project's resources independent. Replace only after public-use approval.
export const projectCovers = {
  blog: {
    cover: '/images/projects/blog/placeholder.svg',
    coverAlt: 'XiaoWork Blog 封面占位图，真实截图待补充',
    coverKind: 'placeholder',
  },
  nav: {
    cover: '/images/projects/nav/placeholder.svg',
    coverAlt: 'XiaoWork Nav 封面占位图，真实截图待补充',
    coverKind: 'placeholder',
  },
  erp: {
    cover: '/images/projects/erp/placeholder.svg',
    coverAlt: 'XiaoWork ERP 封面占位图，真实截图待补充',
    coverKind: 'placeholder',
  },
} satisfies Record<string, ProjectCover>
