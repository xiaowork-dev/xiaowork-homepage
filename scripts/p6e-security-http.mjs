// Read-only unauthenticated probes of the dedicated local P6-E HTTPS gateway.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import https from 'node:https'

const ca = await readFile('.cache/p6e-browser/ca.crt')
const origin = 'https://localhost:3447'
const report = {
  date: new Date().toISOString(),
  origin,
  scope: 'Local read-only anonymous routes; explicit CA validation, no TLS bypass',
  cases: [],
}
const request = (route) =>
  new Promise((resolve, reject) => {
    assert.ok(route.startsWith('/') && !route.startsWith('//'))
    const req = https.get(
      {
        hostname: '127.0.0.1',
        port: 3447,
        servername: 'localhost',
        path: route,
        ca,
        rejectUnauthorized: true,
        headers: { Host: 'localhost:3447' },
        timeout: 10000,
      },
      (res) => {
        const chunks = []
        res.on('data', (data) => chunks.push(data))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        )
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Local security request timeout')))
  })
const record = (route, value, expected) => {
  assert.equal(value.status, expected, route)
  report.cases.push({
    route,
    expected,
    actual: value.status,
    bytes: value.body.length,
    sha256: createHash('sha256').update(value.body).digest('hex'),
    cacheControl: value.headers['cache-control'],
    robots: value.headers['x-robots-tag'],
    result: 'PASS',
  })
}
const marker = await request('/__xiaowork-release.json')
assert.equal(marker.status, 200)
report.current = JSON.parse(marker.body.toString())
assert.match(report.current.releaseId, /^rel_[a-f0-9]{32}$/)
for (const route of ['/admin/', '/admin/login', '/admin/projects', '/admin/publishing']) {
  const response = await request(route)
  record(route, response, 200)
  assert.match(response.headers['cache-control'], /no-store/)
  assert.match(response.headers['x-robots-tag'], /noindex/)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
}
for (const route of [
  '/api/admin/v1/workspace',
  '/api/admin/v1/dashboard',
  '/api/admin/v1/projects',
  '/api/admin/v1/categories',
  '/api/admin/v1/media',
  '/api/admin/v1/publishing-status',
  '/api/admin/v1/jobs',
  '/api/admin/v1/releases',
]) {
  const response = await request(route)
  record(route, response, 401)
  assert.match(response.headers['cache-control'], /no-store/)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
}
for (const route of [
  '/.env',
  '/.git/config',
  '/data/content.sqlite',
  '/uploads/',
  '/publications/',
  '/preview/',
  '/staging/',
  '/activations/',
  '/releases/',
  `/_releases/${report.current.releaseId}/manifest.json`,
  `/_releases/${report.current.releaseId}/snapshot.json`,
  `/_releases/${report.current.releaseId}/_nuxt/%2e%2e/%2e%2e/manifest.json`,
  '/admin/assets/not-present.js',
  '/admin/not-a-page',
]) {
  record(route, await request(route), 404)
}
report.result = 'PASS'
await writeFile('docs/evidence/P6E-security-http.json', JSON.stringify(report, null, 2) + '\n')
console.log(`PASS ${report.cases.length} local HTTPS anonymous exposure probes`)
