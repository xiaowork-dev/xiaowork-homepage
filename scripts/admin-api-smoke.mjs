// Local P6-B acceptance only: real Docker TTY initialization and verified HTTPS.
// No password is accepted from argv, env, a pipe, a repository file or a default.
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import http from 'node:http'

const origin = new URL(process.env.V11_TEST_ORIGIN || 'https://localhost:3443')
assert.equal(origin.protocol, 'https:')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
assert.equal(origin.pathname + origin.search + origin.hash + origin.username + origin.password, '/')
const mode = process.argv[2] || 'verify'
assert.ok(['initialize-test', 'verify'].includes(mode))
const statePath = '.cache/p6b-local-session.json'
const api = '/api/admin/v1'
let cookies = new Map()
let csrf = ''
let revision = ''
const log = (method, path, expected, actual) =>
  console.log(`HTTP ${method} ${path} expected=${expected} actual=${actual}`)

async function request(method, path, expected, body, options = {}) {
  const headers = new Headers(options.headers)
  if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '))
  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('Origin', options.origin || origin.origin)
    if (!options.noCSRF) headers.set('X-CSRF-Token', options.csrf || csrf)
    if (revision) headers.set('If-Match', `"${options.revision || revision}"`)
  }
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }
  const res = await fetch(new URL(api + path, origin), {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  log(method, path, expected, res.status)
  assert.equal(res.status, expected, `${method} ${path} status`)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.match(res.headers.get('x-robots-tag') || '', /noindex/)
  for (const value of res.headers.getSetCookie()) {
    assert.match(value, /; Secure/i)
    assert.match(value, /; HttpOnly/i)
    assert.match(value, /; SameSite=Strict/i)
    const [key, ...parts] = value.split(';')[0].split('=')
    if (/Max-Age=0|Max-Age=-1/i.test(value)) cookies.delete(key)
    else cookies.set(key, parts.join('='))
  }
  if (options.binary) return Buffer.from(await res.arrayBuffer())
  const envelope = res.status === 204 ? {} : await res.json()
  if (envelope.data?.revision) revision = envelope.data.revision
  return envelope.data || envelope.error || envelope
}

// The Docker API allocates a genuine container PTY. Password bytes are generated
// only in this process and written after the CLI's hidden-input prompt.
async function initializeThroughTTY(password) {
  const cli = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
  const container = cli('compose', '-f', 'compose.admin-dev.yaml', 'ps', '-q', 'api')
  assert.match(container, /^[a-f0-9]{12,64}$/)
  const project = cli(
    'inspect',
    '--format',
    '{{index .Config.Labels "com.docker.compose.project"}}',
    container,
  )
  assert.equal(project, 'xiaowork-homepage-v11-dev')
  const endpoint = cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}')
  assert.equal(
    endpoint,
    'npipe:////./pipe/dockerDesktopLinuxEngine',
    'Expected local Docker Desktop pipe',
  )
  const socketPath = '\\\\.\\pipe\\dockerDesktopLinuxEngine'
  const version = cli('version', '--format', '{{.Server.APIVersion}}')
  assert.match(version, /^1\.\d+$/)
  const call = (path, payload) =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(payload)
      const req = http.request(
        {
          socketPath,
          path: `/v${version}${path}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (c) => {
            text += c
          })
          res.on('end', () => {
            try {
              assert.ok(res.statusCode < 300, 'Docker local exec creation failed')
              resolve(JSON.parse(text))
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      req.on('error', reject)
      req.end(data)
    })
  const created = await call(`/containers/${container}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: ['/homepage-api', 'init-admin'],
  })
  await new Promise((resolve, reject) => {
    const data = JSON.stringify({ Detach: false, Tty: true })
    const req = http.request({
      socketPath,
      path: `/v${version}/exec/${created.Id}/start`,
      method: 'POST',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'tcp',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    })
    let stage = 0
    let output = ''
    let finished = false
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error('Local TTY initialization timed out'))
    }, 15000)
    req.on('upgrade', (_res, stream, head) => {
      const consume = (bytes) => {
        output += bytes.toString('utf8')
        if (stage === 0 && output.includes('Administrator username:')) {
          stage = 1
          output = ''
          stream.write('local-p6b-test\n')
        } else if (stage === 1 && output.includes('New password (')) {
          stage = 2
          output = ''
          stream.write(password + '\n')
        } else if (stage === 2 && output.includes('Confirm new password (')) {
          stage = 3
          output = ''
          stream.write(password + '\n')
        } else if (stage === 3 && output.includes('Administrator operation completed')) {
          finished = true
          clearTimeout(timer)
          stream.end()
          resolve()
        }
      }
      if (head.length) consume(head)
      stream.on('data', consume)
      stream.on('error', reject)
      stream.on('end', () => {
        if (!finished) {
          clearTimeout(timer)
          reject(new Error('Local TTY initialization failed; no credentials printed'))
        }
      })
    })
    req.on('response', () => {
      clearTimeout(timer)
      reject(new Error('Docker did not allocate a genuine TTY'))
    })
    req.on('error', reject)
    req.end(data)
  })
  console.log('PASS real container TTY account initialization; password hidden and not logged')
}

