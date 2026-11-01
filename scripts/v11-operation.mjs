// 受信离线控制目录；从不写入被验收的数据卷，也不被公网 API 调用。
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.v11-deploy')
// In-process capability for an operator lifecycle that just acquired its own
// atomic directory. A fresh process can never inherit this ownership.
const ownedLifecycleLocks = new Map()
const chains = new AsyncLocalStorage()
// A capability exists only in this process and only inside its async scope.
// No environment variable, CLI token, PID or marker is sufficient to inherit it.
export function chainOwner(project) {
  const chain = chains.getStore()
  if (!chain) return undefined
  assert.ok(!chain.failed, 'The protected chain has failed; no further stages are allowed')
  const owner = chain.owners.get(project)
  assert.ok(owner, 'Project is outside the declared protected chain')
  assert.equal(ownedLifecycleLocks.get(project), owner)
  const marker = JSON.parse(
    fs.readFileSync(path.join(operationState(project), 'recovery-required.json'), 'utf8'),
  )
  assert.equal(marker.owner, owner, 'The persistent chain guard changed')
  assert.equal(marker.project, project)
  return owner
}
export function claimLifecycleLock(project, owner) {
  assert.match(owner ?? '', /^[0-9a-f-]{36}$/)
  const state = operationState(project)
  const lock = path.join(state, 'operation.lock')
  assert.ok(fs.lstatSync(lock).isDirectory() && !fs.lstatSync(lock).isSymbolicLink())
  assert.deepEqual(fs.readdirSync(lock), [])
  assert.ok(!fs.existsSync(path.join(state, 'recovery-required.json')))
  assert.ok(!ownedLifecycleLocks.has(project))
  ownedLifecycleLocks.set(project, owner)
}
export function operationState(project) {
  assert.match(project ?? '', /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/)
  return path.join(root, project)
}
export function assertNoRecovery(project, lifecycleOwner) {
  lifecycleOwner ??= chainOwner(project)
  const state = operationState(project)
  const lock = path.join(state, 'operation.lock')
  if (fs.existsSync(lock))
    assert.ok(
      typeof lifecycleOwner === 'string' && ownedLifecycleLocks.get(project) === lifecycleOwner,
      'Persistent operation.lock blocks new tasks; missing recovery marker is not an unlock',
    )
  const file = path.join(state, 'recovery-required.json')
  if (!fs.existsSync(file)) return
  const marker = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(
    typeof lifecycleOwner === 'string' &&
      /^[0-9a-f-]{36}$/.test(lifecycleOwner) &&
      marker.owner === lifecycleOwner,
    'Persistent recovery-required marker blocks new maintenance, repair and update tasks',
  )
}
// Cover async HTTP acceptance and multiple operator commands without releasing
// any member's protection between stages. Failure/death deliberately leaves all
// project guards. Recovery is an explicit operator procedure, never a retry.
export async function protectedChain(projects, kind, action) {
  assert.ok(!chains.getStore(), 'Nested protected chains are forbidden')
  assert.ok(Array.isArray(projects) && projects.length > 0)
  assert.equal(new Set(projects).size, projects.length)
  const chain = { owners: new Map(), failed: false }
  const guards = []
  for (const project of projects) {
    const state = operationState(project)
    fs.mkdirSync(state, { recursive: true, mode: 0o700 })
    assertNoRecovery(project)
    const lock = path.join(state, 'operation.lock')
    fs.mkdirSync(lock, { mode: 0o700 })
    syncDirectory(state)
    const owner = randomUUID()
    claimLifecycleLock(project, owner)
    chain.owners.set(project, owner)
    const marker = path.join(state, 'recovery-required.json')
    durableRecord(marker, {
      format: 1,
      id: owner,
      owner,
      project,
      kind,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      phase: 'running-or-unreconciled',
      members: projects,
    })
    const history = path.join(state, 'operations')
    fs.mkdirSync(history, { recursive: true, mode: 0o700 })
    guards.push({ project, state, lock, marker, history, owner })
  }
  try {
    const result = await chains.run(chain, () => action())
    assert.ok(!chain.failed, 'A failed nested stage prevents chain acceptance')
    // Validate every ownership record before releasing any member.
    for (const g of guards) {
      assert.equal(ownedLifecycleLocks.get(g.project), g.owner)
      assert.equal(JSON.parse(fs.readFileSync(g.marker, 'utf8')).owner, g.owner)
      assert.deepEqual(fs.readdirSync(g.lock), [])
      durableRecord(path.join(g.history, g.owner + '.chain-completed.json'), {
        at: new Date().toISOString(),
        result: 'all-chain-acceptance-conditions-passed',
      })
    }
    for (const g of guards) {
      fs.unlinkSync(g.marker)
      syncDirectory(g.state)
      fs.rmdirSync(g.lock)
      syncDirectory(g.state)
      ownedLifecycleLocks.delete(g.project)
    }
    return result
  } catch (error) {
    chain.failed = true
    for (const g of guards) {
      try {
        durableRecord(path.join(g.history, g.owner + '.chain-failed.json'), {
          at: new Date().toISOString(),
          error: String(error.message).slice(0, 2000),
          recovery: 'manual-review-required',
        })
      } catch {
        /* Keep the original durable guard even on ENOSPC. */
      }
    }
    throw error
  }
}
function syncDirectory(dir) {
  if (process.platform === 'win32') return
  const fd = fs.openSync(dir, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
export function durableRecord(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  syncDirectory(path.dirname(file))
}
export const evidenceHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function guardedOperation(project, kind, action) {
  const owner = chainOwner(project)
  if (owner) {
    assertNoRecovery(project, owner)
    const id = randomUUID()
    const history = path.join(operationState(project), 'operations')
    const context = {
      id,
      record: (phase, value) =>
        durableRecord(path.join(history, id + '.' + phase + '.json'), {
          id,
          phase,
          chainOwner: owner,
          at: new Date().toISOString(),
          ...value,
        }),
    }
    try {
      const result = action(context)
      assert.ok(!(result instanceof Promise), 'Offline guard requires synchronous operations')
      context.record('completed', { result: 'nested-stage-accepted-outer-guard-retained' })
      return result
    } catch (error) {
      chains.getStore().failed = true
      throw error
    }
  }
  const state = operationState(project)
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
  assertNoRecovery(project)
  const lock = path.join(state, 'operation.lock')
  fs.mkdirSync(lock, { mode: 0o700 })
  syncDirectory(state)
  const marker = path.join(state, 'recovery-required.json')
  const id = randomUUID()
  // No exit/finally handler removes guards. A failed marker write leaves the
  // atomic lock. Process death is never interpreted as successful recovery.
  durableRecord(marker, {
    format: 1,
    id,
    project,
    kind,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    phase: 'running-or-unreconciled',
  })
  const history = path.join(state, 'operations')
  fs.mkdirSync(history, { recursive: true, mode: 0o700 })
  const context = {
    id,
    record: (phase, value) =>
      durableRecord(path.join(history, id + '.' + phase + '.json'), {
        id,
        phase,
        at: new Date().toISOString(),
        ...value,
      }),
  }
  try {
    const result = action(context)
    assert.ok(!(result instanceof Promise), 'Offline guard requires synchronous operations')
    context.record('completed', { result: 'all-acceptance-conditions-passed' })
    assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).id, id, 'Guard ownership changed')
    fs.unlinkSync(marker)
    syncDirectory(state)
    fs.rmdirSync(lock)
    syncDirectory(state)
    return result
  } catch (error) {
    try {
      context.record('failed', {
        error: String(error.message).slice(0, 2000),
        recovery: 'manual-review-required',
      })
    } catch {
      /* Keep guards on ENOSPC. */
    }
    throw error
  }
}

