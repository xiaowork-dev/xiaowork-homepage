// 阻塞后的只读收尾：验证原证据/锁、受信任务拒绝及依赖输入；不续跑修复链。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { backupProject, docker, localEngine } from './v11-maintenance.mjs'
import { currentRepair } from './v11-current-repair.mjs'
import { runLifecycle } from './v11-release.mjs'

const output = 'docs/evidence/P6E-chain4-closure.json'
assert.ok(!fs.existsSync(output))
localEngine()
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const read = (file) => JSON.parse(fs.readFileSync('docs/evidence/' + file))
const environment = read('P6E-chain4-environment.json')
const runtime = read('P6E-chain3-runtime-manifest.json')
const security = read('P6E-chain4-security-audit.json')
const upstream = read('P6E-chain4-upstream.json')
const npmInvocation = read('P6E-chain4-security-invocation.json')
const project = 'xiaowork-homepage-v11-p6e-chain3-fault'
const maintenance = runtime.images.maintenance.id
const report = {
  date: new Date().toISOString(),
  source: runtime.source,
  runtimeChanged: false,
  result: 'BLOCKED_ENVIRONMENT_AND_RUNTIME_MAINTENANCE_COORDINATION',
  guards: [],
  rejectedOperations: [],
  frozenInputs: [],
  containers: [],
  commands: [],
  security: {
    images: security.images.map(({ role, imageId, counts }) => ({ role, imageId, counts })),
    binaries: security.binaries.map(({ role, scannerExit }) => ({ role, scannerExit })),
    sourceExit: security.sourceChecks.scannerExit,
    importedOpenpgp: security.sourceChecks.importedOpenpgp,
    npm: npmInvocation.operations
      .filter((entry) => entry.counts)
      .map(({ cwd, exitCode, counts }) => ({ cwd, exitCode, counts })),
  },
}
const prior = fs
  .readdirSync('docs/evidence')
  .sort()
  .filter((name) => !name.startsWith('P6E-chain4-'))
  .map((name) => ({ name, sha256: hash(fs.readFileSync(path.join('docs/evidence', name))) }))
assert.equal(prior.length, environment.priorEvidence.count)
assert.equal(hash(JSON.stringify(prior)), environment.priorEvidence.listSHA256)
report.priorEvidence = {
  count: prior.length,
  listSHA256: hash(JSON.stringify(prior)),
  unchanged: true,
}
for (const guard of environment.retainedGuards) {
  const state = path.join('.v11-deploy', guard.project)
  assert.ok(fs.lstatSync(path.join(state, 'operation.lock')).isDirectory())
  assert.equal(
    hash(fs.readFileSync(path.join(state, 'recovery-required.json'))),
    guard.markerSHA256,
  )
  report.guards.push({ ...guard, unchanged: true })
}
for (const [name, action] of [
  [
    'backup',
    () => backupProject(project, maintenance, path.resolve('.cache/chain4-must-not-create')),
  ],
  ['repair-inspect', () => currentRepair('inspect', project, maintenance)],
  [
    'update',
    () =>
      runLifecycle([
        'update',
        '--project',
        project,
        '--spec',
        '.cache/nonexistent-chain4-spec.json',
      ]),
  ],
]) {
  let rejected
  try {
    action()
  } catch (error) {
    rejected = error
  }
  assert.ok(rejected, '既有持久保护必须拒绝操作')
  if (name === 'update') {
    // 生命周期入口先以 mkdir 原子争用锁，因此返回原始 EEXIST，不能泛化为任意异常。
    assert.equal(rejected.code, 'EEXIST')
    assert.equal(rejected.path, path.resolve('.v11-deploy', project, 'operation.lock'))
  } else {
    assert.match(rejected.message, /Persistent (operation.lock|recovery-required)/)
  }
  report.rejectedOperations.push({
    name,
    result: 'REFUSED_BY_EXISTING_PERSISTENT_GUARD',
    error: rejected.message,
    code: rejected.code,
  })
}
assert.ok(!fs.existsSync('.cache/chain4-must-not-create'))
for (const file of [
  'package-lock.json',
  'admin/package-lock.json',
  'backend/go.mod',
  'backend/go.sum',
]) {
  const frozen = execFileSync('git', ['show', `${runtime.source}:${file}`])
  const current = fs.readFileSync(file)
  assert.equal(hash(frozen), hash(current))
  report.frozenInputs.push({ file, sha256: hash(current), matchesCandidate: true })
}
const sourceChanges = execFileSync(
  'git',
  [
    'diff',
    '--name-only',
    runtime.source,
    '--',
    'backend',
    'app',
    'admin',
    'shared',
    'server',
    'public',
    'deploy',
    'Dockerfile',
    'compose*.yaml',
    'package*.json',
    'nuxt.config.ts',
    'scripts/v11-*',
  ],
  { encoding: 'utf8' },
).trim()
assert.equal(sourceChanges, '', '运行输入改变，必须重新冻结并构建六角色')
report.runtimeInputDiff = []
const ids = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
  .split(/\s+/)
  .filter(Boolean)
