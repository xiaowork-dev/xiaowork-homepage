// 失败后的只读取证。绝不解除锁、恢复写入者或继续备份/恢复链。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { docker, localEngine, volumeNames, tool } from './v11-maintenance.mjs'
const runtime = JSON.parse(fs.readFileSync('docs/evidence/P6E-chain3-runtime-manifest.json'))
const failed = JSON.parse(fs.readFileSync('docs/evidence/P6E-chain3-current-repair.json'))
const supervisor = JSON.parse(fs.readFileSync('docs/evidence/P6E-chain3-supervisor.json'))
const output = 'docs/evidence/P6E-chain3-retention.json'
assert.ok(!fs.existsSync(output))
assert.equal(failed.result, 'FAIL')
assert.match(failed.error, /Wrong source mounted/)
localEngine()
const hash = (b) => createHash('sha256').update(b).digest('hex')
const report = {
  date: new Date().toISOString(),
  source: runtime.source,
  result: 'STOPPED_AFTER_BIND_SOURCE_IDENTITY_REFUSAL',
  error: failed.error,
  guards: [],
  http: [],
  downstream: {
    backup: 'REFUSED_BEFORE_BACKUP_CONTAINER_START',
    emptyVolumeRestore: 'NOT_RUN',
    crossSourceUpdate: 'NOT_RUN',
    codeRollback: 'NOT_RUN',
    contentRestore: 'NOT_RUN',
    secondBackupRestore: 'NOT_RUN',
    finalFormalRuntimeAcceptance: 'NOT_RUN_CHAIN_PREREQUISITE_FAILED',
  },
}
for (const g of supervisor.stages) {
  const dir = path.resolve('.v11-deploy', g.project),
    marker = fs.readFileSync(path.join(dir, 'recovery-required.json'))
  assert.equal(hash(marker), g.markerSHA256)
  assert.ok(fs.statSync(path.join(dir, 'operation.lock')).isDirectory())
  const ids = docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + g.project])
    .split(/\s+/)
    .filter(Boolean)
  const containers = ids.map((id) => JSON.parse(docker(['inspect', '--format', '{{json .}}', id])))
  for (const c of containers)
    if (
      ['api', 'worker', 'api-init', 'publication-init'].includes(
        c.Config.Labels['com.docker.compose.service'],
      )
    )
      assert.equal(c.State.Running, false)
  report.guards.push({
    project: g.project,
    markerSHA256: hash(marker),
    unchangedSinceFailure: true,
    lockPresent: true,
    containers: containers.map((c) => ({
      id: c.Id,
      image: c.Image,
      service: c.Config.Labels['com.docker.compose.service'],
      status: c.State.Status,
      running: c.State.Running,
      health: c.State.Health?.Status,
    })),
  })
}
report.failedMaintenanceContainers = docker([
  'ps',
  '-aq',
  '--filter',
  'ancestor=' + runtime.images.maintenance.id,
])
  .split(/\s+/)
  .filter(Boolean)
  .map((id) => JSON.parse(docker(['inspect', '--format', '{{json .}}', id])))
  .filter(
    (c) =>
      c.Config.Cmd?.[0] === 'backup' &&
      c.Mounts.some((m) => m.Name === volumeNames(failed.project).db),
  )
  .map((c) => ({
    id: c.Id,
    status: c.State.Status,
    startedAt: c.State.StartedAt,
    command: c.Config.Cmd,
    mounts: c.Mounts.map((m) => ({
      type: m.Type,
      name: m.Name,
      source: m.Type === 'bind' ? m.Source : undefined,
      destination: m.Destination,
      writable: m.RW,
    })),
    image: c.Image,
  }))
assert.equal(report.failedMaintenanceContainers.length, 1)
assert.equal(report.failedMaintenanceContainers[0].status, 'created')
for (const proof of failed.publicBefore) {
  const r = await fetch('http://127.0.0.1:3273' + proof.route, { cache: 'no-store' })
  const now = {
    route: proof.route,
    status: r.status,
    sha256: hash(Buffer.from(await r.arrayBuffer())),
  }
  assert.deepEqual(now, proof)
  report.http.push(now)
}
const ca = fs.readFileSync('.cache/p6e-chain3-fault/ca.crt')
report.publishAfterFailure = await new Promise((resolve, reject) => {
  const req = https.request(
    'https://localhost:3523/api/admin/v1/publish-jobs',
    {
      method: 'POST',
      ca,
      rejectUnauthorized: true,
      headers: { Origin: 'https://localhost:3523', 'Content-Type': 'application/json' },
    },
    (res) => {
      res.resume()
      res.on('end', () =>
        resolve({ status: res.statusCode, tlsVerified: true, credentialsSent: false }),
      )
    },
  )
  req.on('error', reject)
  req.end('{}')
})
assert.equal(report.publishAfterFailure.status, 502)
const mounts = Object.entries(volumeNames(failed.project)).flatMap(([role, name]) => [
  '--mount',
  `type=volume,src=${name},dst=/source/${role},readonly,volume-nocopy`,
])
const before = tool(runtime.images.maintenance.id, 'metadata-readonly', mounts)
const after = tool(runtime.images.maintenance.id, 'metadata-readonly', mounts)
assert.deepEqual(after, before)
report.forensicReadonlyMetadata = {
  count: before.length,
  beforeSHA256: hash(Buffer.from(JSON.stringify(before))),
  afterSHA256: hash(Buffer.from(JSON.stringify(after))),
  unchanged: true,
}
const repairAfter = failed.repairMetadata.after
const baseline = new Map(repairAfter.map((e) => [e.path, e]))
report.deltaSinceRepair = after
  .filter((e) => JSON.stringify(e) !== JSON.stringify(baseline.get(e.path)))
  .map((e) => ({ path: e.path, before: baseline.get(e.path), after: e }))
report.deletedSinceRepair = repairAfter
  .filter((e) => !after.some((n) => n.path === e.path))
  .map((e) => e.path)
report.deltaScope =
  '修复 wrapper 的前后验收已通过。之后普通备份预检不是原卷只读检查；本字段如实记录这两个不同检查点间的变化，不恢复元数据。失败后本次两次纯RO取证完全相同。'
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(report.result)
