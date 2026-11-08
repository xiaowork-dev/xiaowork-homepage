import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { publishControlArgs } from './v11-barrier.mjs'
import {
  assertFreshBackup,
  configuration,
  deployPublishFlag,
  edgeSubnetFor,
  gatewayRealIpConfig,
  lastBackupRecord,
  publishModeFor,
  secretStatusMount,
} from './v11-release.mjs'

const id = (c) => 'sha256:' + c.repeat(64)
const spec = {
  format: 1,
  source: 'a'.repeat(40),
  schema: 3,
  images: {
    api: id('1'),
    worker: id('2'),
    gateway: id('3'),
    frontend: id('4'),
    static: id('5'),
    maintenance: id('6'),
  },
}
const render = (topology) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'v11-topology-'))
  const config = configuration(
    'xiaowork-homepage-v11-unit',
    spec,
    state,
    topology,
    3290,
    3291,
    '192.168.248.0/28',
    false,
  )
  return { state, config, generated: JSON.parse(fs.readFileSync(config.files[1], 'utf8')) }
}

test('edge subnet is pinned beside, and never overlapping, the control subnet', () => {
  assert.equal(edgeSubnetFor('192.168.248.0/28'), '192.168.248.16/28')
  assert.throws(() => edgeSubnetFor('10.0.0.0/28'))
  assert.throws(() => edgeSubnetFor('192.168.248.16/28'))
})

test('realip snippet trusts only X-Real-IP from the pinned edge bridge', () => {
  const text = gatewayRealIpConfig('192.168.248.16/28')
  const directives = text.split('\n').filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(directives, [
    'set_real_ip_from 192.168.248.16/28;',
    'real_ip_header X-Real-IP;',
    'real_ip_recursive off;',
  ])
  assert.ok(!/X-Forwarded-For|0\.0\.0\.0|192\.168\.248\.0\/28/.test(text))
  assert.throws(() => gatewayRealIpConfig('0.0.0.0/0'))
  assert.throws(() => gatewayRealIpConfig('192.168.248.0/28'))
})

test('production topology pins edge, mounts the realip snippet and keeps API trust at the gateway only', () => {
  const { state, generated } = render('openresty')
  assert.deepEqual(generated.networks.edge, { ipam: { config: [{ subnet: '192.168.248.16/28' }] } })
  assert.deepEqual(generated.networks.control, {
    ipam: { config: [{ subnet: '192.168.248.0/28' }] },
  })
  const snippet = path.join(state, 'gateway-realip.generated.conf')
  assert.equal(fs.readFileSync(snippet, 'utf8'), gatewayRealIpConfig('192.168.248.16/28'))
  if (process.platform !== 'win32') assert.equal(fs.statSync(snippet).mode & 0o777, 0o644)
  assert.ok(
    generated.services.gateway.volumes.some((v) =>
      v.endsWith('gateway-realip.generated.conf:/etc/nginx/xiaowork-realip.conf:ro'),
    ),
  )
  assert.equal(generated.services.api.environment.XIAOWORK_TRUSTED_PROXY_CIDRS, '192.168.248.2/32')
  assert.equal(generated.services.api.environment.XIAOWORK_ORIGIN, 'https://xiaoworks.com')
  assert.equal(generated.services.api.environment.XIAOWORK_LOCAL_PUBLISH, '0')
})

test('simulation topology is unchanged by the production realip configuration', () => {
  const { state, generated } = render('simulation')
  assert.equal(generated.networks.edge, undefined)
  assert.equal(generated.services.gateway.volumes, undefined)
  assert.ok(!fs.existsSync(path.join(state, 'gateway-realip.generated.conf')))
})

test('gateway production config includes the snippet and forwards only the restored address', () => {
  const conf = fs.readFileSync(path.resolve('deploy/v11/gateway-openresty.conf'), 'utf8')
  const server = conf.slice(conf.indexOf('server_name xiaoworks.com'))
  assert.match(server, /include \/etc\/nginx\/xiaowork-realip\.conf;/)
  assert.ok(server.indexOf('xiaowork-realip.conf') < server.indexOf('location'))
  const forwarded = [...server.matchAll(/proxy_set_header X-Forwarded-For ([^;]+);/g)].map(
    (m) => m[1],
  )
  assert.ok(forwarded.length >= 2 && forwarded.every((v) => v === '$remote_addr'))
  assert.ok(!/real_ip_header X-Forwarded-For|set_real_ip_from 0\.0\.0\.0/.test(conf))
})

test('deploy can never enable openresty publishing; only the authorization path can', () => {
  assert.equal(deployPublishFlag('simulation', '1'), true)
  assert.equal(deployPublishFlag('openresty', undefined), false)
  assert.equal(deployPublishFlag('openresty', '0'), false)
  assert.throws(() => deployPublishFlag('openresty', '1'), /authorize-publishing/)
  assert.throws(() => deployPublishFlag('simulation', 'yes'))
  assert.equal(publishModeFor('openresty', false), 'off')
  assert.equal(publishModeFor('openresty', true), 'production')
  assert.equal(publishModeFor('simulation', true), 'local')
})

