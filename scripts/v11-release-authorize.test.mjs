import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { lifecycleLockReleasable, removeStalePublisher, runLifecycle } from './v11-release.mjs'

const id = (c) => 'sha256:' + c.repeat(64)
const spec = {
  format: 1,
  source: execGitHead(),
  schema: 3,
  images: {
    api: id('1'),
    worker: id('2'),
    gateway: id('3'),
    frontend: id('4'),
    static: id('5'),
    maintenance: id('6'),
  },
}
function execGitHead() {
  return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

// Minimal fake Docker CLI: identity checks pass, no project containers exist,
// and every call is recorded. Any control-volume write would be visible here.
function fakeDocker(calls) {
  return (file, args) => {
    if (file === 'git') return ''
    calls.push(args.join(' '))
    const [verb] = args
    if (verb === 'context') return 'unix:///var/run/docker.sock\n'
    if (verb === 'image' && args.includes('{{.Id}}')) return args.at(-1) + '\n'
    if (verb === 'image') return spec.source + '\n'
    if (verb === 'tag' || verb === 'rm' || verb === 'ps') return ''
    if (verb === 'create') return 'c0ffee\n'
    if (verb === 'inspect' && args.some((a) => a.includes('ExitCode'))) return '0\n'
    if (verb === 'inspect') return '[]\n'
    if (verb === 'start') return '{"compatible":true}\n'
    throw new Error('unexpected docker call: ' + args.join(' '))
  }
}

test('authorize-publishing refused on a precondition releases its own lock and writes nothing', () => {
  const project = 'xiaowork-homepage-v11-authunit-' + randomBytes(3).toString('hex')
  const state = path.resolve('.v11-deploy', project)
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(state, 'current.json'),
    JSON.stringify({
      project,
      topology: 'openresty',
      httpPort: 3299,
      httpsPort: 3298,
      subnet: '192.168.253.0/28',
      publish: false,
      spec,
      createdAt: new Date().toISOString(),
    }),
  )
  const calls = []
  const original = childProcess.execFileSync
  childProcess.execFileSync = fakeDocker(calls)
  syncBuiltinESMExports()
  try {
    // No last-backup.json: the backup precondition must refuse.
    assert.throws(
      () =>
        runLifecycle([
          'authorize-publishing',
          '--project',
          project,
          '--approval-note',
          '单元测试：缺少备份时拒绝授权',
        ]),
      /last-backup\.json|ENOENT/,
    )
  } finally {
    childProcess.execFileSync = original
    syncBuiltinESMExports()
  }
  assert.ok(!fs.existsSync(path.join(state, 'operation.lock')), 'refusal must release its own lock')
  assert.ok(!calls.some((c) => c.includes('authorize-publish')), 'no authorization may be written')
  assert.ok(!calls.some((c) => c.startsWith('compose')), 'no service may be started')
  // A later command is not blocked by the refused authorization.
  fs.mkdirSync(path.join(state, 'operation.lock'), { mode: 0o700 })
  fs.rmdirSync(path.join(state, 'operation.lock'))
  fs.rmSync(state, { recursive: true })
})

test('authorize-publishing is refused outright for the simulation topology', () => {
  const project = 'xiaowork-homepage-v11-authunit-' + randomBytes(3).toString('hex')
  const state = path.resolve('.v11-deploy', project)
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(state, 'current.json'),
    JSON.stringify({
      project,
      topology: 'simulation',
      httpPort: 3299,
      httpsPort: 3298,
      subnet: '192.168.253.0/28',
      publish: true,
      spec,
    }),
  )
  const calls = []
  const original = childProcess.execFileSync
  childProcess.execFileSync = fakeDocker(calls)
  syncBuiltinESMExports()
  try {
    assert.throws(
      () =>
        runLifecycle([
          'authorize-publishing',
          '--project',
          project,
          '--approval-note',
          '本地拓扑不应授权',
        ]),
      /openresty/,
    )
  } finally {
    childProcess.execFileSync = original
    syncBuiltinESMExports()
  }
  assert.ok(!fs.existsSync(path.join(state, 'operation.lock')))
  fs.rmSync(state, { recursive: true })
})

test('a stopped publisher left by an authorized release is removed when publishing is off', () => {
  const calls = []
  const original = childProcess.execFileSync
  childProcess.execFileSync = (file, args) => {
    calls.push(args.join(' '))
    if (args[0] === 'ps') return 'deadbeef\n'
    if (args[0] === 'inspect') return 'false\n'
    if (args[0] === 'rm') return ''
    throw new Error('unexpected docker call: ' + args.join(' '))
  }
  syncBuiltinESMExports()
  try {
    assert.equal(removeStalePublisher('xiaowork-homepage-v11-unit'), 1)
  } finally {
    childProcess.execFileSync = original
    syncBuiltinESMExports()
  }
  assert.ok(calls[0].includes('label=com.docker.compose.project=xiaowork-homepage-v11-unit'))
  assert.ok(calls[0].includes('label=com.docker.compose.service=worker'))
  assert.deepEqual(calls.at(-1), 'rm deadbeef')
})

test('a running publisher is never removed while publishing is off', () => {
  const calls = []
  const original = childProcess.execFileSync
  childProcess.execFileSync = (file, args) => {
    calls.push(args.join(' '))
    if (args[0] === 'ps') return 'deadbeef\n'
    if (args[0] === 'inspect') return 'true\n'
    throw new Error('unexpected docker call: ' + args.join(' '))
  }
  syncBuiltinESMExports()
  try {
    assert.throws(() => removeStalePublisher('xiaowork-homepage-v11-unit'), /running publisher/)
  } finally {
    childProcess.execFileSync = original
    syncBuiltinESMExports()
  }
  assert.ok(!calls.some((c) => c.startsWith('rm')))
})

test('a verified safe restore releases the lock; unconfirmed recovery and chains never do', () => {
  const base = {
    lock: '/state/operation.lock',
    inherited: false,
    operationAccepted: false,
    releaseOnRefusal: false,
    safelyRestored: false,
  }
  assert.equal(lifecycleLockReleasable(base), false, 'plain failure keeps the lock')
  assert.equal(
    lifecycleLockReleasable({ ...base, safelyRestored: true }),
    true,
    'documented safe restore lifts the block',
  )
  assert.equal(lifecycleLockReleasable({ ...base, operationAccepted: true }), true)
  assert.equal(lifecycleLockReleasable({ ...base, releaseOnRefusal: true }), true)
  assert.equal(
    lifecycleLockReleasable({ ...base, safelyRestored: true, lock: undefined }),
    false,
    'manual-recovery path cleared the lock variable',
  )
  assert.equal(
    lifecycleLockReleasable({ ...base, safelyRestored: true, inherited: true }),
    false,
    'a parent chain stays protected',
  )
})
