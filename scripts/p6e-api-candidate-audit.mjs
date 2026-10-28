// Read-only audit of one API image. No containers are created or changed.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const source = process.argv[2]
assert.match(source ?? '', /^[a-f0-9]{40}$/)
const tag = `xiaowork-homepage-api:p6e-diagnostics-${source.slice(0, 7)}`
const evidence = path.resolve('docs/evidence')
const cache = path.resolve('.cache/p6e-go/api-candidate-' + source.slice(0, 12))
await mkdir(cache, { recursive: true })
const cli = async (...args) =>
  (
    await run('docker', args, {
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 16 << 20,
    })
  ).stdout.trim()
assert.equal(
  await cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
const projection =
  '{"id":{{json .Id}},"created":{{json .Created}},"os":{{json .Os}},"arch":{{json .Architecture}},"source":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
const identity = JSON.parse(await cli('image', 'inspect', '--format', projection, tag))
assert.match(identity.id, /^sha256:[a-f0-9]{64}$/)
assert.equal(identity.source, source)
const baselineTag = 'xiaowork-homepage-api:p6d-dev'
const baselineBefore = await cli('image', 'inspect', '--format', '{{.Id}}', baselineTag)
const report = {
  date: new Date().toISOString(),
  scope: 'One successor API candidate only; not a rebuilt six-role release or deployment approval',
  expectedSource: source,
  tag,
  identity,
  containerMutations: 0,
  method:
    'Scout reads local image ID; docker image save exports layers for exact /homepage-api extraction without creating containers',
  evidenceNormalization:
    'UTF-8 LF line endings before hashing; tool output content otherwise preserved',
  baseline: { tag: baselineTag, idBefore: baselineBefore },
  result: 'IN_PROGRESS',
  limitations: [
    'No-high/critical result is not a claim of zero application or system risk.',
    'Scout uses its live service; SARIF does not expose a fixed advisory-database revision.',
    'Stripped Go binary scanning can fall back to module precision. Preserve all findings; baseline source reachability analysis is separate evidence and is not silently relabeled for this source.',
    'Only the API image is audited here. Other five roles remain on their separately recorded baseline identities.',
  ],
}
const saveReport = async () =>
  writeFile(
    path.join(evidence, 'P6E-api-candidate-audit.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
try {
  const priorFile = 'P6E-api-candidate-scout-first-attempt.txt'
  const bytes = await readFile(path.join(evidence, priorFile))
  report.previousToolAttempt = {
    result: 'TOOL_FAILED_NOT_A_PASS',
    exitCode: 1,
    file: priorFile,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
} catch (error) {
  assert.equal(error.code, 'ENOENT')
}
await saveReport()

const sarifName = 'P6E-image-api-candidate.sarif.json'
const startedAt = new Date().toISOString()
let counts
try {
  await cli(
    'scout',
    'cves',
    '--format',
    'sarif',
    '--output',
    path.join(evidence, sarifName),
    'local://' + identity.id,
  )
  const sarifText = (await readFile(path.join(evidence, sarifName), 'utf8')).replace(/\r\n/g, '\n')
  await writeFile(path.join(evidence, sarifName), sarifText)
  const sarif = JSON.parse(sarifText)
  const { rules, version } = sarif.runs[0].tool.driver
  counts = {}
  for (const finding of sarif.runs[0].results) {
    const rule = rules.find((value) => value.id === finding.ruleId)
    const severity = rule.properties?.cvssV3_severity ?? 'UNSPECIFIED'
    counts[severity] = (counts[severity] ?? 0) + 1
  }
  report.scout = {
    result: 'SCANNED',
    startedAt,
    completedAt: new Date().toISOString(),
    scannerVersion: version,
    file: sarifName,
    sha256: createHash('sha256')
      .update(await readFile(path.join(evidence, sarifName)))
      .digest('hex'),
    counts,
    findings: sarif.runs[0].results.length,
    uniqueAdvisories: rules.length,
    advisories: rules.map((rule) => ({
      id: rule.id,
      severity: rule.properties?.cvssV3_severity ?? 'UNSPECIFIED',
      fixedVersion: rule.properties?.fixed_version,
      packages: rule.properties?.purls,
    })),
  }
} catch (error) {
  const file = 'P6E-api-candidate-scout-error.txt'
  await writeFile(
    path.join(evidence, file),
    ((error.stdout ?? '') + (error.stderr ?? '')).replace(/\r\n/g, '\n'),
  )
  report.scout = {
    result: 'TOOL_FAILED_NOT_A_PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: error.code,
    file,
    earlierAttempt: 'P6E-api-candidate-scout-first-attempt.txt',
  }
}
await saveReport()

const archive = path.join(cache, 'image.tar')
await cli('image', 'save', '--output', archive, identity.id)
const tarRead = async (archivePath, entry) =>
  (
    await run('tar', ['-xOf', archivePath, entry], {
      encoding: 'buffer',
      timeout: 120000,
      maxBuffer: 256 << 20,
    })
  ).stdout
const manifests = JSON.parse((await tarRead(archive, 'manifest.json')).toString('utf8'))
assert.equal(manifests.length, 1, 'Expected one image in the image-ID-only export')
let binary
let binaryLayer
for (const [index, layer] of manifests[0].Layers.entries()) {
  assert.match(layer, /^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\/layer\.tar)$/)
  const bytes = await tarRead(archive, layer)
  if (layer.startsWith('blobs/sha256/')) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'), layer.split('/')[2])
  }
  const localLayer = path.join(cache, `layer-${index}.tar`)
  await writeFile(localLayer, bytes)
  const listing = (
    await run('tar', ['-tf', localLayer], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 << 20,
    })
  ).stdout
    .split(/\r?\n/)
    .filter(Boolean)
  const normalize = (entry) => entry.replace(/^(?:\.\/)+/, '')
  if (listing.some((entry) => ['.wh.homepage-api', '.wh..wh..opq'].includes(normalize(entry)))) {
    binary = undefined
    binaryLayer = undefined
  }
  const matches = listing.filter((entry) => normalize(entry) === 'homepage-api')
  assert.ok(matches.length <= 1)
  if (matches.length === 1) {
    const verbose = (
      await run('tar', ['-tvf', localLayer, matches[0]], {
        encoding: 'utf8',
        timeout: 30000,
      })
    ).stdout.trim()
    assert.match(verbose, /^-/, 'API executable must be a regular file, not a link')
    binary = await tarRead(localLayer, matches[0])
    binaryLayer = layer
  }
}
assert.ok(binary, 'No final /homepage-api file in exported image layers')
assert.equal(binary.subarray(0, 4).toString('hex'), '7f454c46', 'Expected the Linux ELF executable')
const binaryPath = path.join(cache, 'homepage-api')
await writeFile(binaryPath, binary)
const scanner = path.resolve('.cache/p6e-go/bin/govulncheck.exe')
let scan
let scannerExit = 0
try {
  scan = await run(scanner, ['-mode=binary', '-show=verbose', binaryPath], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 << 20,
  })
} catch (error) {
  assert.equal(typeof error.code, 'number', 'Scanner launch failed')
  scannerExit = error.code
  scan = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
}
const binaryReport = 'P6E-govuln-api-candidate-binary.txt'
await writeFile(
  path.join(evidence, binaryReport),
  (scan.stdout + scan.stderr).replace(/\r\n/g, '\n'),
)
report.binary = {
  sourcePath: '/homepage-api',
  extractionLayer: binaryLayer,
  sha256: createHash('sha256').update(binary).digest('hex'),
  bytes: binary.length,
  scannerSource: 'golang.org/x/vuln@v1.9.0; see P6E-govuln-tool-source.json',
  scannerSha256: createHash('sha256')
    .update(await readFile(scanner))
    .digest('hex'),
  command: 'govulncheck -mode=binary -show=verbose <exact-exported-/homepage-api>',
  scannerExit,
  file: binaryReport,
  reportSha256: createHash('sha256')
    .update(await readFile(path.join(evidence, binaryReport)))
    .digest('hex'),
}
assert.equal(JSON.parse(await cli('image', 'inspect', '--format', projection, tag)).id, identity.id)
report.baseline.idAfter = await cli('image', 'inspect', '--format', '{{.Id}}', baselineTag)
assert.equal(report.baseline.idAfter, baselineBefore, 'Baseline API tag must stay unchanged')
report.result =
  report.scout.result === 'SCANNED'
    ? 'SCANNED_WITH_FINDINGS_PRESERVED'
    : 'PARTIAL_SCOUT_UNAVAILABLE'
report.completedAt = new Date().toISOString()
await saveReport()
console.log(
  JSON.stringify({
    imageId: identity.id,
    scoutCounts: counts,
    scannerExit,
    binarySha256: report.binary.sha256,
  }),
)
