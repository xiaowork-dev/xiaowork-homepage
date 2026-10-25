interface SiteProfile {
  name: string
  role: string
  introduction: string[]
  directions: string[]
  technologies: string[]
  githubUrl?: `https://${string}`
}

export const siteProfile: SiteProfile = {
  name: 'XiaoWork',
  role: 'Developer & Creator',
  introduction: [
    '用代码构建想法，用作品连接可能。',
    '专注网站、应用与实用工具的开发，在持续实践中打磨体验与细节。',
  ],
  directions: ['全栈开发', '独立创造', 'Web · Applications · Tools'],
  technologies: ['Java', 'Spring Boot', 'Vue', 'Nuxt', 'MySQL', 'Docker'],
  githubUrl: 'https://github.com/xiaowork-dev/xiaowork-homepage',
}
