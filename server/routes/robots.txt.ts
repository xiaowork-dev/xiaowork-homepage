export default defineEventHandler((event) => {
  const origin = useRuntimeConfig(event).public.siteUrl
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`
})
