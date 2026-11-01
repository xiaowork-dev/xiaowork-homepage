import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { currentRepair } from './v11-current-repair.mjs'
import { volumeNames, backupProject } from './v11-maintenance.mjs'
import { assertNoRecovery } from './v11-operation.mjs'
for (const scenario of [
  'read-failure',
  'foreign-writer',
  'success',
  'outer-assertion',
  'metadata-delta',
]) {
  test(`完整离线保护：${scenario}`, () => {
    const project = 'xiaowork-homepage-v11-p6e-guard-' + scenario
    const directory = path.resolve('.v11-deploy', project)
    assert.equal(fs.existsSync(directory), false, '保留已有现场')
    const original = childProcess.execFileSync
    const priorHost = process.env.DOCKER_HOST
    delete process.env.DOCKER_HOST
    let operation,
      metadata = 0
    childProcess.execFileSync = (_file, args) => {
      if (args[0] === 'context') return 'npipe:////./pipe/dockerDesktopLinuxEngine'
      if (args[0] === 'image') return 'sha256:' + 'a'.repeat(64)
      if (args[0] === 'volume') return Object.values(volumeNames(project)).join('\n')
      if (args[0] === 'ps') return scenario === 'foreign-writer' ? 'foreign' : ''
      if (args[0] === 'create') {
        operation = args.find((v) => ['metadata-readonly', 'inspect-current'].includes(v))
        return 'test-container'
      }
      if (args[0] === 'inspect') {
        if (args.at(-1) === 'foreign')
          return JSON.stringify([{ Name: volumeNames(project).db, RW: true }])
        if (args[2].includes('ExitCode')) return '0'
        return JSON.stringify(
          Object.entries(volumeNames(project)).map(([role, name]) => ({
            Type: 'volume',
            Name: name,
            Destination: '/source/' + role,
            RW: false,
          })),
        )
      }
      if (args[0] === 'start') {
        if (operation === 'metadata-readonly')
          return JSON.stringify(
            scenario === 'metadata-delta' && ++metadata === 2 ? [{ path: 'changed' }] : [],
          )
        if (scenario === 'read-failure') throw Error('database-wal-state-unproven')
        return JSON.stringify({ candidates: [] })
      }
      if (args[0] === 'rm') return ''
      throw Error('Unexpected subprocess: ' + args[0])
    }
    syncBuiltinESMExports()
    try {
      const call = () =>
        currentRepair(
          'inspect',
          project,
          'sha256:' + 'a'.repeat(64),
          undefined,
          undefined,
          undefined,
          scenario === 'outer-assertion'
            ? () => {
                throw Error('outer-acceptance-failed')
              }
            : undefined,
        )
      if (scenario === 'success') assert.deepEqual(call(), { candidates: [] })
      else assert.throws(call)
      const failed = scenario !== 'success'
      assert.equal(fs.existsSync(path.join(directory, 'operation.lock')), failed)
      assert.equal(fs.existsSync(path.join(directory, 'recovery-required.json')), failed)
      if (failed) {
        assert.throws(() => assertNoRecovery(project), /Persistent/)
        assert.throws(call, /Persistent/)
        assert.throws(
          () => backupProject(project, 'sha256:' + 'a'.repeat(64), 'unused'),
          /Persistent/,
        )
      }
    } finally {
      childProcess.execFileSync = original
      syncBuiltinESMExports()
      if (priorHost !== undefined) process.env.DOCKER_HOST = priorHost
      assert.ok(directory.startsWith(path.resolve('.v11-deploy') + path.sep))
      fs.rmSync(directory, { recursive: true }) // 本测试在入口明确新建的合成控制目录。
    }
  })
}
test('进程异常退出后持久标记阻断新的进程', () => {
  const project = 'xiaowork-homepage-v11-p6e-exit-' + Date.now().toString(36)
  const state = path.resolve('.v11-deploy', project)
  const script = `import {guardedOperation} from './scripts/v11-operation.mjs';guardedOperation('${project}','current-inspect',()=>process.exit(91))`
  const result = childProcess.spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 91)
  assert.ok(fs.existsSync(path.join(state, 'operation.lock')))
  const again = childProcess.spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { encoding: 'utf8' },
  )
  assert.notEqual(again.status, 0)
  assert.match(again.stderr, /Persistent recovery-required/)
  assert.ok(state.startsWith(path.resolve('.v11-deploy') + path.sep))
  fs.rmSync(state, { recursive: true }) // 仅删除本单测独占创建的无数据控制目录。
})
