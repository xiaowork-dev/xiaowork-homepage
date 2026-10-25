import { siteProfile } from './site'

interface PublicContact {
  label: string
  description: string
  url: `https://${string}` | `mailto:${string}`
}

interface AboutProfile {
  brandIntroduction: string
  personalIntroduction: string[]
  capabilities: { title: string; technologies: string[] }[]
  principles: { title: string; description: string }[]
  contacts: PublicContact[]
  resume?: { label: string; url: `/${string}` | `https://${string}` }
}

export const aboutProfile: AboutProfile = {
  brandIntroduction:
    'XiaoWork 是个人品牌与开发作品的统一入口，连接网站、应用和实用工具，也记录持续开发与实践的过程。',
  // Add only user-confirmed public biography. Never infer a biography from Git identity.
  personalIntroduction: [],
  capabilities: [
    { title: '服务与数据', technologies: ['Java', 'Spring Boot', 'MySQL'] },
    { title: '界面与体验', technologies: ['Vue', 'Nuxt'] },
    { title: '构建与交付', technologies: ['Docker'] },
  ],
  // Project development principles from the confirmed requirements; not a personal history.
  principles: [
    { title: '保持简洁', description: '围绕实际需求构建功能，选择清晰、适度的技术方案。' },
    { title: '重视体验', description: '让内容易于理解，让界面在不同设备和主题下都清晰可用。' },
    { title: '持续维护', description: '用可维护的代码、验证与交付记录，让作品能够持续迭代。' },
  ],
  contacts: siteProfile.githubUrl
    ? [
        {
          label: 'GitHub · 本站源码',
          description: '查看 XiaoWork Homepage 的公开代码与开发记录。',
          url: siteProfile.githubUrl,
        },
      ]
    : [],
}
