// Public HTTP/SEO evidence for the fixed local P6-D E2E stack, after rollback.
// Never requests production, authenticates, or reads private configuration.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const origin = 'http://127.0.0.1:3212'
const canonicalOrigin = 'https://xiaoworks.com'
const browser = JSON.parse(await readFile('docs/evidence/P6D-browser.json', 'utf8'))
assert.equal(browser.result, 'PASS', 'First complete the real browser acceptance')
const report = {
  date: new Date().toISOString(),
  origin,
  scope: 'Local public static HTTP only; no production request',
  pages: [],
  assets: [],
  protectedPaths: [],
}
async function request(path) {
  assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('..'))
  const response = await fetch(origin + path, { redirect: 'manual', cache: 'no-store' })
  return { response, bytes: Buffer.from(await response.arrayBuffer()) }
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
}
const markerResponse = await request('/__xiaowork-release.json')
assert.equal(markerResponse.response.status, 200)
const marker = JSON.parse(markerResponse.bytes.toString())
assert.equal(marker.releaseId, browser.publicationA.releaseId)
report.current = marker
const assets = new Set()
for (const route of ['/', '/projects/', '/about/']) {
  const { response, bytes } = await request(route)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const html = bytes.toString()
  const tags = [...html.matchAll(/<(?:meta|link)\b[^>]*>/g)].map((m) => attributes(m[0]))
  const meta = (name) => tags.find((tag) => tag.name === name || tag.property === name)?.content
  const canonical = tags.find((tag) => tag.rel === 'canonical')?.href
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1]
  assert.ok(title && meta('description'))
  assert.equal(canonical, canonicalOrigin + route)
  assert.equal(meta('og:url'), canonical)
  assert.equal(meta('og:title'), title)
  assert.equal(meta('og:description'), meta('description'))
  assert.equal(meta('xiaowork-release'), marker.releaseId)
  assert.equal(meta('xiaowork-snapshot'), marker.snapshotSha256)
  assert.ok(!/noindex/i.test(meta('robots') ?? ''))
  const image = meta('og:image')
  assert.ok(image?.startsWith(canonicalOrigin + '/_releases/' + marker.releaseId + '/assets/'))
  assets.add(image.slice(canonicalOrigin.length))
  for (const match of html.matchAll(/(?:src|href)="([^"?#]+)(?:\?[^"#]*)?"/g)) {
    if (
      match[1].startsWith('/_releases/') &&
      /\.(?:js|css|svg|png|jpe?g|webp|avif)$/.test(match[1])
    )
      assets.add(match[1])
  }
  report.pages.push({
    route,
    status: response.status,
    title,
    description: meta('description'),
    canonical,
    openGraph: {
      title: meta('og:title'),
      description: meta('og:description'),
      url: meta('og:url'),
      image,
    },
    releaseId: meta('xiaowork-release'),
    snapshotSha256: meta('xiaowork-snapshot'),
    htmlSha256: createHash('sha256').update(bytes).digest('hex'),
    cache: response.headers.get('cache-control'),
  })
}
for (const resource of assets) {
  const { response, bytes } = await request(resource)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control'), /immutable/)
  report.assets.push({
    path: resource,
    status: response.status,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  })
}
for (const resource of ['/robots.txt', '/sitemap.xml']) {
  const { response, bytes } = await request(resource)
  assert.equal(response.status, 200)
  const text = bytes.toString()
  assert.ok(text.includes(canonicalOrigin))
  assert.ok(!/localhost|127\.0\.0\.1|www\.xiaoworks\.com/.test(text))
  if (resource === '/sitemap.xml')
    for (const route of ['/', '/projects/', '/about/'])
      assert.ok(text.includes(canonicalOrigin + route))
  report[resource === '/robots.txt' ? 'robots' : 'sitemap'] = { status: response.status, text }
}
for (const resource of [
  '/manifest.json',
  '/staging/',
  '/preview/',
  '/activations/',
  '/releases/',
]) {
  const { response } = await request(resource)
  assert.equal(response.status, 404)
  report.protectedPaths.push({ path: resource, status: response.status })
}
report.result = 'PASS'
await writeFile('docs/evidence/P6D-public-http-seo.json', JSON.stringify(report, null, 2) + '\n')
console.log(
  `PASS local HTTP/SEO: ${report.pages.length} pages, ${assets.size} immutable assets, robots/sitemap and private path rejection`,
)
