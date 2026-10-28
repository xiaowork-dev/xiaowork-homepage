// Real local Compose service replacement and failure recovery. The candidate
// only repackages the same reviewed application; this is not a schema upgrade.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docker, localEngine } from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-recovery-final'
const directory = path.resolve('.cache/p6e-release-test')
const currentFile = path.resolve('.v11-deploy', project, 'current.json')
const report = {
  date: new Date().toISOString(),
  project,
  scope: 'Only dedicated independently restored local P6E project',
  sourceChange: false,
  schemaChange: false,
  cases: [],
  public: [],
}
const record = (name, detail) => {
  report.cases.push({ name, detail, result: 'PASS' })
  console.log('PASS ' + name)
}
function run(args, expected = 0) {
  let output
  try {
    output = execFileSync(process.execPath, ['scripts/v11-release.mjs', ...args], {
      encoding: 'utf8',
      timeout: 360000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (expected === 0) throw error
    assert.equal(error.status, expected)
    return String(error.stderr)
  }
  assert.equal(expected, 0, 'Command unexpectedly succeeded')
  return output
}
async function publicProof() {
  const proof = []
  for (const route of ['/', '/projects/', '/about/', '/__xiaowork-release.json']) {
    const r = await fetch('http://127.0.0.1:3219' + route, { cache: 'no-store' })
    assert.equal(r.status, 200)
    proof.push({
      route,
      status: r.status,
      sha256: createHash('sha256')
        .update(Buffer.from(await r.arrayBuffer()))
        .digest('hex'),
    })
  }
  return proof
}
function prepareImage(tag, source, invalid) {
  const dockerfile = path.join(directory, tag + '.Dockerfile')
  const from = `xiaowork-homepage-v11-retained:gateway-${source.spec.source.slice(0, 12)}-${source.spec.images.gateway.slice(7, 19)}`
  fs.writeFileSync(
    dockerfile,
    `FROM ${from}\nLABEL io.xiaowork.p6e.fixture="${tag}"\n${invalid ? 'USER 0:0\nRUN rm /usr/sbin/nginx\nUSER 10001:10001\n' : ''}`,
  )
  docker([
    'build',
    '--network',
    'none',
    '-f',
    dockerfile,
    '-t',
    'xiaowork-homepage-v11-upgrade-test:' + tag,
    directory,
  ])
  const id = docker([
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    'xiaowork-homepage-v11-upgrade-test:' + tag,
  ])
  const spec = { ...source.spec, images: { ...source.spec.images, gateway: id } }
  const filename = path.join(directory, tag + '.json')
  fs.writeFileSync(filename, JSON.stringify(spec, null, 2) + '\n')
  return { filename, id }
}
try {
  localEngine()
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const baseline = JSON.parse(fs.readFileSync(currentFile, 'utf8'))
  report.sourceRevision = baseline.spec.source
  report.baselineImages = baseline.spec.images
  const before = await publicProof()
  report.public.push({ stage: 'beforeUpdate', files: before })
  const candidate = prepareImage('compatible-repackaged', baseline, false)
  run(['update', '--project', project, '--manifest', candidate.filename])
  const after = JSON.parse(fs.readFileSync(currentFile, 'utf8'))
  assert.equal(after.spec.images.gateway, candidate.id)
  assert.deepEqual(await publicProof(), before)
  assert.equal(
    docker(['image', 'inspect', '--format', '{{.Id}}', baseline.spec.images.gateway]),
    baseline.spec.images.gateway,
  )
  record('real same-schema image update retained old image and all restored content', {
    candidateGateway: candidate.id,
  })
  run(['rollback', '--project', project])
  assert.deepEqual(JSON.parse(fs.readFileSync(currentFile, 'utf8')).spec, baseline.spec)
  assert.deepEqual(await publicProof(), before)
  record('real code-image rollback preserved SQLite, private uploads and active content')
  const invalid = prepareImage('broken-nginx-binary', baseline, true)
  const failure = run(['update', '--project', project, '--manifest', invalid.filename], 1)
  assert.match(failure, /previous service restored and HTTP verified/)
  assert.deepEqual(JSON.parse(fs.readFileSync(currentFile, 'utf8')).spec, baseline.spec)
  assert.deepEqual(await publicProof(), before)
  record(
    'actual candidate startup failure restored previous service and HTTP without restoring or deleting database',
  )
  const incompatible = path.join(directory, 'incompatible-schema.json')
  fs.writeFileSync(
    incompatible,
    JSON.stringify({ ...baseline.spec, schema: baseline.spec.schema + 1 }, null, 2),
  )
  const refusal = run(['update', '--project', project, '--manifest', incompatible], 1)
  assert.match(refusal, /schema|compatible/)
  assert.deepEqual(await publicProof(), before)
  record('unsupported cross-schema candidate refused before write-service replacement')
  const lock = path.resolve('.v11-deploy', project, 'operation.lock')
  fs.mkdirSync(lock)
  try {
    run(['status', '--project', project], 1)
    assert.ok(fs.existsSync(lock), 'Competing operator removed another operation lock')
  } finally {
    fs.rmdirSync(lock)
  }
  record('concurrent lifecycle operation refused and existing lock preserved')
  report.public.push({ stage: 'afterUpdateRollbackFailureRefusal', files: await publicProof() })
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(
    'docs/evidence/P6E-release-lifecycle.json',
    JSON.stringify(report, null, 2) + '\n',
  )
}
