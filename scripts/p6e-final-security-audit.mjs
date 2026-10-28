// Audit a pinned six-image set. No image push, service mutation or production access.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { localEngine } from './v11-maintenance.mjs'

const run = promisify(execFile)
const repository = process.cwd()
const [manifestPath, sourceDirectory] = process.argv.slice(2)
assert.ok(manifestPath && sourceDirectory, 'Supply pinned manifest and immutable source directory')
const spec = JSON.parse(await readFile(manifestPath, 'utf8'))
const roles = ['api', 'worker', 'gateway', 'frontend', 'static', 'maintenance']
assert.match(spec.source ?? '', /^[a-f0-9]{40}$/)
assert.deepEqual(Object.keys(spec.images).sort(), [...roles].sort())
assert.equal(spec.schema, 3, 'Re-review schema if the frozen set changes')
const images = Object.fromEntries(
  roles.map((role) => [
    role,
    typeof spec.images[role] === 'string' ? spec.images[role] : spec.images[role].id,
  ]),
)
const sourceRoot = path.resolve(sourceDirectory)
const evidence = path.resolve('docs/evidence')
const cache = path.resolve('.cache/p6e-final-security', spec.source)
await mkdir(cache, { recursive: true })
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const cli = async (...args) =>
  (
    await run('docker', args, { encoding: 'utf8', timeout: 600000, maxBuffer: 16 << 20 })
  ).stdout.trim()
