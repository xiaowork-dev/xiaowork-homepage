import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { currentRepair } from './v11-current-repair.mjs'
import { volumeNames } from './v11-maintenance.mjs'

for (const scenario of ['read-failure', 'foreign-writer', 'success']) {
  test(`offline guard: ${scenario}`, () => {
    const project = 'xiaowork-homepage-v11-p6e-ro-unit-' + scenario
    const directory = path.resolve('.v11-deploy', project)
    assert.equal(fs.existsSync(directory), false, 'Do not overwrite a retained test site')
    const original = childProcess.execFileSync
    const priorHost = process.env.DOCKER_HOST
    delete process.env.DOCKER_HOST
    let inspected = false
    childProcess.execFileSync = (_file, args) => {
      if (args[0] === 'context') return 'npipe:////./pipe/dockerDesktopLinuxEngine'
      if (args[0] === 'image') return 'sha256:' + 'a'.repeat(64)
      if (args[0] === 'volume') return Object.values(volumeNames(project)).join('\n')
      if (args[0] === 'ps')
        return args.includes('-q') && scenario === 'foreign-writer' ? 'foreign' : ''
      if (args[0] === 'inspect')
        return JSON.stringify([{ Name: volumeNames(project).db, RW: true }])
      if (args[0] === 'run') {
        inspected = true
        if (scenario === 'read-failure') throw new Error('database-wal-state-unproven')
        return JSON.stringify({ candidates: [] })
      }
      throw new Error('Unexpected subprocess')
    }
    syncBuiltinESMExports()
    try {
      const action = () => currentRepair('inspect', project, 'sha256:' + 'a'.repeat(64))
      if (scenario === 'success') assert.deepEqual(action(), { candidates: [] })
      else
        assert.throws(action, scenario === 'foreign-writer' ? /writable access/ : /state-unproven/)
      const lock = path.join(directory, 'operation.lock')
      assert.equal(fs.existsSync(lock), scenario === 'read-failure')
      assert.equal(inspected, scenario !== 'foreign-writer')
      if (scenario === 'read-failure') {
        const evidence = JSON.parse(fs.readFileSync(path.join(lock, 'inspection.json')))
        assert.equal(evidence.project, project)
        assert.equal(evidence.command, 'inspect')
        // This test owns this exact synthetic guard, never an operator lock.
        fs.unlinkSync(path.join(lock, 'inspection.json'))
        fs.rmdirSync(lock)
      }
      fs.rmdirSync(directory)
    } finally {
      childProcess.execFileSync = original
      syncBuiltinESMExports()
      if (priorHost !== undefined) process.env.DOCKER_HOST = priorHost
    }
  })
}
