// Scan exact Linux Go executables copied from local images. Temporary containers
// are created but never started, have no mounts, and are removed by exact ID.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const expectedSource = process.argv[2]
assert.match(expectedSource ?? '', /^[a-f0-9]{40}$/)
const cli = async (...args) =>
  (await run('docker', args, { encoding: 'utf8', timeout: 30000 })).stdout.trim()
assert.equal(
  await cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
const cache = path.resolve('.cache/p6e-go/binaries')
await mkdir(cache, { recursive: true })
const scanner = path.resolve('.cache/p6e-go/bin/govulncheck.exe')
const report = {
  date: new Date().toISOString(),
  expectedSource,
  scannerSource: 'golang.org/x/vuln@v1.9.0; see P6E-govuln-tool-source.json',
  scope: 'Exact Linux binaries from stopped local image-only containers; no mounts or credentials',
  binaries: [],
  limitations: ['Binary mode supplements source analysis; it is not a penetration test.'],
}
for (const [role, image, sourcePath] of [
  ['api', 'xiaowork-homepage-api:p6d-dev', '/homepage-api'],
  ['worker', 'xiaowork-homepage-worker:p6d-dev', '/homepage-worker'],
  ['maintenance', 'xiaowork-homepage-maintenance:p6e-final', '/homepage-maintenance'],
]) {
  const imageId = await cli('image', 'inspect', '--format', '{{.Id}}', image)
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
  assert.equal(
    await cli(
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
      imageId,
    ),
    expectedSource,
  )
  let container
  const destination = path.join(cache, role)
  try {
    container = await cli(
      'create',
      '--name',
      `xiaowork-homepage-p6e-audit-${role}`,
      '--label',
      'io.xiaowork.p6e.audit=1',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      imageId,
    )
    assert.match(container, /^[a-f0-9]{64}$/)
    await cli('cp', `${container}:${sourcePath}`, destination)
  } finally {
    if (container) await cli('rm', container)
  }
  let output
  let scannerExit = 0
  try {
    output = await run(scanner, ['-mode=binary', '-show=verbose', destination], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 4 << 20,
    })
  } catch (error) {
    output = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    scannerExit = error.code
    process.exitCode = 1
  }
  const file = `P6E-govuln-${role}-binary.txt`
  await writeFile(path.join('docs/evidence', file), output.stdout + output.stderr)
  report.binaries.push({ role, imageId, sourcePath, file, scannerExit })
  console.log(`Scanned exact ${role} Linux binary`)
}
report.result = 'SCANNED'
await writeFile('docs/evidence/P6E-binary-audit.json', JSON.stringify(report, null, 2) + '\n')
