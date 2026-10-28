// Exact-project shutdown only, preserving every volume and image.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { docker, localEngine } from './v11-maintenance.mjs'

localEngine()
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-final-runtime-manifest.json'))
process.env.V11_SOURCE_REVISION = manifest.source
const helper = await import(
  pathToFileURL(path.resolve('.cache/p6e-final-harness/p6e-browser-environment.mjs'))
)
assert.equal(helper.project, 'xiaowork-homepage-v11-p6e-closure-e2e')
const filter = `label=com.docker.compose.project=${helper.project}`
const containers = docker(['ps', '-aq', '--filter', filter]).split(/\s+/).filter(Boolean)
const facts = containers.map((id) => {
  const info = JSON.parse(docker(['inspect', id]))[0]
  return {
    id: info.Id,
    image: info.Image,
    running: info.State.Running,
    service: info.Config.Labels['com.docker.compose.service'],
  }
})
for (const [role, service] of Object.entries({
  api: 'api',
  worker: 'worker',
  gateway: 'gateway',
  frontend: 'frontend',
  static: 'publication-static',
})) {
  const actual = facts.find((value) => value.service === service)
  assert.ok(actual?.running)
  assert.equal(actual.image, manifest.images[role].id)
}
const markerResponse = await fetch('http://127.0.0.1:3224/__xiaowork-release.json')
assert.equal(markerResponse.status, 200)
const active = await markerResponse.json()
const volumes = docker(['volume', 'ls', '-q', '--filter', filter])
  .split(/\s+/)
  .filter(Boolean)
  .sort()
assert.equal(volumes.length, 7)
helper.stopBrowserContainer()
helper.compose('down')
assert.equal(docker(['ps', '-aq', '--filter', filter]), '')
assert.deepEqual(
  docker(['volume', 'ls', '-q', '--filter', filter]).split(/\s+/).filter(Boolean).sort(),
  volumes,
)
for (const value of Object.values(manifest.images))
  assert.equal(docker(['image', 'inspect', '--format', '{{.Id}}', value.id]), value.id)
fs.writeFileSync(
  'docs/evidence/P6E-final-e2e-retention.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      source: manifest.source,
      project: helper.project,
      command: 'exact generated Compose down without -v; no global Docker cleanup',
      before: facts,
      active,
      afterContainerCount: 0,
      volumes,
      imagesRetained: true,
      result: 'PASS',
    },
    null,
    2,
  ) + '\n',
)
console.log('PASS_EXACT_PROJECT_STOPPED_VOLUMES_AND_IMAGES_RETAINED')
