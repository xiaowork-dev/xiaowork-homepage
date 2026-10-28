// Read-only post-test retention verification of the one isolated cross-source project.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import { docker, inspectProject, localEngine, volumeNames } from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-cross-source'
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
localEngine()
const normal = read('docs/evidence/P6E-cross-source-final.json')
const fresh = read('docs/evidence/P6E-cross-source-new-content.json')
assert.equal(normal.result, 'PASS')
assert.equal(fresh.result, 'PASS')
assert.equal(docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]), '')
const volumeList = [...Object.values(volumeNames(project)), `${project}_admin-publisher-socket`]
const volumes = volumeList.map((name) => {
  const label = docker([
    'volume',
    'inspect',
    '--format',
    '{{index .Labels "com.docker.compose.project"}}',
    name,
  ])
  assert.equal(label, project)
  return { name, project: label, retained: true }
})
const images = []
for (const [version, spec] of [
  ['previous', fresh.previous],
  ['final', fresh.final],
]) {
  for (const [role, id] of Object.entries(spec.images)) {
    assert.equal(docker(['image', 'inspect', '--format', '{{.Id}}', id]), id)
    images.push({ version, role, id, source: spec.source, retained: true })
  }
}
const state = inspectProject(project, fresh.final.images.maintenance)
assert.equal(state.schema, 3)
assert.equal(state.unfinished, 0)
assert.equal(state.activeRelease, fresh.newPublication.releaseId)
async function closed(port) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1500)
    socket.once('connect', () => {
      socket.destroy()
      reject(new Error('Isolated test port still accepts connections'))
    })
    socket.once('error', (error) => {
      assert.equal(error.code, 'ECONNREFUSED')
      resolve({ port, closed: true })
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error('Local port state was not confirmed'))
    })
  })
}
const ports = await Promise.all([closed(3226), closed(3459)])
fs.writeFileSync(
  'docs/evidence/P6E-cross-source-retention.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      project,
      command: 'node scripts/v11-cross-source-retention.mjs',
      result: 'PASS',
      volumes,
      images,
      state,
      ports,
      noGlobalCleanup: true,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  'PASS exact project stopped; seven volumes, twelve source-specific role identities, reconciled current and closed loopback ports verified',
)
