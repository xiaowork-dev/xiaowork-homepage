// Real host wrapper death/outer-assertion tests against new dedicated control
// volumes. Old fault projects/locks are never adopted or removed.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { docker, backupProject } from './v11-maintenance.mjs'
import { provisionControl } from './v11-barrier.mjs'
import { operationState, assertNoRecovery } from './v11-operation.mjs'
const image = process.argv[2],
  suffix = process.argv[3]
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/)
assert.match(suffix ?? '', /^r[0-9]+$/)
const file = `docs/evidence/P6E-barrier-host-${suffix}.json`
assert.ok(!fs.existsSync(file))
const report = {
  startedAt: new Date().toISOString(),
  image,
  scope:
    'Actual Node operator wrapper and persisted named control-volume; isolated Docker Desktop only',
  tests: [],
}
const module = pathToFileURL(path.resolve('scripts/v11-operation.mjs')).href
const barrier = pathToFileURL(path.resolve('scripts/v11-barrier.mjs')).href
function state(project) {
  return JSON.parse(
    docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--user',
      '10001:10001',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--entrypoint',
      '/homepage-control',
      '--mount',
      `type=volume,src=${project}_admin-maintenance-control,dst=/control,readonly,volume-nocopy`,
      image,
      'status',
    ]),
  )
}
try {
  for (const mode of [
    'controller-kill',
    'supervisor-exit',
    'outer-assertion-failure',
    'normal-completion',
  ]) {
    const project = `xiaowork-homepage-v11-bh-${randomBytes(4).toString('hex')}`
    provisionControl(project, image)
    const action = {
      'controller-kill': "process.kill(process.pid,'SIGKILL')",
      'supervisor-exit': 'process.exit(47)',
      'outer-assertion-failure': "throw new Error('test-only outer metadata assertion failure')",
      'normal-completion': "return 'all checks accepted'",
    }[mode]
    const code = `import {protectedChain} from ${JSON.stringify(module)};import {enterSharedBarrier} from ${JSON.stringify(barrier)};await protectedChain([${JSON.stringify(project)}],'maintenance-barrier-host-test',async()=>{enterSharedBarrier(${JSON.stringify(project)},${JSON.stringify(image)},(await import(${JSON.stringify(module)})).chainOwner(${JSON.stringify(project)}));${action}})`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      timeout: 120000,
    })
    const record = {
      mode,
      project,
      pid: child.pid,
      exitCode: child.status,
      signal: child.signal,
      stdout: child.stdout,
      stderr: child.stderr,
      control: state(project),
    }
    report.tests.push(record)
    if (mode === 'normal-completion') {
      assert.equal(child.status, 0)
      assert.equal(record.control.mode, 'ready')
      assertNoRecovery(project)
      record.hostGuard = 'released-after-final-acceptance'
    } else {
      assert.notEqual(child.status, 0)
      const marker = path.join(operationState(project), 'recovery-required.json')
      const raw = fs.readFileSync(marker)
      assert.ok(fs.statSync(path.join(operationState(project), 'operation.lock')).isDirectory())
      record.markerSHA256 = createHash('sha256').update(raw).digest('hex')
      assert.equal(record.control.owner, JSON.parse(raw).owner)
      assert.equal(record.control.mode, 'recovery-required')
      assert.throws(() => assertNoRecovery(project))
      assert.throws(() =>
        backupProject(project, image, path.resolve('.cache', 'not-created-' + project)),
      )
      record.runtimeProof = docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--user',
        '10001:10001',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--entrypoint',
        '/tests/gate',
        '--mount',
        `type=volume,src=${project}_admin-maintenance-control,dst=/control,readonly,volume-nocopy`,
        '-e',
        'P6E_BLOCKED_GATE=/control',
        image,
        '-test.v',
        '-test.run=^TestGateBlockedMount$',
      ])
      assert.match(record.runtimeProof, /PERSISTENT_BARRIER_PROOF/)
      assert.equal(
        createHash('sha256').update(fs.readFileSync(marker)).digest('hex'),
        record.markerSHA256,
      )
      record.hostGuard = 'retained; new backup and runtime admission both refused'
    }
    record.result = 'passed'
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  }
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'
  report.error = error.stack
  process.exitCode = 1
}
report.completedAt = new Date().toISOString()
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({
    file,
    result: report.result,
    tests: report.tests.map((t) => ({ mode: t.mode, result: t.result })),
  }),
)
