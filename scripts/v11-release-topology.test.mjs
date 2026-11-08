import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { configuration, edgeSubnetFor, gatewayRealIpConfig } from './v11-release.mjs'

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

test('production publishing remains hard-disabled', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'v11-topology-'))
  assert.throws(
    () =>
      configuration(
        'xiaowork-homepage-v11-unit',
        spec,
        state,
        'openresty',
        3290,
        3291,
        '192.168.248.0/28',
        true,
      ),
    /Production publishing remains hard-disabled/,
  )
})
