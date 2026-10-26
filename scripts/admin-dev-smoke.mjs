import assert from 'node:assert/strict'

const base = new URL(process.argv[2] || 'http://127.0.0.1:3210')
assert.equal(base.protocol, 'http:')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
assert.equal(base.pathname + base.search + base.hash + base.username + base.password, '/')

async function request(path, expected, method = 'GET') {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, expected)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/)
  assert.equal(response.headers.get('set-cookie'), null)
  console.log(`PASS ${method} ${path} ${response.status} no-store noindex no-cookie`)
  return response
}
const ready = await request('/dev-health/api', 200)
assert.equal((await ready.json()).data.stage, 'p6b-api')
const redirect = await request('/admin', 307)
assert.equal(redirect.headers.get('location'), '/admin/')
for (const path of ['/admin/', '/admin/login', '/admin/projects']) {
  const response = await request(path, 503)
  assert.match(await response.text(), /P6-B/)
}
for (const path of [
  '/api/admin/v1',
  '/api/admin/v1/auth/login',
  '/api/admin/v1/projects',
  '/api/admin/v1/media',
  '/api/admin/v1/publish-jobs',
]) {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const response = await request(path, 426, method)
    assert.equal((await response.json()).error.code, 'HTTPS_REQUIRED')
  }
}
console.log('P6-B HTTP downgrade protection PASS; use trusted HTTPS for authenticated API tests.')
