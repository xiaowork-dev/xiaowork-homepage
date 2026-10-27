import { pageSeo } from '#shared/seo'
import { snapshot } from '#shared/content'
import { publicOrigin } from '#shared/publication'

export default defineEventHandler((event) => {
  const origin = snapshot ? publicOrigin : useRuntimeConfig(event).public.siteUrl
  if (!origin)
    throw createError({ statusCode: 404, statusMessage: 'Site domain is not configured' })
  const escapeXml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[character]!,
    )
  const entries = Object.values(pageSeo).map(
    (page) => `<url><loc>${escapeXml(`${origin}${page.path}`)}</loc></url>`,
  )
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>\n`
})