test('production mode env names the project and never sets the local gate', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'v11-topology-'))
  const config = configuration(
    'xiaowork-homepage-v11-unit',
    spec,
    state,
    'openresty',
    3290,
    3291,
    '192.168.248.0/28',
    true,
  )
  const generated = JSON.parse(fs.readFileSync(config.files[1], 'utf8'))
  const env = generated.services.api.environment
  assert.equal(env.XIAOWORK_PUBLISH_MODE, 'production')
  assert.equal(env.XIAOWORK_LOCAL_PUBLISH, '0')
  assert.equal(env.XIAOWORK_PROJECT, 'xiaowork-homepage-v11-unit')
  assert.equal(env.XIAOWORK_BUILDER_ID, spec.images.worker)
  assert.equal(generated.services['api-init'].environment.XIAOWORK_PUBLISH_MODE, 'off')
  assert.equal(config.env.V11_LOCAL_PUBLISH, '0')
  const off = JSON.parse(
    fs.readFileSync(
      configuration(
        'xiaowork-homepage-v11-unit',
        spec,
        state,
        'openresty',
        3290,
        3291,
        '192.168.248.0/28',
        false,
      ).files[1],
      'utf8',
    ),
  )
  assert.equal(off.services.api.environment.XIAOWORK_PUBLISH_MODE, 'off')
  const sim = JSON.parse(
    fs.readFileSync(
      configuration(
        'xiaowork-homepage-v11-unit',
        spec,
        state,
        'simulation',
        3290,
        3291,
        '192.168.248.0/28',
        true,
      ).files[1],
      'utf8',
    ),
  )
  assert.equal(sim.services.api.environment.XIAOWORK_PUBLISH_MODE, 'local')
  assert.equal(sim.services.api.environment.XIAOWORK_LOCAL_PUBLISH, '1')
})

test('authorization requires a fresh backup of exactly the current release identity', () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const record = lastBackupRecord(
    '/srv/backups/unit',
    spec,
    '2026-11-08T02:00:00.000Z',
    'e'.repeat(64),
  )
  assertFreshBackup(record, spec, now)
  assert.throws(
    () => assertFreshBackup({ ...record, verifiedAt: '2026-11-07T11:00:00.000Z' }, spec, now),
    /24 hours/,
  )
  assert.throws(
    () => assertFreshBackup({ ...record, source: 'b'.repeat(40) }, spec, now),
    /another release/,
  )
  assert.throws(
    () => assertFreshBackup({ ...record, maintenance: id('9') }, spec, now),
    /another maintenance image/,
  )
  assert.throws(() => lastBackupRecord('relative', spec, record.verifiedAt, 'e'.repeat(64)))
})

test('publishing control runs the maintenance image offline with only validated flags', () => {
  const args = publishControlArgs(
    'xiaowork-homepage-v11-unit_admin-maintenance-control',
    id('6'),
    'authorize-publish',
    ['-project', 'xiaowork-homepage-v11-unit', '-days', '7', '-note', '验收通过，批准生产发布'],
  )
  for (const v of [
    '--network',
    'none',
    '--read-only',
    '--user',
    '10001:10001',
    'ALL',
    'no-new-privileges:true',
  ])
    assert.ok(args.includes(v), v)
  assert.ok(
    args.includes(
      'type=volume,src=xiaowork-homepage-v11-unit_admin-maintenance-control,dst=/control,volume-nocopy',
    ),
  )
  assert.equal(args.at(-1), 'authorize-publish')
  assert.throws(
    () => publishControlArgs('v', id('6'), 'authorize-publish', ['-root', '/etc']),
    /Unexpected/,
  )
  assert.throws(
    () => publishControlArgs('v', id('6'), 'authorize-publish', ['-days', '31']),
    /Invalid value/,
  )
  assert.throws(
    () =>
      publishControlArgs('v', id('6'), 'authorize-publish', [
        '-note',
        'line' + String.fromCharCode(10) + 'break',
      ]),
    /Invalid value/,
  )
  assert.throws(
    () => publishControlArgs('v', id('6'), 'authorize-publish', ['-days', '7', '-days', '8']),
    /Unexpected/,
  )
  assert.throws(() => publishControlArgs('v', id('6'), 'shell', []))
  assert.throws(() => publishControlArgs('v', 'latest', 'publish-status', []))
})

test('first-deployment secret check mounts the secrets volume read-only without populate', () => {
  const [flag, value] = secretStatusMount('xiaowork-homepage-v11-unit')
  assert.equal(flag, '--mount')
  const parts = value.split(',')
  assert.ok(parts.includes('type=volume'))
  assert.ok(parts.includes('src=xiaowork-homepage-v11-unit_admin-secrets'))
  assert.ok(parts.includes('dst=/source/secrets'))
  assert.ok(parts.includes('readonly'), 'must be read-only')
  assert.ok(parts.includes('volume-nocopy'), 'tool() refuses populate on original volumes')
  assert.throws(() => secretStatusMount('other'))
})
