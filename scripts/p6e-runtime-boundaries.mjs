// Read-only inspection of the exact P6-E acceptance stack. No production access.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)
const project = 'xiaowork-homepage-v11-p6e-e2e'
const cli = async (...args) =>
  (await run('docker', args, { encoding: 'utf8', timeout: 30000 })).stdout.trim()
assert.equal(
  await cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
const report = { date: new Date().toISOString(), project, services: [], checks: [] }
let worker
for (const role of ['api', 'worker', 'gateway', 'publication-static']) {
  const id = await cli(
    'ps',
    '-q',
    '--filter',
    'label=com.docker.compose.project=' + project,
    '--filter',
    'label=com.docker.compose.service=' + role,
  )
  assert.match(id, /^[a-f0-9]+$/, `${role} must have exactly one local container`)
  const value = JSON.parse(await cli('inspect', id))[0]
  assert.equal(value.HostConfig.ReadonlyRootfs, true)
  assert.deepEqual(value.HostConfig.CapDrop, ['ALL'])
  assert.ok(value.HostConfig.SecurityOpt.includes('no-new-privileges:true'))
  assert.equal(value.HostConfig.Privileged, false)
  assert.equal(value.Config.User, '10001:10001')
  if (role !== 'gateway') assert.equal(Object.keys(value.HostConfig.PortBindings ?? {}).length, 0)
  for (const ports of Object.values(value.HostConfig.PortBindings ?? {}))
    for (const port of ports) assert.equal(port.HostIp, '127.0.0.1')
  report.services.push({
    role,
    containerId: value.Id,
    imageId: value.Image,
    user: value.Config.User,
    readOnlyRootfs: value.HostConfig.ReadonlyRootfs,
    capabilityDrop: value.HostConfig.CapDrop,
    securityOptions: value.HostConfig.SecurityOpt,
    networkMode: value.HostConfig.NetworkMode,
    portBindings: value.HostConfig.PortBindings,
    cpuNano: value.HostConfig.NanoCpus,
    memoryBytes: value.HostConfig.Memory,
    pidsLimit: value.HostConfig.PidsLimit,
    tmpfs: value.HostConfig.Tmpfs,
    mounts: value.Mounts.map(({ Type, Destination, RW }) => ({ Type, Destination, RW })),
    state: value.State.Status,
    health: value.State.Health?.Status,
  })
  if (role === 'worker') worker = value
}
assert.equal(worker.HostConfig.NetworkMode, 'none')
assert.deepEqual(worker.Mounts.map((value) => value.Destination).sort(), [
  '/publications',
  '/run/publishing',
  '/uploads',
])
assert.equal(worker.Mounts.find((value) => value.Destination === '/uploads').RW, false)
assert.ok(worker.HostConfig.NanoCpus > 0)
assert.ok(worker.HostConfig.Memory > 0)
assert.ok(worker.HostConfig.PidsLimit > 0)
const checks = JSON.parse(
  await cli(
    'exec',
    worker.Id,
    '/usr/local/bin/node',
    '-e',
    `const fs=require('node:fs');const stat=p=>{const s=fs.lstatSync(p);return {mode:(s.mode&0o777).toString(8),uid:s.uid,gid:s.gid,socket:s.isSocket()}};console.log(JSON.stringify({socket:stat('/run/publishing/publisher.sock'),socketDirectory:stat('/run/publishing'),absent:['/data','/secrets','/var/run/docker.sock','/root/.ssh','/home/node/.ssh','/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/corepack','/usr/local/lib/node_modules/npm'].map(p=>({path:p,absent:!fs.existsSync(p)})),credentialEnvironmentNames:Object.keys(process.env).filter(k=>/(TOKEN|PASSWORD|PRIVATE_KEY|GITHUB|SSH_)/i.test(k))}))`,
  ),
)
assert.equal(checks.socket.mode, '600')
assert.equal(checks.socket.socket, true)
assert.equal(checks.socketDirectory.mode, '700')
assert.ok(checks.absent.every((value) => value.absent))
assert.deepEqual(checks.credentialEnvironmentNames, [])
report.checks = checks
report.result = 'PASS_LOCAL_ISOLATION'
report.limitations = [
  'Runtime inspection applies only to this named isolated test project.',
  'The worker command protocol and application security are covered by separate tests.',
  'This is not evidence that a production stack has been deployed or inspected.',
]
await writeFile('docs/evidence/P6E-runtime-boundaries.json', JSON.stringify(report, null, 2) + '\n')
console.log('PASS local worker/API/static/gateway runtime isolation')
