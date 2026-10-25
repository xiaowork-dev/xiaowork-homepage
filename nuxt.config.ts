import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-25',
  devtools: { enabled: false },
  telemetry: false,
  modules: ['@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  typescript: { strict: true },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'XiaoWork — 个人品牌与项目展示',
      meta: [
        { name: 'description', content: 'XiaoWork 个人品牌主页，展示网站、应用与软件开发项目。' },
        { name: 'color-scheme', content: 'dark light' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [{ src: '/theme-init.js', tagPosition: 'head', tagPriority: 'critical' }],
    },
  },
  nitro: {
    prerender: { routes: ['/', '/projects', '/about'], crawlLinks: true, failOnError: true },
  },
})
