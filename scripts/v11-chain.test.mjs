import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  protectedChain,
  guardedOperation,
  operationState,
  assertNoRecovery,
  chainOwner,
} from './v11-operation.mjs'

const fresh = (name) => 'xiaowork-homepage-v11-chain-' + name + '-' + randomBytes(4).toString('hex')
const protectedState = (p) => {
  assert.ok(fs.statSync(path.join(operationState(p), 'operation.lock')).isDirectory())
  return JSON.parse(fs.readFileSync(path.join(operationState(p), 'recovery-required.json')))
}

test('async full-chain guard survives nested successful repair and rejects external processes', async () => {
  const p = fresh('success')
  await protectedChain([p], 'test-full-chain', async () => {
    const before = protectedState(p)
    await Promise.resolve()
    assertNoRecovery(p)
    assert.equal(chainOwner(p), before.owner)
    guardedOperation(p, 'current-inspect', (context) => context.record('accepted', { test: true }))
    assert.deepEqual(protectedState(p), before)
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {assertNoRecovery} from ${JSON.stringify(pathToFileURL(path.resolve('scripts/v11-operation.mjs')).href)};assertNoRecovery(${JSON.stringify(p)})`,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /blocks new tasks/)
  })
  assertNoRecovery(p)
  assert.ok(!fs.existsSync(path.join(operationState(p), 'recovery-required.json')))
})

test('later assertion failure retains all project guards including completed stages', async () => {
  const projects = [fresh('first'), fresh('second')]
  await assert.rejects(
    protectedChain(projects, 'test-full-chain', async () => {
      guardedOperation(projects[0], 'current-apply', () => ({ verified: true }))
      await Promise.resolve()
      throw Error('outer metadata acceptance failed')
    }),
    /outer metadata/,
  )
  for (const p of projects) {
    protectedState(p)
    assert.throws(() => assertNoRecovery(p), /blocks new tasks/)
  }
})

test('caught nested failure poisons the chain and cannot release or continue', async () => {
  const p = fresh('poison')
  await assert.rejects(
    protectedChain([p], 'test-full-chain', async () => {
      assert.throws(() =>
        guardedOperation(p, 'current-inspect', () => {
          throw Error('check failed')
        }),
      )
      assert.throws(() => assertNoRecovery(p), /chain has failed/)
    }),
    /failed nested stage/,
  )
  protectedState(p)
})

test('controller process exit retains durable guards without cleanup handlers', () => {
  const p = fresh('exit')
  const module = pathToFileURL(path.resolve('scripts/v11-operation.mjs')).href
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {protectedChain} from ${JSON.stringify(module)};await protectedChain([${JSON.stringify(p)}],'test-controller-exit',async()=>{process.exit(47)})`,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 47)
  protectedState(p)
  assert.throws(() => assertNoRecovery(p), /blocks new tasks/)
})
