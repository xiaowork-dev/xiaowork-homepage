// Read-only inspection of the final isolated runtime; no production connection.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { localEngine, projectName } from './v11-maintenance.mjs'

const [manifestPath, project] = process.argv.slice(2)
projectName(project)
assert.ok(project.startsWith('xiaowork-homepage-v11-p6e-closure-'))
const spec = JSON.parse(readFileSync(manifestPath, 'utf8'))
localEngine()
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const imageID = (role) =>
  typeof spec.images[role] === 'string' ? spec.images[role] : spec.images[role].id
const report = {
  date: new Date().toISOString(),
  project,
  source: spec.source,
  schema: spec.schema,
  services: [],
}
let worker
for (const [service, role] of [
  ['api', 'api'],
  ['worker', 'worker'],
  ['gateway', 'gateway'],
  ['frontend', 'frontend'],
  ['publication-static', 'static'],
]) {
  const id = docker([
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
  ])
  assert.match(id, /^[a-f0-9]+$/, `Exactly one running ${service} is required`)
  const value = JSON.parse(docker(['inspect', id]))[0]
  assert.equal(value.Image, imageID(role))
  assert.equal(value.Config.Labels['org.opencontainers.image.revision'], spec.source)
  assert.equal(value.HostConfig.ReadonlyRootfs, true)
  assert.deepEqual(value.HostConfig.CapDrop, ['ALL'])
  assert.ok(value.HostConfig.SecurityOpt.includes('no-new-privileges:true'))
  assert.equal(value.HostConfig.Privileged, false)
  assert.equal(value.Config.User, role === 'frontend' ? 'nginx' : '10001:10001')
  if (role === 'frontend') assert.notEqual(docker(['exec', id, 'id', '-u']), '0')
  assert.equal(value.State.Health?.Status, 'healthy')
  if (role !== 'gateway') assert.equal(Object.keys(value.HostConfig.PortBindings ?? {}).length, 0)
  for (const ports of Object.values(value.HostConfig.PortBindings ?? {}))
    for (const port of ports) assert.equal(port.HostIp, '127.0.0.1')
  const mounts = value.Mounts.map(({ Type, Destination, RW }) => ({ Type, Destination, RW }))
  assert.ok(!mounts.some((mount) => /docker\.sock|\.ssh/.test(mount.Destination)))
  report.services.push({
    role,
    service,
    id: value.Id,
    imageId: value.Image,
    user: value.Config.User,
    readonlyRootfs: value.HostConfig.ReadonlyRootfs,
    capabilityDrop: value.HostConfig.CapDrop,
    securityOptions: value.HostConfig.SecurityOpt,
    networkMode: value.HostConfig.NetworkMode,
    portBindings: value.HostConfig.PortBindings,
    cpuNano: value.HostConfig.NanoCpus,
    memoryBytes: value.HostConfig.Memory,
    pidsLimit: value.HostConfig.PidsLimit,
    tmpfs: value.HostConfig.Tmpfs,
    mounts,
    health: value.State.Health?.Status,
  })
  if (role === 'worker') worker = value
}
assert.equal(worker.HostConfig.NetworkMode, 'none')
assert.deepEqual(worker.Mounts.map((mount) => mount.Destination).sort(), [
  '/publications',
  '/run/publishing',
  '/uploads',
])
assert.equal(worker.Mounts.find((mount) => mount.Destination === '/uploads').RW, false)
assert.ok(
  worker.HostConfig.NanoCpus > 0 && worker.HostConfig.Memory > 0 && worker.HostConfig.PidsLimit > 0,
)
assert.ok(worker.Config.Cmd.includes(spec.source))
const check = JSON.parse(
  docker([
    'exec',
    worker.Id,
    '/usr/local/bin/node',
    '-e',
    `const f=require('node:fs');const s=p=>{let x=f.lstatSync(p);return {mode:(x.mode&511).toString(8),uid:x.uid,gid:x.gid,socket:x.isSocket()}}; console.log(JSON.stringify({socket:s('/run/publishing/publisher.sock'),directory:s('/run/publishing'),absent:['/data','/secrets','/var/run/docker.sock','/root/.ssh','/home/node/.ssh','/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/corepack'].map(p=>({path:p,absent:!f.existsSync(p)})),credentialEnvironmentNames:Object.keys(process.env).filter(k=>/(TOKEN|PASSWORD|PRIVATE_KEY|GITHUB|SSH_)/i.test(k))}))`,
  ]),
)
assert.equal(check.socket.mode, '600')
assert.equal(check.socket.socket, true)
assert.equal(check.directory.mode, '700')
assert.ok(check.absent.every((value) => value.absent))
assert.deepEqual(check.credentialEnvironmentNames, [])
report.workerChecks = check
report.result = 'PASS_FINAL_LOCAL_ISOLATION'
report.limitations = [
  'Applies to this named final isolated project only; production topology remains unconnected and uninspected.',
  'The offline maintenance role is verified by image identity and separate backup/restore execution, not a long-running service.',
]
writeFileSync(
  'docs/evidence/P6E-final-runtime-boundaries.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log('PASS final isolated runtime boundaries')
