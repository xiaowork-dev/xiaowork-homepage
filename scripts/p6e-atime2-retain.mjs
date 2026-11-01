// Read-only failure review and explicit control-only containment. No data repair.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { guardedOperation, assertNoRecovery } from './v11-operation.mjs'
import { docker, localEngine, volumeNames, backupProject } from './v11-maintenance.mjs'
localEngine()
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime2-runtime-manifest.json'))
const failed = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime2-current-repair.json'))
assert.equal(failed.result, 'FAIL')
assert.equal(failed.source, manifest.source)
const project = failed.project,
  state = path.resolve('.v11-deploy', project)
const hash = (b) => createHash('sha256').update(b).digest('hex')
const report = {
  date: new Date().toISOString(),
  project,
  source: manifest.source,
  result: 'STOPPED_AFTER_BACKUP_IDENTITY_REFUSAL',
  failure: failed.error,
}
const containers = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
  .split(/\s+/)
  .filter(Boolean)
  .map((id) => JSON.parse(docker(['inspect', '--format', '{{json .}}', id])))
report.containers = containers.map((c) => ({
  id: c.Id,
  service: c.Config.Labels['com.docker.compose.service'],
  image: c.Image,
  running: c.State.Running,
  health: c.State.Health?.Status,
  mounts: c.Mounts.map((m) => ({ name: m.Name, destination: m.Destination, writable: m.RW })),
}))
for (const c of report.containers)
  if (['api', 'worker', 'api-init', 'publication-init'].includes(c.service))
    assert.equal(c.running, false)
report.rootCause = {
  kind: 'TEST_CONTROLLER_DESCRIPTOR_ERROR',
  detail:
    'The fault API and normal api-init have different image IDs; one API role in the backup descriptor cannot truthfully identify both. Backup correctly refused before copying a backup payload.',
  faultAPI: report.containers.find((c) => c.service === 'api').image,
  apiInit: report.containers.find((c) => c.service === 'api-init').image,
  notProductDataCorruption: true,
}
report.overbroadPriorAssertion =
  'The first assert.throws(backupProject) did not assert the rejection reason. It cannot be counted as evidence that current.next itself caused backup refusal.'
const operations = path.join(state, 'operations')
const accepted = fs
  .readdirSync(operations)
  .filter((n) => n.endsWith('.accepted.json'))
  .map((n) => JSON.parse(fs.readFileSync(path.join(operations, n))))
  .find((v) => v.result?.outcome === 'verified-redundant-link-removed')
assert.ok(accepted)
const before = JSON.parse(fs.readFileSync(path.join(operations, accepted.id + '.before.json')))
const after = JSON.parse(fs.readFileSync(path.join(operations, accepted.id + '.after.json')))
const prev = new Map(before.inventory.map((v) => [v.path, v])),
  next = new Map(after.inventory.map((v) => [v.path, v]))
const changed = after.inventory
  .filter((v) => prev.has(v.path) && JSON.stringify(prev.get(v.path)) !== JSON.stringify(v))
  .map((v) => ({ path: v.path, before: prev.get(v.path), after: v }))
const added = after.inventory.filter((v) => !prev.has(v.path)),
  removed = before.inventory.filter((v) => !next.has(v.path))
