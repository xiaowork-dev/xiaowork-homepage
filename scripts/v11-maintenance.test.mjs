import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import {
  assertMaintenanceIdentity,
  backupMountPlan,
  localEngine,
  restorePopulateMounts,
  volumeNames,
} from './v11-maintenance.mjs'

function withDocker(fake, fn) {
  const original = childProcess.execFileSync
  childProcess.execFileSync = fake
  syncBuiltinESMExports()
  try {
    return fn()
  } finally {
    childProcess.execFileSync = original
    syncBuiltinESMExports()
  }
}

test('remote DOCKER_HOST is refused before any Docker command', () => {
  const prior = process.env.DOCKER_HOST
  let invoked = 0
  process.env.DOCKER_HOST = 'tcp://invalid.example:2375'
  try {
    withDocker(
      () => {
        invoked++
        throw new Error('Docker must not be invoked by this local-only test')
      },
      () => assert.throws(() => localEngine(), /Only explicitly local DOCKER_HOST/),
    )
    assert.equal(invoked, 0)
  } finally {
    if (prior === undefined) delete process.env.DOCKER_HOST
    else process.env.DOCKER_HOST = prior
  }
})

test('backup binds only the new backup directory, never its parent', () => {
  const absolute = path.resolve('/srv/v11-backups/acc1-20261108')
  const plan = backupMountPlan(absolute)
  assert.deepEqual(plan.mount, ['--mount', `type=bind,src=${absolute},dst=/backup`])
  assert.equal(plan.target, '/backup/content')
  assert.ok(
    !plan.mount[1].includes(path.dirname(absolute) + ','),
    'parent must not be the bind source',
  )
  assert.ok(!plan.mount[1].includes('readonly'), 'backup output mount must be writable')
})

test('backup mount plan rejects relative or separator-bearing destinations', () => {
  assert.throws(() => backupMountPlan('relative/backup'), /absolute/)
  assert.throws(() => backupMountPlan(path.resolve('/srv/a,b')), /separators/)
  assert.throws(() => backupMountPlan(path.resolve('/srv/a=b')), /separators/)
})

test('restore ownership initialisation mounts exactly the new project volumes without nocopy', () => {
  const project = 'xiaowork-homepage-v11-restore1'
  const args = restorePopulateMounts(project)
  const names = volumeNames(project)
  assert.equal(args.length, Object.keys(names).length * 2)
  for (const [role, name] of Object.entries(names))
    assert.ok(args.includes(`type=volume,src=${name},dst=/target/${role}`), role)
  assert.ok(args.every((value) => !value.includes('volume-nocopy') && !value.includes('readonly')))
  assert.throws(() => restorePopulateMounts('other-project'))
})

test('maintenance identity is verified on the exact image before any ownership grant', () => {
  const image = 'sha256:' + 'a'.repeat(64)
  const calls = []
  withDocker(
    (cmd, args) => {
      calls.push([cmd, ...args])
      return '10001:10001\n'
    },
    () => assertMaintenanceIdentity(image),
  )
  assert.deepEqual(calls, [['docker', 'image', 'inspect', '--format', '{{.Config.User}}', image]])
  withDocker(
    () => '0:0\n',
    () => assert.throws(() => assertMaintenanceIdentity(image), /fixed UID\/GID 10001:10001/),
  )
  assert.throws(() => assertMaintenanceIdentity('xiaowork-homepage-maintenance:latest'))
})
