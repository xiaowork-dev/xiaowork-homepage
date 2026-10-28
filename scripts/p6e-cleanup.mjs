// Stops only the named local P6-E browser stack. All project volumes are retained.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { compose, project, stopBrowserContainer } from './p6e-browser-environment.mjs'

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim()
assert.equal(
  docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
assert.equal(project, 'xiaowork-homepage-v11-p6e-e2e')
const source = docker(
  'image',
  'inspect',
  '--format',
  '{{index .Config.Labels "org.opencontainers.image.revision"}}',
  'xiaowork-homepage-worker:p6d-dev',
)
assert.match(source, /^[a-f0-9]{40}$/)
process.env.V11_SOURCE_REVISION = source
process.env.V11_BUILDER_ID = docker(
  'image',
  'inspect',
  '--format',
  '{{.Id}}',
  'xiaowork-homepage-worker:p6d-dev',
)
process.env.V11_LOCAL_PUBLISH = '1'

function inspect(ids) {
  if (!ids.length) return []
  return JSON.parse(docker('inspect', ...ids)).map((x) => ({
    id: x.Id,
    name: x.Name,
    image: x.Image,
    started: x.State.StartedAt,
    running: x.State.Running,
    health: x.State.Health?.Status ?? null,
    project: x.Config.Labels['com.docker.compose.project'] ?? '',
  }))
}
function volumes() {
  return docker('volume', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '-q')
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
}
const report = {
  date: new Date().toISOString(),
  project,
  scope: 'Only dedicated local P6E browser stack; no volume/image/global cleanup',
  sourceRevision: source,
}
const existing = JSON.parse(fs.readFileSync('.cache/p6e-other-containers-before.json', 'utf8'))
const actualExisting = inspect(existing.map((x) => x.id))
for (const item of existing) {
  const now = actualExisting.find((x) => x.id === item.id)
  assert.ok(now)
  for (const key of ['id', 'name', 'image', 'started', 'running', 'project'])
    assert.equal(now[key], item[key], `Pre-existing container ${key} changed`)
}
report.preexistingBeforeCleanup = actualExisting
report.testContainersBefore = inspect(compose('ps', '-a', '-q').split(/\r?\n/).filter(Boolean))
assert.ok(report.testContainersBefore.length)
assert.ok(report.testContainersBefore.every((x) => x.project === project))
report.volumesBefore = volumes()
assert.equal(report.volumesBefore.length, 7)
if (docker('ps', '-a', '--filter', `name=^/${project}-browser$`, '-q')) stopBrowserContainer()
compose('down')
report.volumesAfter = volumes()
assert.deepEqual(report.volumesAfter, report.volumesBefore)
assert.equal(
  docker('ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '-q'),
  '',
)
report.preexistingAfterCleanup = inspect(existing.map((x) => x.id))
assert.deepEqual(report.preexistingAfterCleanup, actualExisting)
report.portsClosed = []
for (const port of [3214, 3447, 9325]) {
  let connected = false
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })
    connected = true
  } catch (error) {
    assert.notEqual(error.name, 'TimeoutError', 'Port check must not silently time out')
  }
  assert.equal(connected, false, `Test port ${port} remains reachable`)
  report.portsClosed.push(port)
}
report.result = 'PASS'
const output = path.resolve('docs/evidence/P6E-e2e-cleanup.json')
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(
  'PASS: exact P6E stack stopped; seven volumes and twelve pre-existing containers retained',
)
