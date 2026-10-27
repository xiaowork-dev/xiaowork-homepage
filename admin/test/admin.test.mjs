import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient } from '../src/lib/api.ts'
import { createAdmin } from '../src/lib/admin.ts'

const session = {
  administrator: { id: 1, username: 'test-admin' },
  csrfToken: 'A'.repeat(43),
  expiresAt: '2026-10-27T12:00:00Z',
  idleExpiresAt: '2026-10-27T00:30:00Z',
  reauthUntil: '2026-10-27T00:05:00Z',
}
const workspace = {
  revision: 'ws-7',
  projects: [],
  categories: [],
  profile: null,
  settings: null,
  origin: 'https://xiaoworks.com',
  initialized: false,
  validation: { code: 'CONTENT_NOT_INITIALIZED', message: '未初始化' },
}
const json = (data) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } })
const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '需要登录' } }), {
    status: 401,
  })

test('initial missing session is login state rather than a false expiry warning', async () => {
  const admin = createAdmin(new ApiClient({ fetcher: async () => unauthorized() }))
  assert.equal(await admin.restore(), false)
  assert.equal(admin.session.value, null)
  assert.equal(admin.authExpired.value, false)
})

test('login always requests a fresh challenge and keeps credentials only in memory', async () => {
  const requests = []
  const admin = createAdmin(
    new ApiClient({
      fetcher: async (path, options) => {
        requests.push(path)
        if (path.endsWith('/login-challenge'))
          return json({ loginNonce: 'B'.repeat(43), expiresAt: session.reauthUntil })
        assert.equal(options.headers.get('X-CSRF-Token'), 'B'.repeat(43))
        assert.deepEqual(JSON.parse(options.body), {
          username: 'test-admin',
          password: 'test-only in-memory password',
        })
        return json(session)
      },
    }),
  )
  await admin.login('test-admin', 'test-only in-memory password')
  await admin.login('test-admin', 'test-only in-memory password')
  assert.equal(requests.filter((path) => path.endsWith('/login-challenge')).length, 2)
  assert.equal(admin.session.value.administrator.username, 'test-admin')
  assert.equal(admin.authExpired.value, false)
})

test('401 clears authentication but preserves the loaded draft and form baseline', async () => {
  let expired = false
  const admin = createAdmin(
    new ApiClient({
      fetcher: async (path) => {
        if (expired) return unauthorized()
        return json(path.endsWith('/auth/session') ? session : workspace)
      },
    }),
  )
  assert.equal(await admin.restore(), true)
  await admin.loadWorkspace()
  const before = admin.workspace.value
  expired = true
  await assert.rejects(admin.get('/projects'), (error) => error.status === 401)
  assert.equal(admin.session.value, null)
  assert.equal(admin.workspace.value, before)
  assert.equal(admin.authExpired.value, true)
  assert.match(admin.notice.value, /表单会保留/)
})

test('confirmed logout clears cached private state; a network-failed logout does not claim success', async () => {
  let offline = false
  const admin = createAdmin(
    new ApiClient({
      fetcher: async (path) => {
        if (offline) throw new Error('offline')
        if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 })
        return json(path.endsWith('/auth/session') ? session : workspace)
      },
    }),
  )
  await admin.restore()
  await admin.loadWorkspace()
  offline = true
  await assert.rejects(admin.logout(), (error) => error.code === 'NETWORK_ERROR')
  assert.notEqual(admin.session.value, null)
  offline = false
  await admin.logout()
  assert.equal(admin.session.value, null)
  assert.equal(admin.workspace.value, null)
})

test('a delayed workspace response cannot repopulate cached data after logout', async () => {
  let finish
  const admin = createAdmin(
    new ApiClient({
      fetcher: async (path) => {
        if (path.endsWith('/workspace'))
          return new Promise((resolve) => {
            finish = resolve
          })
        if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 })
        return json(session)
      },
    }),
  )
  await admin.restore()
  const pending = admin.loadWorkspace()
  await admin.logout()
  finish(json(workspace))
  await pending
  assert.equal(admin.workspace.value, null)
})

test('an older workspace read completing last cannot replace a newer read in the same session', async () => {
  const pending = []
  const admin = createAdmin(
    new ApiClient({
      fetcher: async (path) => {
        if (path.endsWith('/workspace'))
          return new Promise((resolve) => {
            pending.push(resolve)
          })
        return json(session)
      },
    }),
  )
  await admin.restore()
  const olderRead = admin.loadWorkspace()
  const newerRead = admin.loadWorkspace()
  assert.equal(pending.length, 2)

  const newerWorkspace = { ...workspace, revision: 'ws-8' }
  pending[1](json(newerWorkspace))
  assert.deepEqual(await newerRead, newerWorkspace)
  const accepted = admin.workspace.value
  assert.equal(accepted.revision, 'ws-8')

  pending[0](json(workspace))
  assert.deepEqual(await olderRead, workspace, 'caller still receives its original snapshot')
  assert.equal(admin.workspace.value, accepted, 'late read cannot replace shared cache')
  assert.equal(admin.workspace.value.revision, 'ws-8')
})

test('revision conflicts leave the shared draft untouched and are surfaced to caller', async () => {
  const admin = createAdmin(
    new ApiClient({
      fetcher: async (path, options) => {
        if (options.method === 'PUT')
          return new Response(
            JSON.stringify({
              error: { code: 'REVISION_CONFLICT', message: '内容冲突', currentRevision: 'ws-8' },
            }),
            { status: 409 },
          )
        return json(path.endsWith('/auth/session') ? session : workspace)
      },
    }),
  )
  await admin.restore()
  await admin.loadWorkspace()
  const before = admin.workspace.value
  await assert.rejects(
    admin.write('PUT', '/profile', { userInput: 'keep' }, 'ws-7'),
    (error) => error.status === 409 && error.currentRevision === 'ws-8',
  )
  assert.equal(admin.workspace.value, before)
  assert.equal(admin.workspace.value.revision, 'ws-7')
})
