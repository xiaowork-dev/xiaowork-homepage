// Simulate controller-service restart, not a host reboot or power failure.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docker, localEngine } from './v11-maintenance.mjs'
localEngine()
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime2-runtime-manifest.json'))
const project = 'xiaowork-homepage-v11-p6e-restart-' + Date.now().toString(36)
const state = path.resolve('.v11-deploy', project)
fs.mkdirSync(state, { recursive: false, mode: 0o700 })
const output = 'docs/evidence/P6E-atime2-control-restart.json'
assert.equal(fs.existsSync(output), false)
const report = {
  date: new Date().toISOString(),
  project,
  source: manifest.source,
  result: 'RUNNING',
  scope:
    'Only a new dedicated controller container and host control directory; no application data volumes',
}
try {
  const script = `import {guardedOperation} from '/workspace/scripts/v11-operation.mjs';guardedOperation('${project}','current-inspect',()=>process.exit(31))`
  const id = docker([
    'create',
    '--name',
    project,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--user',
    '10001:10001',
    '--mount',
    `type=bind,src=${process.cwd()},dst=/workspace,readonly`,
    '--mount',
    `type=bind,src=${state},dst=/workspace/.v11-deploy/${project}`,
    '--entrypoint',
    'node',
    manifest.images.worker.id,
    '--input-type=module',
    '--eval',
    script,
  ])
  report.container = id
  const start = spawnSync('docker', ['start', '-a', id], { encoding: 'utf8', timeout: 30000 })
  report.firstExit = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', id]))
  assert.equal(report.firstExit, 31, start.stderr)
  const marker = path.join(state, 'recovery-required.json')
  const original = fs.readFileSync(marker)
  assert.ok(fs.statSync(path.join(state, 'operation.lock')).isDirectory())
  docker(['restart', id])
  docker(['wait', id])
  report.restartExit = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', id]))
  report.logs = docker(['logs', id])
  assert.notEqual(report.restartExit, 0)
  assert.match(report.logs, /Persistent operation.lock/)
  assert.deepEqual(fs.readFileSync(marker), original)
  assert.ok(fs.statSync(path.join(state, 'operation.lock')).isDirectory())
  report.markerSHA256 = createHash('sha256').update(original).digest('hex')
  report.markerUnchanged = true
  report.newOperationRejected = true
  report.hostOSAndDockerDaemonRestart = 'NOT_RUN'
  report.powerLossDurability = 'NOT_RUN; Windows Node cannot fsync directory handles'
  report.retention = 'Stopped test container, operation.lock and marker retained for manual review'
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error = error.message
  process.exitCode = 1
}
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(report.result + ' controller-service restart')