localEngine()
let previous
try {
  previous = JSON.parse(
    await readFile(path.join(evidence, 'P6E-final-security-audit.json'), 'utf8'),
  )
} catch (error) {
  assert.equal(error.code, 'ENOENT')
}
const report = {
  date: new Date().toISOString(),
  source: spec.source,
  schema: spec.schema,
  manifestSha256: hash(await readFile(manifestPath)),
  scope:
    'Pinned local final six-role images, immutable source and Linux target; no production access',
  scannerVersion: (await cli('scout', 'version')).match(/version:\s*(.*)/)?.[1],
  advisoryDatabase:
    'Live Scout service at recorded times; SARIF exposes no immutable database revision',
  images: [],
  binaries: [],
  sourceChecks: {},
  attempts: previous?.source === spec.source ? previous.attempts : [],
  limitations: [
    'Preserved low/unspecified findings are not silently suppressed.',
    'Scanner zero-high results do not certify application logic, operations or unknown vulnerabilities.',
  ],
  result: 'IN_PROGRESS',
}
const save = async () =>
  writeFile(
    path.join(evidence, 'P6E-final-security-audit.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
await save()
for (const role of roles) {
  const imageId = images[role]
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
  const image = JSON.parse(await cli('image', 'inspect', imageId))[0]
  assert.equal(image.Id, imageId)
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'], spec.source)
  assert.equal(image.Config.User, role === 'frontend' ? 'nginx' : '10001:10001')
  assert.equal(image.Os, 'linux')
  assert.equal(image.Architecture, 'amd64')
  let osPackages
  if (['worker', 'gateway', 'frontend', 'static'].includes(role)) {
    osPackages = await cli(
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--entrypoint',
      '/bin/sh',
      imageId,
      '-c',
      "id -u; cat /etc/alpine-release; grep -A4 '^P:musl$' /lib/apk/db/installed; cat /etc/apk/repositories",
    )
    assert.match(osPackages, /^[1-9][0-9]*\r?\n3\.24\./)
    assert.match(osPackages, /P:musl\r?\nV:1\.2\.6-r3/)
    assert.ok(!osPackages.includes('/edge/'), 'Mixed Alpine edge repositories are not accepted')
  }
  const cached =
    previous?.source === spec.source && previous.manifestSha256 === report.manifestSha256
      ? previous.images.find((entry) => entry.role === role && entry.imageId === imageId)
      : undefined
  if (cached && hash(await readFile(path.join(evidence, cached.file))) === cached.sha256) {
    report.images.push({ ...cached, osPackages })
    await save()
    console.log(`Retained completed exact final ${role} scan for unchanged image ID`)
    continue
  }
  const file = `P6E-final-image-${role}.sarif.json`
  const startedAt = new Date().toISOString()
  try {
    await cli(
      'scout',
      'cves',
      '--format',
      'sarif',
      '--output',
      path.join(evidence, file),
      'local://' + imageId,
    )
    const sarif = JSON.parse(await readFile(path.join(evidence, file), 'utf8'))
    const { rules, version } = sarif.runs[0].tool.driver
    const counts = {}
    for (const finding of sarif.runs[0].results) {
      const rule = rules.find((value) => value.id === finding.ruleId)
      const severity = rule.properties?.cvssV3_severity ?? 'UNSPECIFIED'
      counts[severity] = (counts[severity] ?? 0) + 1
    }
    report.images.push({
      role,
      imageId,
      source: image.Config.Labels['org.opencontainers.image.revision'],
      user: image.Config.User,
      osPackages,
      startedAt,
      completedAt: new Date().toISOString(),
      scannerVersion: version,
      file,
      sha256: hash(await readFile(path.join(evidence, file))),
      counts,
      findings: sarif.runs[0].results.length,
      advisories: rules.map((rule) => ({
        id: rule.id,
        severity: rule.properties?.cvssV3_severity ?? 'UNSPECIFIED',
        fixedVersion: rule.properties?.fixed_version,
        packages: rule.properties?.purls,
      })),
    })
    console.log(`Scanned final ${role} ${imageId} ${JSON.stringify(counts)}`)
  } catch (error) {
    report.attempts.push({
      role,
      imageId,
      startedAt,
      completedAt: new Date().toISOString(),
      result: 'TOOL_FAILED_NOT_PASS',
      code: error.code,
      signal: error.signal,
    })
    report.result = 'INCOMPLETE'
    await save()
    throw error
  }
  await save()
}
const scanner = path.resolve('.cache/p6e-go/bin/govulncheck.exe')
assert.ok((await readFile(scanner)).byteLength > 0)
report.govulnScanner = {
  module: 'golang.org/x/vuln@v1.9.0',
  sha256: hash(await readFile(scanner)),
  sourceEvidence: 'P6E-govuln-tool-source.json',
}
for (const role of ['api', 'worker', 'maintenance']) {
  const executable = `/homepage-${role}`
  const localFile = path.join(cache, `homepage-${role}`)
  let id
  try {
    id = await cli(
      'create',
      '--name',
      `xiaowork-homepage-final-audit-${role}-${spec.source.slice(0, 12)}`,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--label',
      'io.xiaowork.p6e.final-audit=1',
      images[role],
    )
    assert.match(id, /^[a-f0-9]{64}$/)
    await cli('cp', `${id}:${executable}`, localFile)
  } finally {
    if (id) await cli('rm', id)
  }
  let output,
    scannerExit = 0
  try {
    output = await run(scanner, ['-mode=binary', '-show=verbose', localFile], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 4 << 20,
    })
  } catch (error) {
    assert.equal(typeof error.code, 'number')
    scannerExit = error.code
    output = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
  const file = `P6E-final-govuln-${role}-binary.txt`
  await writeFile(path.join(evidence, file), (output.stdout + output.stderr).replace(/\r\n/g, '\n'))
  const buildInfo = (
    await run('C:\\dev\\Go\\go\\bin\\go.exe', ['version', '-m', localFile], {
      encoding: 'utf8',
      timeout: 30000,
    })
  ).stdout.replace(localFile, `<exact-${role}-binary>`)
  assert.ok(
    !buildInfo.includes('p6e_fault'),
    'Fault build tags are forbidden in final role binaries',
  )
  report.binaries.push({
    role,
    imageId: images[role],
    executable,
    bytes: (await readFile(localFile)).byteLength,
    binarySha256: hash(await readFile(localFile)),
    buildInfo,
    scannerExit,
    file,
    reportSha256: hash(await readFile(path.join(evidence, file))),
  })
  await save()
}
// Verify every frozen backend file against the chosen Git tree before scanning.
const files = (
  await run('git', ['ls-tree', '-r', '--name-only', spec.source, '--', 'backend'], {
    cwd: repository,
    encoding: 'utf8',
  })
).stdout
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
for (const file of files) {
  const expected = (
    await run('git', ['show', `${spec.source}:${file}`], {
      cwd: repository,
      encoding: 'buffer',
      maxBuffer: 8 << 20,
    })
  ).stdout
  assert.equal(
    hash(await readFile(path.join(sourceRoot, file))),
    hash(expected),
    `Source bytes differ from Git tree: ${file}`,
  )
}
report.sourceChecks.frozenBackendFilesVerified = files.length
const goBin = 'C:\\dev\\Go\\go\\bin'
const env = {
  ...process.env,
  PATH: goBin + path.delimiter + process.env.PATH,
  GOOS: 'linux',
  GOARCH: 'amd64',
  CGO_ENABLED: '0',
  GOPROXY: 'off',
  GOTOOLCHAIN: 'local',
  GOCACHE: path.join(cache, 'go-build'),
}
const roots = ['./cmd/homepage-api', './cmd/homepage-maintenance', './cmd/homepage-worker']
let sourceOutput,
  sourceExit = 0
try {
  sourceOutput = await run(scanner, ['-show=verbose', ...roots], {
    cwd: path.join(sourceRoot, 'backend'),
    env,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 4 << 20,
  })
} catch (error) {
  assert.equal(typeof error.code, 'number')
  sourceExit = error.code
  sourceOutput = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
}
const sourceFile = 'P6E-final-govuln-linux-source.txt'
await writeFile(
  path.join(evidence, sourceFile),
  (sourceOutput.stdout + sourceOutput.stderr).replace(/\r\n/g, '\n'),
)
const imports = (
  await run(path.join(goBin, 'go.exe'), ['list', '-deps', ...roots], {
    cwd: path.join(sourceRoot, 'backend'),
    env,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 4 << 20,
  })
).stdout
  .split(/\r?\n/)
  .filter(Boolean)
report.sourceChecks = {
  ...report.sourceChecks,
  roots,
  target: {
    GOOS: env.GOOS,
    GOARCH: env.GOARCH,
    CGO_ENABLED: env.CGO_ENABLED,
    GOPROXY: env.GOPROXY,
    GOTOOLCHAIN: env.GOTOOLCHAIN,
  },
  scannerExit: sourceExit,
  file: sourceFile,
  sha256: hash(await readFile(path.join(evidence, sourceFile))),
  importedCrypto: imports.filter((name) => name.startsWith('golang.org/x/crypto/')),
  importedOpenpgp: imports.filter((name) => name.includes('/openpgp')),
}
report.result = 'SCANNED_WITH_FINDINGS_PRESERVED'
report.completedAt = new Date().toISOString()
await save()
assert.equal(sourceExit, 0, 'Reachable source vulnerability or tool failure requires review')
assert.equal(report.sourceChecks.importedOpenpgp.length, 0)
console.log('Collected final six-image and exact source/binary security evidence')
