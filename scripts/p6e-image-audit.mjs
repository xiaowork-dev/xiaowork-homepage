// Local final-image CVE evidence. No image push and no service mutation.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const expectedSource = process.argv[2]
assert.match(expectedSource ?? '', /^[a-f0-9]{40}$/, 'Supply the reviewed runtime source SHA')
const images = {
  api: 'xiaowork-homepage-api:p6d-dev',
  worker: 'xiaowork-homepage-worker:p6d-dev',
  gateway: 'xiaowork-homepage-admin-gateway:p6d-dev',
  frontend: 'xiaowork-homepage:p6d-legacy',
  static: 'xiaowork-homepage-publication-static:p6e-dev',
  maintenance: 'xiaowork-homepage-maintenance:p6e-final',
}
const cli = async (...args) =>
  (
    await run('docker', args, {
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 8 << 20,
    })
  ).stdout.trim()
assert.equal(
  await cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
  'Only the local test Docker Desktop engine is permitted',
)
let prior
try {
  prior = JSON.parse(await readFile('docs/evidence/P6E-image-audit.json', 'utf8'))
} catch {
  // The first invocation has no prior checkpoint.
}
const report = {
  date: new Date().toISOString(),
  expectedSource,
  scope: 'Local final runtime image filesystem; no pushes, no production or service mutation',
  scannerVersion: (await cli('scout', 'version')).match(/version:\s*(.*)/)?.[1],
  advisoryDatabase:
    'Live Docker Scout service as queried at each recorded time; tool does not expose an immutable database revision in SARIF',
  images: [],
  attempts: prior?.expectedSource === expectedSource ? (prior.attempts ?? []) : [],
  limitations: [
    'No-high/critical is not a claim of zero system risk; permissions and application logic are validated separately.',
    'UNSPECIFIED findings are preserved without inventing a severity.',
    'musl CVE-2026-107891 has a version-range conflict with official Alpine 3.24 secdb; both original sources are retained.',
  ],
}
const projection =
  '{"id":{{json .Id}},"created":{{json .Created}},"os":{{json .Os}},"arch":{{json .Architecture}},"source":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
for (const [role, image] of Object.entries(images)) {
  const identity = JSON.parse(await cli('image', 'inspect', '--format', projection, image))
  assert.match(identity.id, /^sha256:[a-f0-9]{64}$/)
  assert.equal(identity.source, expectedSource, `${role} must match the reviewed source`)
  const file = `P6E-image-${role}-final.sarif.json`
  const cached =
    prior?.expectedSource === expectedSource
      ? prior.images.find((value) => value.role === role && value.identity.id === identity.id)
      : undefined
  if (cached) {
    await readFile(path.join('docs/evidence', cached.file), 'utf8')
    report.images.push(cached)
    console.log(`Retained completed ${role} scan for the same image ID`)
    continue
  }
  const startedAt = new Date().toISOString()
  try {
    await cli(
      'scout',
      'cves',
      '--format',
      'sarif',
      '--output',
      path.join('docs/evidence', file),
      'local://' + identity.id,
    )
  } catch (error) {
    report.attempts.push({
      role,
      imageId: identity.id,
      startedAt,
      completedAt: new Date().toISOString(),
      result: 'TOOL_FAILED',
      code: error.code,
      signal: error.signal,
    })
    report.result = 'INCOMPLETE'
    await writeFile('docs/evidence/P6E-image-audit.json', JSON.stringify(report, null, 2) + '\n')
    throw error
  }
  assert.equal(
    JSON.parse(await cli('image', 'inspect', '--format', projection, image)).id,
    identity.id,
    'Image tag changed while it was being audited',
  )
  const result = JSON.parse(await readFile(path.join('docs/evidence', file), 'utf8'))
  const { rules, version } = result.runs[0].tool.driver
  const counts = {}
  for (const finding of result.runs[0].results) {
    const rule = rules.find((value) => value.id === finding.ruleId)
    const severity = rule.properties?.cvssV3_severity ?? 'UNSPECIFIED'
    counts[severity] = (counts[severity] ?? 0) + 1
  }
  report.images.push({
    role,
    image,
    identity,
    startedAt,
    completedAt: new Date().toISOString(),
    scannerVersion: version,
    file,
    counts,
    findings: result.runs[0].results.length,
    uniqueAdvisories: rules.length,
    advisories: rules.map((value) => ({
      id: value.id,
      severity: value.properties?.cvssV3_severity,
      fixedVersion: value.properties?.fixed_version,
      packages: value.properties?.purls,
    })),
  })
  console.log(`Scanned ${role} ${identity.id} ${JSON.stringify(counts)}`)
  report.result = 'IN_PROGRESS'
  await writeFile('docs/evidence/P6E-image-audit.json', JSON.stringify(report, null, 2) + '\n')
}
report.result = 'SCANNED'
await writeFile('docs/evidence/P6E-image-audit.json', JSON.stringify(report, null, 2) + '\n')
