import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
import { localEngine } from './v11-maintenance.mjs'

test('remote DOCKER_HOST is refused before any Docker command', () => {
  const prior = process.env.DOCKER_HOST
  const original = childProcess.execFileSync
  let invoked = 0
  process.env.DOCKER_HOST = 'tcp://invalid.example:2375'
  childProcess.execFileSync = () => {
    invoked++
    throw new Error('Docker must not be invoked by this local-only test')
  }
  syncBuiltinESMExports()
  try {
    assert.throws(() => localEngine(), /Only explicitly local DOCKER_HOST/)
    assert.equal(invoked, 0)
  } finally {
    childProcess.execFileSync = original
    syncBuiltinESMExports()
    if (prior === undefined) delete process.env.DOCKER_HOST
    else process.env.DOCKER_HOST = prior
  }
})
