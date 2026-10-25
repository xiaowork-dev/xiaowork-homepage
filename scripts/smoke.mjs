import assert from 'node:assert/strict'

const base = new URL(process.argv[2] || 'http://127.0.0.1:3100')
const resources = new Set(['/theme-init.js', '/favicon.svg'])

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
  const html = await response.text()
  assert.match(html, /<h1\b/, `${path} must contain prerendered page content`)
  assert.match(html, /<html[^>]*lang="zh-CN"/, 'Page language must be declared')
  assert.match(html, /<title>[^<]*XiaoWork[^<]*<\/title>/, 'Page title must be rendered')
  assert.ok(html.indexOf('/theme-init.js') < html.indexOf('<body'), 'Theme must load in head')
  for (const match of html.matchAll(/(?:src|href)="(\/(?:_nuxt|images)\/[^"?#]+)"/g)) {
    resources.add(match[1])
  }
  console.log(`PASS page ${path}`)
}

for (const path of resources) {
  const response = await fetch(new URL(path, base))
  assert.equal(response.status, 200, `Missing asset ${path}`)
  assert.ok(!response.headers.get('content-type')?.includes('text/html'), `HTML fallback: ${path}`)
}
console.log(`PASS ${resources.size} local assets`)

const health = await fetch(new URL('/health.json', base))
assert.equal(health.status, 200)
assert.equal((await health.json()).status, 'ok')
const missing = await fetch(new URL('/__xiaowork_missing_route__', base))
assert.equal(missing.status, 404, 'Unknown paths must preserve 404 status')
console.log('PASS health endpoint and 404 status')
