import assert from 'node:assert/strict'
import { normalizeSiteUrl, pageSeo } from '../shared/seo.ts'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const checkStaticHeaders = process.argv.includes('--static-headers')
const base = new URL(args[0] || 'http://127.0.0.1:3100')
const expectedOrigin = normalizeSiteUrl(args[1])
const resources = new Set(['/theme-init.js', '/favicon.svg', '/images/social/xiaowork-share.png'])

function securityHeaders(response) {
  if (!checkStaticHeaders) return
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.match(response.headers.get('permissions-policy') || '', /camera=\(\)/)
}

function metaValues(html, property) {
  return [...html.matchAll(/<meta\b[^>]*>/g)]
    .filter(([tag]) => tag.includes(`name="${property}"`) || tag.includes(`property="${property}"`))
    .map(([tag]) => tag.match(/content="([^"]*)"/)?.[1])
}

for (const path of ['/', '/projects', '/projects/', '/about', '/about/']) {
  let response = await fetch(new URL(path, base), { redirect: 'manual' })
  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    assert.ok(location, `${path} redirect must have a location`)
    const destination = new URL(location, base)
    assert.equal(destination.origin, base.origin, 'Redirect must preserve the public origin')
    response = await fetch(destination)
  }
  assert.equal(response.status, 200, `${path} must respond with 200`)
  securityHeaders(response)
  if (checkStaticHeaders) {
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.equal(response.headers.get('content-encoding'), 'gzip', 'HTML should be compressed')
  }
  const html = await response.text()
  assert.match(html, /<h1\b/, `${path} must contain prerendered page content`)
  assert.match(html, /<html[^>]*lang="zh-CN"/, 'Page language must be declared')
  assert.match(html, /<title>[^<]*XiaoWork[^<]*<\/title>/, 'Page title must be rendered')
  const metadata = Object.values(pageSeo).find(
    (page) => page.path.replace(/\/$/, '') === path.replace(/\/$/, ''),
  )
  assert.ok(metadata)
  assert.ok(html.includes(`<title>${metadata.title}</title>`), 'Page must have its own title')
  assert.deepEqual(
    metaValues(html, 'description'),
    [metadata.description],
    'Unique page description',
  )
  assert.deepEqual(metaValues(html, 'og:title'), [metadata.title])
  assert.deepEqual(metaValues(html, 'og:description'), [metadata.description])
  assert.deepEqual(metaValues(html, 'og:type'), ['website'])
  assert.deepEqual(metaValues(html, 'og:locale'), ['zh_CN'])
  assert.deepEqual(metaValues(html, 'twitter:card'), ['summary_large_image'])
  const canonicalTags = [...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g)].map(([tag]) => tag)
  if (expectedOrigin) {
    assert.equal(canonicalTags.length, 1)
    assert.ok(canonicalTags[0].includes(`href="${expectedOrigin}${metadata.path}"`))
    assert.deepEqual(metaValues(html, 'og:url'), [`${expectedOrigin}${metadata.path}`])
    assert.deepEqual(metaValues(html, 'og:image'), [
      `${expectedOrigin}/images/social/xiaowork-share.png`,
    ])
  } else {
    assert.equal(canonicalTags.length, 0, 'No invented canonical origin')
    assert.deepEqual(metaValues(html, 'og:url'), [])
    assert.deepEqual(metaValues(html, 'og:image'), [])
  }
  assert.doesNotMatch(html, /href="#"/, 'No fake action URLs')
  assert.ok(html.indexOf('/theme-init.js') < html.indexOf('<body'), 'Theme must load in head')
  for (const match of html.matchAll(/(?:src|href)="(\/(?:_nuxt|images)\/[^"?#]+)"/g)) {
    resources.add(match[1])
  }
  console.log(`PASS page and SEO ${path}`)
}

const robots = await fetch(new URL('/robots.txt', base))
assert.equal(robots.status, 200)
assert.match(robots.headers.get('content-type') || '', /text\/plain/)
const robotsText = await robots.text()
assert.match(robotsText, /User-agent: \*/)
const sitemap = await fetch(new URL('/sitemap.xml', base))
if (expectedOrigin) {
  assert.ok(robotsText.includes(`Sitemap: ${expectedOrigin}/sitemap.xml`))
  assert.equal(sitemap.status, 200)
  assert.match(sitemap.headers.get('content-type') || '', /xml/)
  const xml = await sitemap.text()
  assert.equal([...xml.matchAll(/<loc>/g)].length, 3)
  for (const page of Object.values(pageSeo)) {
    assert.ok(xml.includes(`<loc>${expectedOrigin}${page.path}</loc>`))
  }
} else {
  assert.doesNotMatch(robotsText, /Sitemap:/)
  assert.equal(sitemap.status, 404, 'Sitemap stays disabled without a confirmed origin')
}
console.log(`PASS robots and ${expectedOrigin ? 'configured' : 'domainless'} sitemap`)

for (const path of resources) {
  const response = await fetch(new URL(path, base))
  assert.equal(response.status, 200, `Missing asset ${path}`)
  assert.ok(!response.headers.get('content-type')?.includes('text/html'), `HTML fallback: ${path}`)
  securityHeaders(response)
  if (checkStaticHeaders) {
    const cache = response.headers.get('cache-control') || ''
    assert.match(
      cache,
      path.startsWith('/_nuxt/')
        ? /max-age=31536000, immutable/
        : path.startsWith('/images/')
          ? /max-age=86400/
          : /no-cache/,
    )
  }
}
console.log(`PASS ${resources.size} local assets`)

const health = await fetch(new URL('/health.json', base))
assert.equal(health.status, 200)
assert.equal((await health.json()).status, 'ok')
const missing = await fetch(new URL('/__xiaowork_missing_route__', base))
assert.equal(missing.status, 404, 'Unknown paths must preserve 404 status')
securityHeaders(missing)
console.log('PASS health endpoint and 404 status')
