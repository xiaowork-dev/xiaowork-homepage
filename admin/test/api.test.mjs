import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiClient,
  ApiError,
  newIdempotencyKey,
  normalizeApiPath,
  safeMediaURL,
  validateUploadFile,
} from '../src/lib/api.ts'

const csrf = 'A'.repeat(43)
const mediaPath = '/api/admin/v1/media/med_' + 'a'.repeat(32) + '/content'
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
const failure = (status, code, more = {}, headers = {}) =>
  new Response(JSON.stringify({ error: { code, message: '受控错误', fields: [], ...more } }), {
    status,
    headers,
  })

test('API and media destinations reject alternate origins, traversal and ambiguous paths', () => {
  assert.equal(
    normalizeApiPath('/projects?limit=100&cursor=abc'),
    '/api/admin/v1/projects?limit=100&cursor=abc',
  )
  for (const path of [
    'https://evil.example/api',
    '//evil.example/api',
    '/../auth',
    '/%2e%2e/auth',
    '/media\\x',
    '/projects#token',
    '/projects\n',
  ])
    assert.throws(() => normalizeApiPath(path), ApiError)
  assert.equal(safeMediaURL(mediaPath), mediaPath)
  for (const value of [
    'https://evil.example' + mediaPath,
    'https://localhost' + mediaPath,
    '//' + mediaPath,
    mediaPath + '?token=secret',
    mediaPath + '/..',
    '/images/arbitrary.svg',
    null,
  ])
    assert.equal(safeMediaURL(value), null)
})

test('reads use only same-origin cookies, no-store and no redirects', async () => {
  const client = new ApiClient({
    fetcher: async (path, options) => {
      assert.equal(path, '/api/admin/v1/workspace')
      assert.equal(options.credentials, 'same-origin')
      assert.equal(options.mode, 'same-origin')
      assert.equal(options.cache, 'no-store')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.has('X-CSRF-Token'), false)
      return json({ revision: 'ws-7' })
    },
  })
  assert.deepEqual(await client.request('GET', '/workspace'), { revision: 'ws-7' })
})

test('writes carry explicit revision, CSRF and stable caller-owned idempotency key', async () => {
  const intent = newIdempotencyKey()
  assert.match(intent, /^[A-Za-z0-9_-]{16,128}$/)
  const client = new ApiClient({
    fetcher: async (path, options) => {
      assert.equal(path, '/api/admin/v1/projects')
      assert.equal(options.headers.get('If-Match'), '"ws-7"')
      assert.equal(options.headers.get('X-CSRF-Token'), csrf)
      assert.equal(options.headers.get('Idempotency-Key'), intent)
      assert.equal(
        options.headers.has('Origin'),
        false,
        'browser supplies exact same-origin Origin',
      )
      assert.deepEqual(JSON.parse(options.body), { name: '项目' })
      return json({ revision: 'ws-8' }, 201)
    },
  })
  client.setCSRF(csrf)
  assert.deepEqual(await client.write('POST', '/projects', { name: '项目' }, 'ws-7', intent), {
    revision: 'ws-8',
  })
  await assert.rejects(
    client.write('PUT', '/projects/id', {}, ''),
    (error) => error.code === 'REVISION_REQUIRED',
  )
  await assert.rejects(
    client.write('PUT', '/projects/id', {}, '*'),
    (error) => error.code === 'REVISION_REQUIRED',
  )
})

test('409 preserves conflict metadata and never silently retries', async () => {
  let calls = 0
  const client = new ApiClient({
    fetcher: async () => {
      calls++
      return failure(409, 'REVISION_CONFLICT', { currentRevision: 'ws-8' })
    },
  })
  client.setCSRF(csrf)
  await assert.rejects(
    client.write('PUT', '/profile', { changed: true }, 'ws-7'),
    (error) => error.status === 409 && error.currentRevision === 'ws-8',
  )
  assert.equal(calls, 1)
})

test('401 invalidates in-memory CSRF once and later writes cannot proceed anonymously', async () => {
  let invalidated = 0
  let calls = 0
  const client = new ApiClient({
    fetcher: async () => {
      calls++
      return failure(401, 'AUTH_REQUIRED')
    },
    onUnauthorized: () => invalidated++,
  })
  client.setCSRF(csrf)
  await assert.rejects(client.request('GET', '/workspace'), (error) => error.status === 401)
  assert.equal(invalidated, 1)
  await assert.rejects(client.write('PUT', '/profile', {}, 'ws-7'), (error) => error.status === 401)
  assert.equal(calls, 1)
})

test('stale 401 from an old request cannot revoke a newly accepted login', async () => {
  let finish
  let invalidated = 0
  const client = new ApiClient({
    fetcher: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    onUnauthorized: () => invalidated++,
  })
  client.setCSRF(csrf)
  const request = client.request('GET', '/workspace')
  client.setCSRF('B'.repeat(43))
  finish(failure(401, 'AUTH_REQUIRED'))
  await assert.rejects(request, ApiError)
  assert.equal(invalidated, 0)
})

test('wrong current password preserves the session while an expired session still invalidates it', async () => {
  let invalidated = 0
  let expired = false
  const client = new ApiClient({
    fetcher: async (_path, options) => {
      assert.equal(options.headers.get('X-CSRF-Token'), csrf)
      return failure(401, expired ? 'AUTH_REQUIRED' : 'INVALID_CREDENTIALS')
    },
    onUnauthorized: () => invalidated++,
  })
  client.setCSRF(csrf)
  for (const path of ['/auth/password', '/auth/reauth']) {
    await assert.rejects(
      client.request('POST', path, { password: 'test-only wrong password' }),
      (error) => error.status === 401 && error.code === 'INVALID_CREDENTIALS',
    )
    assert.equal(invalidated, 0)
  }
  expired = true
  await assert.rejects(
    client.request('POST', '/auth/password', {}),
    (error) => error.code === 'AUTH_REQUIRED',
  )
  assert.equal(invalidated, 1)
})