assert.equal(removed.length, 1)
assert.match(removed[0].path, /^publications\/current\.next\.[a-f0-9]{64}$/)
assert.ok(
  added.every(
    (v) =>
      v.path === 'publications/maintenance-repairs' ||
      v.path.startsWith('publications/maintenance-repairs/'),
  ),
)
assert.ok(
  changed.every((v) => ['publications', 'publications/maintenance-repairs'].includes(v.path)),
)
for (const v of changed) assert.deepEqual(v.before.stat.Atim, v.after.stat.Atim)
const roots = ['authority', 'db', 'publications', 'secrets', 'tls', 'uploads'].map((role) => ({
  role,
  beforeAtim: prev.get(role).stat.Atim,
  afterAtim: next.get(role).stat.Atim,
}))
for (const v of roots) assert.deepEqual(v.beforeAtim, v.afterAtim)
assert.equal(prev.get('db/content.sqlite').sha256, next.get('db/content.sqlite').sha256)
fs.writeFileSync(
  'docs/evidence/P6E-atime2-repair-metadata-review.json',
  JSON.stringify(
    {
      source: manifest.source,
      operation: accepted.id,
      result: 'PASS_PLANNED_SINGLE_LINK_DELTA_ONLY',
      beforeSHA256: before.sha256,
      afterSHA256: after.sha256,
      roots,
      changed,
      added,
      removed,
      before: before.inventory,
      after: after.inventory,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
)
report.manualContainmentRequired = true
assert.equal(fs.existsSync(path.join(state, 'operation.lock')), false)
assert.equal(fs.existsSync(path.join(state, 'recovery-required.json')), false)
try {
  guardedOperation(project, 'backup-chain-manual-containment', () => {
    throw Error(
      'Backup acceptance stopped on inconsistent test image descriptor; no downstream restore/update/rollback is permitted before independent review',
    )
  })
} catch (error) {
  assert.match(error.message, /Backup acceptance stopped/)
}
assert.throws(() => assertNoRecovery(project), /Persistent operation.lock/)
assert.throws(
  () => backupProject(project, manifest.images.maintenance.id, 'unused'),
  /Persistent operation.lock/,
)
report.containment = {
  automatic: false,
  operationLockRetained: true,
  recoveryMarkerSHA256: hash(fs.readFileSync(path.join(state, 'recovery-required.json'))),
  newBackupBlocked: true,
  reason:
    'Explicit manual control-directory containment after the separate backup step refused; not misreported as automatic whole-pipeline recovery.',
}
report.volumes = Object.values(volumeNames(project))
report.publicHTTP = []
for (const expected of failed.publicBefore) {
  const r = await fetch('http://127.0.0.1:3243' + expected.route, { cache: 'no-store' })
  const bytes = Buffer.from(await r.arrayBuffer())
  assert.equal(r.status, expected.status)
  assert.equal(hash(bytes), expected.sha256)
  report.publicHTTP.push({ route: expected.route, status: r.status, sha256: hash(bytes) })
}
report.downstream = {
  backup: 'REFUSED_BEFORE_PAYLOAD_COPY',
  emptyVolumeRestore: 'NOT_RUN',
  update: 'NOT_RUN',
  codeRollback: 'NOT_RUN',
  contentRestore: 'NOT_RUN',
  secondBackupRestore: 'NOT_RUN',
}
fs.writeFileSync(
  'docs/evidence/P6E-atime2-chain-retention.json',
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
)
const restart = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime2-control-restart.json'))
const logs = spawnSync('docker', ['logs', restart.container], { encoding: 'utf8' })
const combined = (logs.stdout ?? '') + (logs.stderr ?? '')
assert.match(combined, /Persistent operation.lock/)
const marker = path.resolve('.v11-deploy', restart.project, 'recovery-required.json')
fs.writeFileSync(
  'docs/evidence/P6E-atime2-control-restart-review.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      source: manifest.source,
      originalFailurePreserved: true,
      fixtureError:
        'docker logs writes the Node assertion stack to stderr; the old collector only captured stdout.',
      firstExit: restart.firstExit,
      restartExit: restart.restartExit,
      logs: combined,
      observedResult:
        'Controller restart was refused by the persistent operation.lock before any new data operation',
      markerPresent: fs.existsSync(marker),
      markerSHA256: hash(fs.readFileSync(marker)),
      exactBeforeAfterMarkerHash:
        'NOT_VERIFIED; original collector failed before recording its baseline hash',
      hostOSAndDaemonRestart: 'NOT_RUN',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
)
console.log(
  'PASS read-only failure review; known new scene manually blocked, all downstream data operations stopped',
)
