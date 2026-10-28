// Build a new, exact-source six-role group. Never moves historical tags.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const source = process.argv[2]
assert.match(source ?? '', /^[a-f0-9]{40}$/)
const cli = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 1200000, maxBuffer: 16 << 20 })
assert.equal(
  cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').trim(),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
assert.equal(execFileSync('git', ['rev-parse', source], { encoding: 'utf8' }).trim(), source)
const root = path.resolve('.cache/p6e-final-source-' + source + '-' + Date.now())
assert.equal(
  existsSync(root),
  false,
  'Use a new immutable source export; do not reuse a modified export',
)
mkdirSync(root, { recursive: true })
const archive = root + '.tar'
execFileSync('git', ['archive', '--format=tar', '--output=' + archive, source])
execFileSync('tar', ['-xf', archive, '-C', root])
const report = {
  format: 1,
  source,
  schema: 3,
  date: new Date().toISOString(),
  sourceExport: root,
  archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
  buildParameters: {
    platform: 'linux/amd64',
    VCS_REF: source,
    NUXT_PUBLIC_SITE_URL: 'https://xiaoworks.com',
    BUILDER_ID: 'xiaowork-nuxt-p6d-v1',
    GOPROXY: 'https://goproxy.cn',
  },
  images: {},
  builds: [],
}
report.baseImages = ['node:24.22.1-alpine', 'golang:1.27.3-alpine', 'nginx:1.30.6-alpine'].map(
  (tag) => ({
    tag,
    identity: JSON.parse(
      cli(
        'image',
        'inspect',
        '--format',
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}}}',
        tag,
      ),
    ),
  }),
)
report.engine = cli('version', '--format', '{{.Server.Version}}').trim()
report.compose = cli('compose', 'version', '--short').trim()
const roles = {
  api: ['backend/Dockerfile', 'xiaowork-homepage-api'],
  worker: ['backend/worker.Dockerfile', 'xiaowork-homepage-worker'],
  gateway: ['admin/Dockerfile', 'xiaowork-homepage-admin-gateway'],
  frontend: ['Dockerfile', 'xiaowork-homepage'],
  static: ['deploy/admin-publish/static.Dockerfile', 'xiaowork-homepage-publication-static'],
  maintenance: ['backend/maintenance.Dockerfile', 'xiaowork-homepage-maintenance'],
}
for (const [role, [file, repository]] of Object.entries(roles)) {
  const tag = `${repository}:p6e-closure-${source.slice(0, 12)}`
  const args = [
    'build',
    '--platform=linux/amd64',
    '--build-arg',
    `VCS_REF=${source}`,
    '--build-arg',
    'NUXT_PUBLIC_SITE_URL=https://xiaoworks.com',
    '--build-arg',
    'BUILDER_ID=xiaowork-nuxt-p6d-v1',
    '--build-arg',
    'GOPROXY=https://goproxy.cn',
    '-t',
    tag,
    '-f',
    path.join(root, file),
    root,
  ]
  const start = new Date().toISOString()
  const built = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 1200000,
    maxBuffer: 16 << 20,
  })
  writeFileSync(
    `docs/evidence/P6E-final-build-${role}.txt`,
    ((built.stdout ?? '') + (built.stderr ?? '')).replaceAll(root, '<exact-source-export>'),
  )
  assert.equal(built.status, 0, `Build failed: ${role}; preserved build log`)
  const identity = JSON.parse(
    cli(
      'image',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"source":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"user":{{json .Config.User}},"os":{{json .Os}},"architecture":{{json .Architecture}}}',
      tag,
    ),
  )
  assert.equal(identity.source, source)
  assert.match(identity.id, /^sha256:[a-f0-9]{64}$/)
  report.images[role] = { tag, ...identity }
  report.builds.push({
    role,
    dockerfile: file,
    startedAt: start,
    finishedAt: new Date().toISOString(),
    args: args.map((v) => v.replaceAll(root, '<exact-source-export>')),
  })
  writeFileSync(
    'docs/evidence/P6E-final-runtime-manifest.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(`BUILT ${role} ${identity.id}`)
}
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), report.archiveSha256)
report.schemaVerification = JSON.parse(
  cli(
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    report.images.maintenance.id,
    'compatible',
    '-schema',
    String(report.schema),
  ),
)
writeFileSync(
  'docs/evidence/P6E-final-runtime-manifest.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log('FINAL_SIX_ROLE_GROUP_BUILT ' + source)
// Separate test executables layer on the exact final group; never include them
// in the six-role manifest, deploy descriptor or production Dockerfiles.
for (const [target, tag] of [
  ['api-test', 'xiaowork-homepage-api:p6e-closure-fault'],
  ['worker-test', 'xiaowork-homepage-worker:p6e-closure-fault'],
  ['data-test', 'xiaowork-homepage-fault-data:p6e-closure-test'],
]) {
  cli(
    'build',
    '--build-arg',
    `P6E_API_BASE=${report.images.api.tag}`,
    '--build-arg',
    `P6E_WORKER_BASE=${report.images.worker.tag}`,
    '--target',
    target,
    '-t',
    tag,
    '-f',
    path.join(root, 'scripts/fixtures/p6e-fault-worker.Dockerfile'),
    root,
  )
  console.log('TEST_ONLY_FIXTURE_BUILT ' + target)
}