test('422, 428 and 503 preserve server Chinese messages without reporting a successful write', async () => {
  for (const [status, code, message] of [
    [422, 'VALIDATION_FAILED', '输入内容不符合契约。'],
    [428, 'REVISION_REQUIRED', '请提供工作区版本。'],
    [503, 'WORKER_UNAVAILABLE', '静态预览、发布与恢复将在 P6-D 实现。'],
  ]) {
    let calls = 0
    const client = new ApiClient({
      fetcher: async () => {
        calls++
        return failure(status, code, { message })
      },
    })
    client.setCSRF(csrf)
    await assert.rejects(
      client.write('PUT', '/settings', { retained: true }, 'ws-7'),
      (error) => error.status === status && error.code === code && error.message === message,
    )
    assert.equal(calls, 1)
  }
})

test('network failures, timeouts and malformed responses have safe Chinese errors', async () => {
  const offline = new ApiClient({
    fetcher: async () => {
      throw new TypeError('private transport details')
    },
  })
  await assert.rejects(
    offline.request('GET', '/workspace'),
    (error) => error.code === 'NETWORK_ERROR' && !error.message.includes('private transport'),
  )
  const timeout = new ApiClient({
    fetcher: (_, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
  })
  await assert.rejects(
    timeout.request('GET', '/workspace', undefined, { timeout: 5 }),
    (error) => error.code === 'REQUEST_TIMEOUT',
  )
  const malformed = new ApiClient({
    fetcher: async () => new Response('<html>proxy failure</html>', { status: 200 }),
  })
  await assert.rejects(
    malformed.request('GET', '/workspace'),
    (error) => error.code === 'INVALID_RESPONSE',
  )
  const limited = new ApiClient({
    fetcher: async () => failure(429, 'RATE_LIMITED', {}, { 'Retry-After': '900' }),
  })
  await assert.rejects(
    limited.request('GET', '/auth/login-challenge'),
    (error) => error.retryAfter === 900,
  )
})

test('empty 204 responses do not attempt to parse JSON', async () => {
  const client = new ApiClient({ fetcher: async () => new Response(null, { status: 204 }) })
  client.setCSRF(csrf)
  assert.equal(await client.request('POST', '/auth/logout'), undefined)
})

test('upload preflight refuses unsupported types, dangerous names and oversize bytes', () => {
  assert.equal(validateUploadFile({ name: 'cover.webp', size: 100, type: 'image/webp' }), null)
  for (const file of [
    { name: 'attack.svg', size: 100, type: 'image/svg+xml' },
    { name: 'fake.png', size: 100, type: 'image/jpeg' },
    { name: '../cover.png', size: 100, type: 'image/png' },
    { name: 'cover.png', size: 10 * 1024 * 1024 + 1, type: 'image/png' },
    { name: 'cover.png', size: 0, type: 'image/png' },
  ])
    assert.equal(typeof validateUploadFile(file), 'string')
})

class FakeXHR {
  upload = {}
  headers = new Map()
  status = 201
  response = { data: { media: { contentUrl: mediaPath }, revision: 'ws-8' } }
  open(method, path) {
    this.method = method
    this.path = path
  }
  setRequestHeader(key, value) {
    this.headers.set(key, value)
  }
  getResponseHeader() {
    return null
  }
  send(body) {
    this.body = body
    this.upload.onprogress({ lengthComputable: true, loaded: 10, total: 10 })
    queueMicrotask(() => this.onload())
  }
}

test('XHR upload sends only one file and reports 100 only after validated response', async () => {
  const xhr = new FakeXHR()
  const progress = []
  const client = new ApiClient({ xhrFactory: () => xhr })
  client.setCSRF(csrf)
  const result = await client.upload(
    new File(['png fixture'], 'cover.png', { type: 'image/png' }),
    'ws-7',
    (value) => progress.push(value),
  )
  assert.equal(result.revision, 'ws-8')
  assert.equal(xhr.method, 'POST')
  assert.equal(xhr.path, '/api/admin/v1/media')
  assert.equal(xhr.withCredentials, true)
  assert.equal(xhr.headers.get('if-match'), '"ws-7"')
  assert.equal(xhr.headers.get('x-csrf-token'), csrf)
  assert.equal(xhr.headers.has('content-type'), false, 'browser creates multipart boundary')
  assert.deepEqual([...xhr.body.keys()], ['file'])
  assert.deepEqual(progress, [0, 99, 100])
})

test('upload without a workspace revision returns 428 before creating a transport', async () => {
  let transports = 0
  const client = new ApiClient({
    xhrFactory: () => {
      transports++
      return new FakeXHR()
    },
  })
  client.setCSRF(csrf)
  await assert.rejects(
    client.upload(new File(['fixture'], 'cover.png', { type: 'image/png' }), ''),
    (error) => error.status === 428 && error.code === 'REVISION_REQUIRED',
  )
  assert.equal(transports, 0)
})

test('XHR upload rejects an off-origin content URL even with status 201', async () => {
  const xhr = new FakeXHR()
  xhr.response.data.media.contentUrl = 'https://evil.example/cover.png'
  const progress = []
  const client = new ApiClient({ xhrFactory: () => xhr })
  client.setCSRF(csrf)
  await assert.rejects(
    client.upload(new File(['fixture'], 'cover.png', { type: 'image/png' }), 'ws-7', (value) =>
      progress.push(value),
    ),
    (error) => error.code === 'INVALID_RESPONSE',
  )
  assert.equal(progress.includes(100), false)
})
