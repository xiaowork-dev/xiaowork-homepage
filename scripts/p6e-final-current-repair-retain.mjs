// Preserve the failed read-only repair attempt. This never repairs a link or
// starts a writer; it stops only the exact fresh fault project without -v.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docker, localEngine, volumeNames } from './v11-maintenance.mjs'

localEngine()
const project = 'xiaowork-homepage-v11-p6e-closure-fault'
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-final-runtime-manifest.json'))
const attempt = JSON.parse(fs.readFileSync('docs/evidence/P6E-final-current-repair.json'))
const fault = JSON.parse(fs.readFileSync('docs/evidence/P6E-final-faults-before-switch.json'))
const diagnostic = JSON.parse(
  fs.readFileSync('docs/evidence/P6E-final-current-readonly-probe.json'),
)
assert.equal(attempt.result, 'FAIL')
assert.equal(diagnostic.result, 'REPRODUCED_BLOCKER')
assert.equal(fault.result, 'PASS')
const cache = path.resolve('.cache/p6e-closure-repair-retained-' + Date.now())
fs.mkdirSync(cache, { mode: 0o700 })
const mounts = Object.entries(volumeNames(project)).flatMap(([name, volume]) => [
  '--mount',
  `type=volume,src=${volume},dst=/source/${name},readonly`,
])
const inventorySource = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const out=[];function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file),p=file.slice('/source/'.length);if(s.isSymbolicLink())out.push({path:p,link:fs.readlinkSync(file)});else if(s.isDirectory())walk(file);else if(s.isFile())out.push({path:p,bytes:s.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});else throw Error('special file refused')}}walk('/source');out.sort((a,b)=>a.path.localeCompare(b.path));console.log(JSON.stringify(out));`
const inventory = () =>
  JSON.parse(
    docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      ...mounts,
      '--entrypoint',
      'node',
      manifest.images.worker.id,
      '--eval',
      inventorySource,
    ]),
  )
const before = inventory()
const current = before.find((f) => f.path === 'publications/current')
assert.equal(current.link, 'releases/' + fault.originalActive)
const candidates = before.filter((f) => f.path.startsWith('publications/current.next.'))
assert.equal(candidates.length, 1)
assert.equal(before.find((f) => f.path === 'db/content.sqlite').sha256, diagnostic.originalSHA256)
const publicNow = []
for (const expected of attempt.publicBefore) {
  const response = await fetch('http://127.0.0.1:3223' + expected.route, { cache: 'no-store' })
  assert.equal(response.status, 200)
  const sha256 = createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex')
  assert.equal(sha256, expected.sha256)
  publicNow.push({ route: expected.route, status: response.status, sha256 })
}
fs.writeFileSync(
  path.join(cache, 'all-file-sha256-before.json'),
  JSON.stringify(before, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 },
)
for (const id of docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
  .split(/\s+/)
  .filter(Boolean)) {
  const container = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
  if (
    ['api', 'worker', 'api-init', 'publication-init'].includes(
      container.Config.Labels['com.docker.compose.service'],
    )
  )
    assert.equal(container.State.Running, false)
}
const base = path.resolve('.cache/p6e-closure-fault/compose.base.yaml')
const override = path.resolve('.cache/p6e-closure-fault/compose.override.yaml')
execFileSync(
  'docker',
  [
    'compose',
    '--profile',
    'publisher',
    '-p',
    project,
    '--project-directory',
    process.cwd(),
    '-f',
    base,
    '-f',
    override,
    'down',
    '--remove-orphans',
  ],
  {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    env: {
      ...process.env,
      V11_SOURCE_REVISION: manifest.source,
      V11_BUILDER_ID: attempt.faultRuntimeImages.worker,
      V11_LOCAL_PUBLISH: '0',
    },
  },
)
const after = inventory()
assert.deepEqual(after, before)
assert.equal(docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]), '')
for (const name of Object.values(volumeNames(project)))
  docker(['volume', 'inspect', '--format', '{{.Name}}', name])
fs.writeFileSync(
  path.join(cache, 'all-file-sha256-after.json'),
  JSON.stringify(after, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 },
)
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const report = {
  date: new Date().toISOString(),
  project,
  source: manifest.source,
  result: 'BLOCKED_ORIGINAL_RETAINED',
  blocker:
    'Frozen maintenance cannot inspect a clean WAL-mode SQLite database through its strict read-only volume mounts. Original SQLite error was reproduced on private copies; no checkpoint or runtime fix was applied.',
  activeRelease: fault.originalActive,
  candidates,
  fileCount: before.length,
  allFileSHA256Before: hash(before),
  allFileSHA256After: hash(after),
  allFileAndLinkEntriesUnchanged: true,
  originalDBSHA256: diagnostic.originalSHA256,
  publicBeforeShutdown: publicNow,
  writersStoppedBeforeInspection: true,
  exactProjectStopped: true,
  allSixVolumesRetained: true,
  imagesRetained: true,
  followingSteps: {
    singleObjectRepair: 'NOT_RUN',
    repairAudit: 'NOT_CREATED',
    postRepairBackup: 'NOT_RUN',
    freshVolumeRestore: 'NOT_RUN',
    postRepairLifecycleUpdate: 'NOT_RUN',
  },
  fullInventory:
    'Private local test-controller cache; no database values or backup copied into evidence',
  scope:
    'Only exact new closure-fault project. No historical test volumes, unrelated containers or production connections.',
}
fs.writeFileSync(
  'docs/evidence/P6E-final-current-repair-retention.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify(report, null, 2))
