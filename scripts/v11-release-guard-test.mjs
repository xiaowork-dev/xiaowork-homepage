import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docker, inspectProject, localEngine } from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-recovery-final'
const state = path.resolve('.v11-deploy', project)
const current = JSON.parse(fs.readFileSync(path.join(state, 'current.json')))
const output = 'docs/evidence/P6E-release-guard.json'
const report = {
  date: new Date().toISOString(),
  project,
  source: current.spec.source,
  scope:
    'Real local Compose candidate failure plus host CLI-only boundary wrappers; not Docker daemon outage or physical disk exhaustion',
  cases: [],
}
const mark = (name, detail) => report.cases.push({ name, detail, result: 'PASS' })
const run = (args, expected) => {
  let result
  try {
    result = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 360000 })
  } catch (error) {
    assert.equal(error.status, expected)
    return String(error.stderr)
  }
  assert.equal(expected, 0, 'Unexpected CLI success')
  return result
}
async function proof() {
  const response = await fetch('http://127.0.0.1:3219/', {
    headers: { Connection: 'close' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  assert.equal(response.status, 200)
  return createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex')
}
try {
  localEngine()
  const before = await proof()
  const refusal = run(
    [
      '--import',
      './scripts/fixtures/v11-stop-failure.mjs',
      'scripts/v11-release.mjs',
      'update',
      '--project',
      project,
      '--manifest',
      '.cache/p6e-release-test/broken-nginx-binary.json',
    ],
    1,
  )
  assert.match(refusal, /Manual recovery required/)
  assert.ok(fs.existsSync(path.join(state, 'operation.lock')))
  const intent = JSON.parse(fs.readFileSync(path.join(state, 'recovery-required.json')))
  assert.equal(intent.phase, 'candidate-start-pending')
  assert.deepEqual(intent.previous, current.spec)
  report.events = JSON.parse(fs.readFileSync('.cache/p6e-cli-stop-failure-events.json'))
  assert.equal(report.events.length, 3)
  try {
    const during = await fetch('http://127.0.0.1:3219/', { signal: AbortSignal.timeout(5000) })
    report.duringFaultPublic = { status: during.status }
  } catch (error) {
    report.duringFaultPublic = { accessible: false, failure: error.name }
  }
  report.preservedIntent = intent
  mark(
    'failed candidate stop and failed recovery-record update retain initial durable intent and operation lock',
  )
  run(
    [
      'scripts/v11-release.mjs',
      'update',
      '--project',
      project,
      '--manifest',
      '.cache/p6e-final-release.json',
    ],
    1,
  )
  assert.ok(fs.existsSync(path.join(state, 'operation.lock')))
  mark('subsequent update refused without removing another operation lock')

  // Explicit test-operator intervention uses the recorded baseline descriptor.
  // It does not remove the guard until the old DB, image, service and HTTP agree.
  const base = [
    'compose',
    '-p',
    project,
    '-f',
    'compose.admin-publish.yaml',
    '-f',
    path.join(state, 'compose.generated.yaml'),
    '-f',
    path.join(state, 'ports.generated.yaml'),
    '--profile',
    'publisher',
  ]
  const env = {
    ...process.env,
    V11_SOURCE_REVISION: current.spec.source,
    V11_BUILDER_ID: current.spec.images.worker,
    V11_LOCAL_PUBLISH: '1',
  }
  docker([...base, 'stop', '--timeout', '40', 'worker', 'api', 'api-init'], { env })
  report.database = inspectProject(project, current.spec.images.maintenance)
  assert.equal(report.database.schema, current.spec.schema)
  const generated = JSON.parse(fs.readFileSync(path.join(state, 'compose.generated.yaml')))
  generated.services.gateway.image = current.spec.images.gateway
  fs.writeFileSync(path.join(state, 'compose.generated.yaml'), JSON.stringify(generated, null, 2))
  docker([...base, 'up', '-d', '--no-build', 'publication-init', 'api-init'], { env })
  docker([...base, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120'], { env })
  assert.equal(await proof(), before)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'current.json'))).spec, current.spec)
  fs.renameSync(
    path.join(state, 'recovery-required.json'),
    path.join(state, 'recovered-stop-boundary.json'),
  )
  fs.rmdirSync(path.join(state, 'operation.lock'))
  mark(
    'explicit test-operator recovery restored reviewed baseline, compatible database and identical public HTML before releasing guard',
  )
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
}
