// Read/render only. Does not create a container, network, volume or host state.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const spec = JSON.parse(readFileSync('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'))
const cli = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
assert.equal(
  cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
  'npipe:////./pipe/dockerDesktopLinuxEngine',
)
const root = spec.sourceExport
const cache = path.resolve('.cache/p6e-final-preflight')
mkdirSync(cache, { recursive: true })
const env = {
  XIAOWORK_ORIGIN: 'https://xiaoworks.com',
  XIAOWORK_LOCAL_PUBLISH: '0',
  XIAOWORK_SOURCE_REVISION: spec.source,
  XIAOWORK_BUILDER_ID: spec.images.worker.id,
}
const services = {}
for (const [service, role] of Object.entries({
  'api-init': 'api',
  api: 'api',
  'publication-init': 'worker',
  worker: 'worker',
  gateway: 'gateway',
  frontend: 'frontend',
  'publication-static': 'static',
}))
  services[service] = { image: spec.images[role].id }
services['api-init'].environment = env
services['api-init'].command = ['migrate']
services.api.environment = env
services.gateway.volumes = [
  `${root.replaceAll('\\', '/')}/deploy/v11/gateway-openresty.conf:/etc/nginx/nginx.conf:ro`,
  `${root.replaceAll('\\', '/')}/deploy/v11/locations-openresty.conf:/etc/nginx/xiaowork-locations.conf:ro`,
]
const override = path.join(cache, 'openresty-plan.yaml')
const ports = path.join(cache, 'loopback-plan.yaml')
writeFileSync(override, JSON.stringify({ services }))
writeFileSync(
  ports,
  "services:\n  gateway:\n    ports: !override\n      - '127.0.0.1:13210:8080'\n",
)
const args = [
  'compose',
  '--project-directory',
  root,
  '-p',
  'xiaowork-homepage-v11-closure-plan',
  '-f',
  path.join(root, 'compose.admin-publish.yaml'),
  '-f',
  override,
  '-f',
  ports,
  '--profile',
  'publisher',
  'config',
  '--format',
  'json',
]
const config = JSON.parse(
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      V11_SOURCE_REVISION: spec.source,
      V11_BUILDER_ID: spec.images.worker.id,
      V11_LOCAL_PUBLISH: '0',
    },
  }),
)
const checks = []
const check = (name, condition) => {
  assert.ok(condition, name)
  checks.push({ name, result: 'PASS' })
}
check(
  'Only localhost illustrative gateway port; production port not allocated',
  Object.entries(config.services).every(([name, s]) =>
    name === 'gateway'
      ? s.ports.length === 1 && s.ports[0].host_ip === '127.0.0.1'
      : !s.ports?.length,
  ),
)
check(
  'Official origin fixed and publish gate closed',
  config.services.api.environment.XIAOWORK_ORIGIN === 'https://xiaoworks.com' &&
    config.services.api.environment.XIAOWORK_LOCAL_PUBLISH === '0',
)
check(
  'Worker disabled by default and networkless',
  config.services.worker.profiles.includes('publisher') &&
    config.services.worker.network_mode === 'none',
)
check(
  'Worker never sees DB/secrets/socket of Docker engine',
  config.services.worker.volumes.every((v) =>
    ['/uploads', '/publications', '/run/publishing'].includes(v.target),
  ),
)
check(
  'All configured runtime images are final exact IDs',
  Object.entries(services).every(([name, value]) => config.services[name].image === value.image),
)
check(
  'Container boundaries retained',
  Object.values(config.services).every(
    (s) =>
      s.read_only &&
      s.cap_drop.includes('ALL') &&
      s.security_opt.includes('no-new-privileges:true'),
  ),
)
const configurationFiles = [
  'deploy/v11/gateway-openresty.conf',
  'deploy/v11/locations-openresty.conf',
].map((file) => ({
  file,
  sha256: createHash('sha256')
    .update(readFileSync(path.join(root, file)))
    .digest('hex'),
}))
writeFileSync(
  'docs/evidence/P6E-final-production-preflight.json',
  JSON.stringify(
    {
      date: new Date().toISOString(),
      source: spec.source,
      schema: spec.schema,
      result: 'LOCAL_PLAN_RENDER_VERIFIED_ONLY',
      commands: [
        [
          'docker',
          ...args.map((a) =>
            a.replaceAll(root, '<frozen-source-export>').replaceAll(cache, '<local-plan-cache>'),
          ),
        ],
      ],
      checks,
      configurationFiles,
      limitations: [
        'No production connection or configuration change',
        '13210 is an illustrative loopback port, not a confirmed production allocation',
        'Real OpenResty, Cloudflare, DNS, certificates and Host/SNI origin protection require separate authorization and actual production preflight',
        'Production publishing remains hard-disabled; enabling it requires a reviewed change and separate authorization',
      ],
    },
    null,
    2,
  ) + '\n',
)
console.log('PASS local production plan rendering; no runtime or production mutation')