for (const id of ids) {
  const container = JSON.parse(
    docker([
      'inspect',
      '--format',
      '{"id":{{json .Id}},"image":{{json .Image}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"status":{{json .State.Status}}}',
      id,
    ]),
  )
  if (['api', 'worker', 'api-init', 'publication-init'].includes(container.service))
    assert.equal(container.running, false)
  report.containers.push(container)
}
const failed = '263bf89779fc815c811c314bd814992ac4a7d01a5feb473e462e254621cf489a'
report.failedBackupContainer = JSON.parse(
  docker([
    'inspect',
    '--format',
    '{"id":{{json .Id}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}}}',
    failed,
  ]),
)
assert.equal(report.failedBackupContainer.status, 'created')
const find = (name) => upstream.results.find((entry) => entry.name === name)
assert.ok(upstream.results.every((entry) => entry.result === 'FETCHED'))
assert.equal(
  find('musl-3.24-stable-CVE-2026-107891.patch').sha512,
  find('musl-master-CVE-2026-107891.patch').sha512,
)
report.upstream = {
  file: 'P6E-chain4-upstream.json',
  fetched: upstream.results.length,
  muslSamePatchSHA512: find('musl-3.24-stable-CVE-2026-107891.patch').sha512,
  nodeForgeIntegrityMatches:
    JSON.parse(fs.readFileSync('package-lock.json')).packages['node_modules/node-forge']
      .integrity === find('node-forge/1.4.1').package.integrity,
  nuxtCompatiblePatchAvailable: find('nuxt/4.6.3').package.version,
  installedNuxt: JSON.parse(fs.readFileSync('package-lock.json')).packages['node_modules/nuxt']
    .version,
  deepmergeLatest: find('deepmerge/latest').package.version,
}
assert.ok(report.upstream.nodeForgeIntegrityMatches)
// 重复环境收集器必须拒绝覆盖，输出仍逐字节相同。
const file = 'docs/evidence/P6E-chain4-environment.json'
const before = hash(fs.readFileSync(file))
const duplicate = spawnSync(process.execPath, ['scripts/p6e-chain4-environment.mjs'], {
  encoding: 'utf8',
})
assert.notEqual(duplicate.status, 0)
assert.match(duplicate.stderr, /保留既有环境证据/)
assert.equal(hash(fs.readFileSync(file)), before)
report.commands.push({
  executable: 'node',
  args: ['scripts/p6e-chain4-environment.mjs'],
  exitCode: duplicate.status,
  purpose: '重复执行应拒绝覆盖，非重新验收',
  stderr: duplicate.stderr.replaceAll(process.cwd(), '<repository>'),
  outputUnchanged: true,
})
report.chain = environment.chain
report.concurrency = environment.concurrency
report.productionReady = false
report.productionTouched = false
for (const guard of report.guards)
  assert.equal(
    hash(fs.readFileSync(path.join('.v11-deploy', guard.project, 'recovery-required.json'))),
    guard.markerSHA256,
  )
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(
  JSON.stringify({
    result: report.result,
    priorEvidenceFilesUnchanged: prior.length,
    guardsRetained: report.guards.length,
    refusedOperations: report.rejectedOperations.length,
    output,
  }),
)
