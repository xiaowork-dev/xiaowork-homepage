import type { ProjectCover } from '../types/project'
import { assetURL } from '#shared/content'

// Keep each project's resources independent. Replace only after public-use approval.
export const projectCovers = {
  blog: {
    cover: assetURL('/images/projects/blog/placeholder.svg'),
    coverAlt: 'XiaoWork Blog 封面占位图，真实截图待补充',
    coverKind: 'placeholder',
  },
  nav: {
    cover: assetURL('/images/projects/nav/placeholder.svg'),
    coverAlt: 'XiaoWork Nav 封面占位图，真实截图待补充',
    coverKind: 'placeholder',
  },
  erp: {
    cover: assetURL('/images/projects/erp/placeholder.svg'),
    coverAlt: 'XiaoWork ERP 封面占位图，真实截图待补充',
    coverKind: 'placeholder',
  },
} satisfies Record<string, ProjectCover>
