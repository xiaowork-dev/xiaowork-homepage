import { publication, snapshot } from '#shared/content'
import { publicOrigin } from '#shared/publication'

export default defineEventHandler((event) => {
  const origin = snapshot ? publicOrigin : useRuntimeConfig(event).public.siteUrl
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  if (publication?.preview)
    return `User-agent: *\nDisallow: /\nSitemap: ${publicOrigin}/sitemap.xml\n`
  return `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`
})
