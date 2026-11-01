// 受信离线控制目录；从不写入被验收的数据卷，也不被公网 API 调用。
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.v11-deploy')
export function operationState(project) {
  assert.match(project ?? '', /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/)
  return path.join(root, project)
}
export function assertNoRecovery(project, lifecycleOwner) {
  const file = path.join(operationState(project), 'recovery-required.json')
  if (!fs.existsSync(file)) return
  const marker = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(
    typeof lifecycleOwner === 'string' &&
      /^[0-9a-f-]{36}$/.test(lifecycleOwner) &&
      marker.owner === lifecycleOwner,
    'Persistent recovery-required marker blocks new maintenance, repair and update tasks',
  )
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
