// Stage only Git-tracked/nonignored source and evidence, never ignored caches,
// databases or backups. The scanner is local, read-only and has no network.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = process.cwd()
const cli = async (command, args) =>
  (await run(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 << 20 })).stdout.trim()
assert.equal(path.resolve(await cli('git', ['rev-parse', '--show-toplevel'])), root)
assert.equal(
  await cli('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
const image = 'zricethezav/gitleaks:v8.28.0'
const imageId = await cli('docker', ['image', 'inspect', '--format', '{{.Id}}', image])
assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
const created = new Date()
const directory = path.resolve(
  '.cache/p6e-repository-scan/' + created.toISOString().replaceAll(/[:.]/g, '-'),
)
const staged = path.join(directory, 'source')
const privateReport = path.join(directory, 'report')
await mkdir(staged, { recursive: true })
await mkdir(privateReport)
const output = 'docs/evidence/P6E-repository-secret-scan.json'
const names = (
  await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    maxBuffer: 8 << 20,
  })
).stdout
  .split('\0')
  .filter(Boolean)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const inputs = []
for (const name of [...new Set(names)].sort()) {
  if (name === output) continue // Avoid including a previous self-referential result.
  assert.ok(!/^(?:\.git|\.cache|node_modules|admin\/node_modules)(?:\/|$)/.test(name))
  const source = path.resolve(root, name)
  assert.ok(source.startsWith(root + path.sep))
  const stat = await lstat(source)
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Only regular source files can be staged')
  const destination = path.join(staged, name)
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  const digest = hash(await readFile(destination))
  assert.equal(hash(await readFile(source)), digest, 'A source file changed during copying')
  inputs.push({ path: name, sha256: digest, bytes: stat.size })
}
assert.ok(inputs.length > 0)
let scanExit = 0
try {
  await run(
    'docker',
    [
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      '10001:10001',
      '--tmpfs',
      '/tmp:size=32m,mode=1777',
      '--mount',
      `type=bind,src=${staged},dst=/source,readonly`,
      '--mount',
      `type=bind,src=${privateReport},dst=/report`,
      imageId,
      'dir',
      '/source',
      '--no-banner',
      '--redact',
      '--log-level',
      'warn',
      '--report-format',
      'json',
      '--report-path',
      '/report/findings.json',
    ],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 4 << 20 },
  )
} catch (error) {
  scanExit = error.code
}
const raw = JSON.parse(await readFile(path.join(privateReport, 'findings.json'), 'utf8'))
for (const input of inputs)
  assert.equal(
    hash(await readFile(path.join(root, input.path))),
    input.sha256,
    'Source changed during scan; rerun after writers stop',
  )
// The generic rule interprets one public, locally built Docker image tag as an
// API credential. Preserve the scanner's nonzero result and every finding.
// Review only this exact value by reconstructing each redacted match from the
// source line; no rule, file or directory is excluded from scanning.
const imageRepository = 'xiaowork-homepage-api'
const candidateTag = 'p6e-diagnostics-aa23376'
const knownImageTag = [imageRepository, candidateTag].join(':')
const reviewed = []
for (const finding of raw) {
  const name = finding.File.replace(/^\/source\//, '')
  const input = inputs.find((value) => value.path === name)
  let knownTagOnly = false
  if (input && finding.RuleID === 'generic-api-key' && finding.StartLine === finding.EndLine) {
    const line = (await readFile(path.join(root, name), 'utf8')).split(/\r?\n/)[
      finding.StartLine - 1
    ]
    knownTagOnly =
      finding.Secret === 'REDACTED' &&
      line.includes(knownImageTag) &&
      finding.Match.startsWith(imageRepository + ':REDACTED') &&
      line
        .replaceAll(knownImageTag, imageRepository + ':REDACTED')
        .includes(finding.Match.trimEnd())
  }
  reviewed.push({
    file: name,
    line: finding.StartLine,
    disposition: knownTagOnly ? 'EXACT_LOCAL_IMAGE_TAG_FALSE_POSITIVE' : 'UNREVIEWED',
  })
}
const reviewedImageTagsOnly =
  scanExit === 1 &&
  raw.length > 0 &&
  reviewed.every((value) => value.disposition === 'EXACT_LOCAL_IMAGE_TAG_FALSE_POSITIVE')
const report = {
  date: created.toISOString(),
  sourceRevision: await cli('git', ['rev-parse', 'HEAD']),
  scope: 'git ls-files --cached --others --exclude-standard -z; regular files only',
  exclusions: ['Ignored caches/dependencies/backups are never staged', output],
  files: inputs.length,
  bytes: inputs.reduce((sum, input) => sum + input.bytes, 0),
  inputManifestSha256: hash(JSON.stringify(inputs)),
  scanner: { image, imageId, version: '8.28.0' },
  isolation: { network: 'none', user: '10001:10001', readOnlySource: true, readOnlyRootfs: true },
  scanExit,
  findings: raw.map((value) => ({
    rule: value.RuleID,
    file: value.File.replace(/^\/source\//, ''),
    startLine: value.StartLine,
    endLine: value.EndLine,
  })),
  review: {
    candidateTagComponent: candidateTag,
    method:
      'Each redacted scanner match is reconstructed from the exact public local image tag in its source line; no blanket rule/path allowlist or scanner suppression.',
    findings: reviewed,
  },
  result:
    scanExit === 0 && raw.length === 0
      ? 'NO_KNOWN_SECRETS_FOUND'
      : reviewedImageTagsOnly
        ? 'REVIEWED_IMAGE_TAG_FALSE_POSITIVES'
        : 'REVIEW_REQUIRED',
  limitations: [
    'Pattern scan is not a guarantee that unknown secrets do not exist.',
    'Uncommitted inputs are captured by a deterministic file/hash manifest; this is not a claim of a clean Git tree.',
  ],
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
if (report.result === 'REVIEW_REQUIRED') process.exitCode = 1
console.log(`${report.result}: ${inputs.length} files; no matched secret values printed`)
