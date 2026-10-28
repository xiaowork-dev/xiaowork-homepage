// Test-only overlays, strictly separate from the six final runtime images.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const manifest = JSON.parse(readFileSync('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'))
const cli = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
assert.equal(
  cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
for (const role of ['api', 'worker'])
  assert.equal(
    cli('image', 'inspect', '--format', '{{.Id}}', manifest.images[role].tag),
    manifest.images[role].id,
  )
const results = []
for (const [target, tag] of [
  ['api-test', 'xiaowork-homepage-api:p6e-closure-fault'],
  ['worker-test', 'xiaowork-homepage-worker:p6e-closure-fault'],
  ['data-test', 'xiaowork-homepage-fault-data:p6e-closure-test'],
]) {
  const args = [
    'build',
    '--build-arg',
    `P6E_API_BASE=${manifest.images.api.tag}`,
    '--build-arg',
    `P6E_WORKER_BASE=${manifest.images.worker.tag}`,
    '--target',
    target,
    '-t',
    tag,
    '-f',
    path.join(manifest.sourceExport, 'scripts/fixtures/p6e-fault-worker.Dockerfile'),
    manifest.sourceExport,
  ]
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 8 << 20,
  })
  writeFileSync(
    `docs/evidence/P6E-final-fixture-${target}.txt`,
    (result.stdout ?? '') + (result.stderr ?? ''),
  )
  assert.equal(result.status, 0, 'Test-only fixture failed; see preserved log')
  results.push({
    target,
    tag,
    id: cli('image', 'inspect', '--format', '{{.Id}}', tag),
    source: manifest.source,
    finalRuntime: false,
  })
  console.log('BUILT TEST ONLY ' + target)
}
writeFileSync(
  'docs/evidence/P6E-final-test-fixtures.json',
  JSON.stringify({ source: manifest.source, results }, null, 2) + '\n',
)
