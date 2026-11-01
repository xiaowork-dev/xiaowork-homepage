// Isolated maintenance专项 only. Never starts the full release/backup chain.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const root = process.cwd()
const runID = process.argv[2]
const focused = process.argv[3] === 'focused'
assert.ok(process.argv[3] === undefined || focused)
assert.match(runID ?? '', /^r[0-9]+$/)
const file = `docs/evidence/P6E-barrier-${runID}.json`
assert.ok(!fs.existsSync(file), 'Historical evidence is immutable')
const cache = path.resolve('.cache', `p6e-barrier-${runID}`)
fs.mkdirSync(cache, { recursive: true })
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Docker Desktop Linux kernel isolated maintenance tests; NOT native Linux release acceptance',
  runID,
  focused,
  commands: [],
  steps: [],
  sourceFiles: {},
}
const hash = (b) => createHash('sha256').update(b).digest('hex')
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, {
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
  const record = {
    executable: exe,
    args,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout,
    stderr: result.stderr,
  }
  report.commands.push(record)
  save()
  assert.equal(result.status, 0, `${exe} failed; preserved ${file}`)
  return result.stdout.trim()
}
function copyTree(source, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'bin' || entry.name === 'vendor') continue
    const from = path.join(source, entry.name),
      to = path.join(dest, entry.name)
    assert.ok(!entry.isSymbolicLink())
    if (entry.isDirectory()) copyTree(from, to)
    else {
      fs.copyFileSync(from, to)
      report.sourceFiles[path.relative(root, from).replaceAll('\\', '/')] = hash(
        fs.readFileSync(from),
      )
    }
  }
}
try {
  report.head = command('git', ['rev-parse', 'HEAD'])
  report.context = command('docker', ['context', 'show'])
  report.daemon = JSON.parse(
    command('docker', [
      'info',
      '--format',
      '{"ID":{{json .ID}},"Name":{{json .Name}},"OperatingSystem":{{json .OperatingSystem}},"Kernel":{{json .KernelVersion}},"Memory":{{json .MemTotal}}}',
    ]),
  )
  const context = path.join(cache, 'context')
  copyTree('backend', context)
  fs.cpSync('.cache/p6e-gate-vendor', path.join(context, 'vendor'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  })
  const tag = `xiaowork-homepage-p6e-gate:test-${runID}`
  command('docker', [
    'build',
    '--network=none',
    '-f',
    path.join(context, 'gate-test.Dockerfile'),
    '-t',
    tag,
    context,
  ])
  report.image = JSON.parse(command('docker', ['image', 'inspect', tag]))[0]
  const common = [
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '4g',
    '--cpus',
    '2',
    '--pids-limit',
    '256',
    '--tmpfs',
    '/tmp:rw,size=1536m,mode=1777,nosuid,nodev,noexec',
    '--tmpfs',
    '/work:rw,size=1536m,mode=0700,uid=10001,gid=10001,nosuid,nodev,noexec',
  ]
  const cases = focused
    ? [
        [
          'additional-http-boundaries',
          '/tests/httpapi',
          'TestMaintenance(WaitsForAdmittedHTTPTransaction|ControlAccessFailure)',
        ],
      ]
    : [
        ['kernel-process-locks', '/tests/gate', 'TestGate'],
        ['https-and-real-worker', '/tests/httpapi', 'TestMaintenance'],
        ['worker-regression', '/tests/worker', 'Test'],
        ['http-regression', '/tests/httpapi', 'Test'],
      ]
  for (const [name, entry, pattern] of cases) {
    const container = `xiaowork-homepage-v11-barrier-${runID}-${name}`
    report.steps.push({ name, container, status: 'running' })
    save()
    command('docker', [
      'run',
      '--name',
      container,
      ...common,
      '--entrypoint',
      entry,
      tag,
      '-test.v',
      '-test.timeout=10m',
      '-test.run=' + pattern,
    ])
    report.steps.at(-1).status = 'passed'
  }
  const volume = `xiaowork-homepage-v11-barrier-${runID}-ro-control`
  command('docker', ['volume', 'create', volume])
  command('docker', [
    'run',
    '--name',
    `xiaowork-homepage-v11-barrier-${runID}-control-init`,
    ...common,
    '--entrypoint',
    '/tests/control',
    '--mount',
    `type=volume,src=${volume},dst=/control`,
    tag,
    'init',
  ])
  command('docker', [
    'run',
    '--name',
    `xiaowork-homepage-v11-barrier-${runID}-kernel-ro`,
    ...common,
    '--entrypoint',
    '/tests/gate',
    '--mount',
    `type=volume,src=${volume},dst=/control,readonly,volume-nocopy`,
    '-e',
    'P6E_READONLY_GATE=/control',
    tag,
    '-test.v',
    '-test.run=^TestGateReadonlyMount$',
  ])
  report.steps.push({ name: 'kernel-RO-control-mount', status: 'passed', volume })
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'
  report.error = error.message
  if (report.steps.at(-1)?.status === 'running') report.steps.at(-1).status = 'failed'
  process.exitCode = 1
}
report.completedAt = new Date().toISOString()
save()
console.log(
  JSON.stringify(
    { file, result: report.result, steps: report.steps, error: report.error },
    null,
    2,
  ),
)