// Explicit operator review, never an automatic timeout/PID based unlock.
// Only an unchanged, fully revalidated inspection can be acknowledged here.
export function reviewInspection(project, expectedMarkerSHA256, reason, validate) {
  assert.match(expectedMarkerSHA256 ?? '', /^[a-f0-9]{64}$/)
  assert.ok(
    typeof reason === 'string' &&
      reason.trim().length >= 8 &&
      reason.length <= 500 &&
      !/[\r\n\0]/.test(reason),
    'A non-secret review reason is required',
  )
  const state = operationState(project)
  const markerFile = path.join(state, 'recovery-required.json')
  const bytes = fs.readFileSync(markerFile)
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    expectedMarkerSHA256,
    'Recovery marker changed',
  )
  const marker = JSON.parse(bytes)
  assert.equal(marker.project, project)
  assert.equal(
    marker.kind,
    'current-inspect',
    'Indeterminate mutations require independent manual recovery',
  )
  assert.match(marker.id, /^[0-9a-f-]{36}$/)
  assert.ok(Number.isSafeInteger(marker.pid) && marker.pid > 0)
  try {
    process.kill(marker.pid, 0)
    assert.fail('Owner process is still present; review refused')
  } catch (error) {
    assert.equal(error.code, 'ESRCH', 'Cannot establish that the owner has exited')
  }
  const lock = path.join(state, 'operation.lock')
  assert.ok(fs.lstatSync(lock).isDirectory() && !fs.lstatSync(lock).isSymbolicLink())
  assert.deepEqual(fs.readdirSync(lock), [], 'Unknown lock contents require manual review')
  const review = path.join(state, 'recovery-review.lock')
  fs.mkdirSync(review, { mode: 0o700 })
  syncDirectory(state)
  const history = path.join(state, 'operations')
  const before = JSON.parse(fs.readFileSync(path.join(history, marker.id + '.before.json'), 'utf8'))
  assert.equal(before.id, marker.id)
  assert.equal(evidenceHash(before.inventory), before.sha256)
  // Failure at any point deliberately retains both locks and the old marker.
  const proof = validate(before)
  assert.ok(!(proof instanceof Promise))
  assert.equal(
    evidenceHash(proof.inventory),
    before.sha256,
    'Original complete metadata differs; recovery cannot be acknowledged',
  )
  durableRecord(path.join(history, marker.id + '.reviewed.json'), {
    id: marker.id,
    at: new Date().toISOString(),
    reason,
    markerSHA256: expectedMarkerSHA256,
    sha256: before.sha256,
    proof,
  })
  assert.equal(
    createHash('sha256').update(fs.readFileSync(markerFile)).digest('hex'),
    expectedMarkerSHA256,
  )
  fs.unlinkSync(markerFile)
  syncDirectory(state)
  fs.rmdirSync(lock)
  fs.rmdirSync(review)
  syncDirectory(state)
  return { result: 'inspection-reconciled', sha256: before.sha256 }
}
