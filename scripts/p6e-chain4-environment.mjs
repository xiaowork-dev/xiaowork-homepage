// 本轮只读取证。不会创建容器/卷、触碰源卷、改写旧证据或解除保护。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const output = 'docs/evidence/P6E-chain4-environment.json'
assert.ok(!fs.existsSync(output), '保留既有环境证据，禁止覆盖')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const commands = []
function run(executable, args, encoding = 'utf8') {
  const bytes = execFileSync(executable, args, { timeout: 45000, maxBuffer: 4 << 20 })
  const stdout = bytes.toString(encoding).trim()
  commands.push({ executable, args, exitCode: 0, stdout })
  return stdout
}
const manifestFile = 'docs/evidence/P6E-chain3-runtime-manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestFile))
assert.equal(manifest.source, '4f18eaeaecb86baaca01f148f388e7e86eec68bf')
assert.equal(run('git', ['branch', '--show-current']), 'feat/v1.1-admin-p6a')
const report = {
  date: new Date().toISOString(),
  scope: '只读环境、精确镜像身份和宿主保护检查；不运行整链或活跃发布实验',
  hostPlatform: process.platform,
  source: manifest.source,
  schema: manifest.schema,
  manifestSHA256: hash(fs.readFileSync(manifestFile)),
  commands,
  images: [],
  retainedGuards: [],
  sourceReview: [],
}
const evidence = fs
  .readdirSync('docs/evidence')
  .sort()
  .map((name) => {
    const file = path.join('docs/evidence', name)
    assert.ok(fs.lstatSync(file).isFile(), '证据目录只接受普通文件')
    return { name, sha256: hash(fs.readFileSync(file)) }
  })
report.priorEvidence = { count: evidence.length, listSHA256: hash(JSON.stringify(evidence)) }
const context = JSON.parse(run('docker', ['context', 'inspect']))[0]
report.endpoint = context.Endpoints.docker.Host
assert.equal(report.endpoint, 'npipe:////./pipe/dockerDesktopLinuxEngine')
report.engine = JSON.parse(run('docker', ['info', '--format', '{{json .}}']))
report.engine = Object.fromEntries(
  [
    'ID',
    'OperatingSystem',
    'KernelVersion',
    'OSType',
    'Architecture',
    'ServerVersion',
    'NCPU',
    'MemTotal',
    'Driver',
    'DockerRootDir',
  ].map((key) => [key, report.engine[key]]),
)
// 原始 docker info 可能含本机代理设置；公开证据仅保留白名单字段。
commands[commands.length - 1].stdout = JSON.stringify(report.engine)
if (process.platform === 'win32') {
  report.wslDistributions = run('wsl.exe', ['--list', '--quiet'], 'utf16le')
    .replaceAll('\0', '')
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
}
for (const [role, expected] of Object.entries(manifest.images)) {
  const actual = JSON.parse(
    run('docker', [
      'image',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"source":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"user":{{json .Config.User}},"os":{{json .Os}},"architecture":{{json .Architecture}}}',
      expected.id,
    ]),
  )
  assert.equal(actual.id, expected.id)
  assert.equal(actual.source, manifest.source)
  assert.equal(actual.os, 'linux')
  assert.equal(actual.architecture, 'amd64')
  report.images.push({ role, ...actual })
}
const supervisor = JSON.parse(fs.readFileSync('docs/evidence/P6E-chain3-supervisor.json'))
for (const project of [...supervisor.projects, 'xiaowork-homepage-v11-p6e-atime2-fault']) {
  const root = path.join('.v11-deploy', project)
  const marker = path.join(root, 'recovery-required.json')
  assert.ok(fs.lstatSync(path.join(root, 'operation.lock')).isDirectory())
  assert.ok(fs.lstatSync(marker).isFile() && !fs.lstatSync(marker).isSymbolicLink())
  const before = hash(fs.readFileSync(marker))
  report.retainedGuards.push({ project, lockPresent: true, markerSHA256: before })
}
for (const file of [
  'scripts/v11-maintenance.mjs',
  'scripts/v11-operation.mjs',
  'scripts/p6e-chain3-supervisor.mjs',
  'backend/internal/httpapi/publication.go',
  'backend/internal/httpapi/publication_worker.go',
  'backend/internal/publishworker/runner.go',
  'compose.admin-publish.yaml',
]) {
  const bytes = fs.readFileSync(file)
  const lines = bytes.toString('utf8').split(/\r?\n/)
  report.sourceReview.push({
    file,
    sha256: hash(bytes),
    references: lines.flatMap((text, i) =>
      /recovery-required|operation\.lock|found\.Source|mount\.src|createPublicationJob|workerClaim|Store\.Lock|stopWriters|volume[s]?:/.test(
        text,
      )
        ? [{ line: i + 1, text: text.trim() }]
        : [],
    ),
  })
}
report.pathIdentity = {
  result: 'BLOCKED_ENVIRONMENT_NO_NATIVE_LINUX',
  equivalenceProven: false,
  strictSourceCheckPreserved: true,
  conversionAttempted: false,
  nativeLinuxEnvironmentAvailable: false,
  reason:
    '本机只有 Docker Desktop WSL2；未发现独立 Linux 发行版/Engine，不能把 daemon VM shell 当成已验收的同命名空间 Linux 运维环境。',
}
report.concurrency = {
  result: 'BLOCKED_DESIGN_GAP_NOT_DYNAMICALLY_TESTED',
  observations: [
    'operation.lock/recovery-required 只存在宿主 .v11-deploy，API 与 Worker 未挂载此目录。',
    'createPublicationJob、workerClaim 和 Worker RunNext 未读取宿主 marker。',
    'Worker 的 publications 内核锁避免第二个 Worker，并不等于宿主维护标记。',
    '监督进程在子控制器退出后停止写者，存在检测与停止窗口。',
  ],
  scenarios: [
    '发布/维护同时到达',
    '父控制器 SIGKILL',
    '父监督进程退出',
    '锁建立但 API 未停',
    'Worker 在途维护请求',
    '持久标记存在时服务重启',
  ].map((name) => ({ name, result: 'NOT_RUN_CURRENT_ROUND' })),
}
report.chain = {
  result: 'NOT_RUN_ENVIRONMENT_PREFLIGHT_BLOCKED',
  stages: [
    '新环境启动',
    '真实故障及停写',
    '只读检查',
    '单对象修复',
    'metadata/SHA/HTTP',
    '一致性备份',
    '空卷恢复',
    '数据库/图片/页面',
    '跨源码更新/代码回退',
    '内容恢复',
    '再次备份/空卷恢复',
  ].map((name) => ({ name, result: 'NOT_RUN' })),
}
for (const guard of report.retainedGuards)
  assert.equal(
    hash(fs.readFileSync(path.join('.v11-deploy', guard.project, 'recovery-required.json'))),
    guard.markerSHA256,
  )
for (const entry of evidence)
  assert.equal(hash(fs.readFileSync(path.join('docs/evidence', entry.name))), entry.sha256)
report.priorEvidence.unchanged = true
report.result = 'BLOCKED_NOT_A_RELEASE_ACCEPTANCE'
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(
  JSON.stringify({
    result: report.result,
    imagesVerified: report.images.length,
    retainedGuards: report.retainedGuards.length,
    output,
  }),
)
process.exitCode = 2