if (mode === 'initialize-test') {
  const password = 'P6B-' + randomBytes(24).toString('base64url')
  await initializeThroughTTY(password)
  await request('GET', '/workspace', 401)
  const challenge = await request('GET', '/auth/login-challenge', 200)
  const login = await request(
    'POST',
    '/auth/login',
    200,
    { username: 'local-p6b-test', password },
    { csrf: challenge.loginNonce },
  )
  csrf = login.csrfToken
  assert.ok(csrf)
  console.log('PASS trusted local HTTPS, __Host Secure HttpOnly SameSite=Strict session')
  await mkdir('.cache', { recursive: true })
  await writeFile(statePath, JSON.stringify({ cookies: [...cookies], csrf }), { mode: 0o600 })
  console.log(
    'Test session retained only in ignored local cache; run explicit import-v1 then verify',
  )
} else {
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  cookies = new Map(state.cookies)
  csrf = state.csrf
  await request('GET', '/auth/session', 200)
  const workspace = await request('GET', '/workspace', 200)
  assert.equal(workspace.origin, 'https://xiaoworks.com')
  assert.equal(workspace.initialized, true)
  const originalIDs = ['xiaowork-blog', 'xiaowork-nav', 'xiaowork-erp']
  for (const id of originalIDs) {
    const p = workspace.projects.find((p) => p.id === id)
    assert.ok(p && p.isPlaceholder && p.status === 'unconfirmed' && p.featured)
    assert.deepEqual(p.techStack, [])
    assert.equal(p.demoUrl, null)
    assert.equal(p.repositoryUrl, null)
  }
  console.log('PASS V1.0 IDs/order/featured/unconfirmed placeholder data retained')
  if (state.proof) {
    const project = workspace.projects.find((p) => p.id === state.proof.projectID)
    assert.equal(project.summary, state.proof.summary)
    const bytes = await request('GET', `/media/${state.proof.assetID}/content`, 200, undefined, {
      binary: true,
    })
    assert.equal(createHash('sha256').update(bytes).digest('hex'), state.proof.assetHash)
    assert.equal(workspace.revision, state.proof.revision)
    console.log(
      'PASS account/session/draft revision/media survived API container recreation and re-import',
    )
  } else {
    await request('PUT', '/settings', 403, workspace.settings, { noCSRF: true })
    await request('POST', '/publish-jobs', 503, {})
    await request('POST', '/preview-jobs', 503, {})
    await request('POST', '/rollback-jobs', 503, {})
    const candidate = {
      ...workspace.projects[0],
      slug: `p6b-local-${randomBytes(4).toString('hex')}`,
      name: '隔离验收测试项目',
      summary: '仅位于本机测试草稿，从未公开发布。',
    }
    for (const key of ['id', 'order', 'createdAt', 'updatedAt', 'archivedAt']) delete candidate[key]
    const before = revision
    const created = await request('POST', '/projects', 201, candidate, {
      headers: { 'Idempotency-Key': randomBytes(16).toString('hex') },
    })
    await request('PUT', `/projects/${created.project.id}`, 409, candidate, { revision: before })
    await request('PUT', `/projects/${created.project.id}`, 422, {
      ...candidate,
      demoUrl: 'javascript:alert(1)',
    })
    await request('PUT', `/projects/${created.project.id}`, 400, { ...candidate, Name: 'alias' })
    const assetInput = new FormData()
    // Small real repository PNG; never misrepresented as a project screenshot.
    assetInput.set(
      'file',
      new Blob([await readFile('public/images/social/xiaowork-share.png')], { type: 'image/png' }),
      'local-acceptance.png',
    )
    const uploaded = await request('POST', '/media', 201, assetInput)
    const asset = uploaded.media
    assert.ok(asset?.id)
    candidate.cover = { kind: 'media', id: asset.id }
    const saved = await request('PUT', `/projects/${created.project.id}`, 200, candidate)
    await request('DELETE', `/media/${asset.id}`, 409)
    const bytes = await request('GET', `/media/${asset.id}/content`, 200, undefined, {
      binary: true,
    })
    state.proof = {
      projectID: saved.project.id,
      summary: saved.project.summary,
      assetID: asset.id,
      assetHash: createHash('sha256').update(bytes).digest('hex'),
      revision,
    }
    state.cookies = [...cookies]
    state.csrf = csrf
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
    console.log('PASS persisted draft/media proof recorded locally for container recreation check')
  }
}
