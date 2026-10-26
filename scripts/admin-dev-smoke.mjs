import assert from 'node:assert/strict'

const base = new URL(process.argv[2] || 'http://127.0.0.1:3210')
assert.equal(base.protocol, 'http:', 'P6-A smoke is for the local HTTP scaffold only')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Local target required')
assert.equal(base.pathname, '/')
assert.equal(base.username + base.password + base.search + base.hash, '')

async function request(path, expectedStatus, method = 'GET') {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, expectedStatus, `${method} ${path}`)
  assert.equal(response.headers.get('cache-control'), 'no-store', `${path} must not cache`)
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/)
  assert.equal(response.headers.get('set-cookie'), null, 'P6-A must not create a session')
  console.log(`PASS ${method} ${path} ${response.status} no-store noindex no-cookie`)
  return response
}

const ready = await request('/dev-health/api', 200)
assert.deepEqual(await ready.json(), { status: 'ready', stage: 'p6a-scaffold' })
const redirect = await request('/admin', 307)
assert.equal(redirect.headers.get('location'), '/admin/')
for (const path of ['/admin/', '/admin/login', '/admin/projects']) {
  const response = await request(path, 503)
  assert.match(await response.text(), /P6-A/)
}
for (const path of [
  '/api/admin/v1',
  '/api/admin/v1/auth/login',
  '/api/admin/v1/projects',
  '/api/admin/v1/media',
  '/api/admin/v1/publish-jobs',
]) {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const response = await request(path, 503, method)
    assert.equal((await response.json()).code, 'ADMIN_NOT_IMPLEMENTED')
  }
}
console.log('P6-A local scaffold smoke PASS; authentication and content APIs remain unimplemented.')
