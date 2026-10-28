// Local operator health verification. No credentials, arbitrary origin or URL
// from managed content is accepted. Authenticated browser acceptance is separate.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'

export async function verifyLocalRelease(plan) {
  const evidence = []
  for (const port of [plan.httpPort, plan.httpsPort])
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535)
  const source = `http://127.0.0.1:${plan.httpPort}`
  const origin = plan.topology === 'simulation' ? `https://localhost:${plan.httpsPort}` : source
  const ca = plan.topology === 'simulation' ? fs.readFileSync(plan.caFile) : undefined
  async function read(route, authenticatedTransport = false, expected = 200) {
    assert.match(route, /^\/(?!\/)/)
    assert.ok(!route.includes('..') && !route.includes('\\') && !route.includes('?'))
    const url = new URL(route, authenticatedTransport ? origin : source)
    const response = await new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).get(
        url,
        {
          ca,
          rejectUnauthorized: true,
          headers: {
            Host:
              authenticatedTransport && plan.topology === 'simulation'
                ? `localhost:${plan.httpsPort}`
                : 'xiaoworks.com',
            Connection: 'close',
            'Cache-Control': 'no-cache',
          },
        },
        (res) => {
          const chunks = []
          let bytes = 0
          res.on('data', (chunk) => {
            bytes += chunk.length
            if (bytes > 16 * 1024 * 1024)
              req.destroy(new Error('HTTP response exceeds release budget'))
            else chunks.push(chunk)
          })
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }),
          )
          res.on('error', reject)
        },
      )
      req.setTimeout(10000, () => req.destroy(new Error('Local release probe timeout')))
      req.on('error', reject)
    })
    assert.equal(response.status, expected, `Unexpected release HTTP status for ${route}`)
    evidence.push({
      route,
      status: response.status,
      bytes: response.raw.length,
      sha256: createHash('sha256').update(response.raw).digest('hex'),
    })
    return response
  }
  for (const route of ['/', '/projects/', '/about/', '/health.json', '/robots.txt', '/sitemap.xml'])
    await read(route)
  const admin = await read('/admin/')
  assert.match(admin.headers['cache-control'] ?? '', /no-store/)
  assert.match(admin.headers['x-robots-tag'] ?? '', /noindex/)
  const assets = [
    ...new Set(
      [
        ...admin.raw
          .toString('utf8')
          .matchAll(/(?:src|href)="(\/admin\/(?:assets\/[^"?#]+|theme-init\.js))"/g),
      ].map((m) => m[1]),
    ),
  ]
  assert.ok(
    assets.some((route) => route.endsWith('.js')) && assets.some((route) => route.endsWith('.css')),
    'Admin shell must reference real JS and CSS',
  )
  for (const route of assets) await read(route)
  const session = await read('/api/admin/v1/auth/session', true, 401)
  assert.match(session.headers['cache-control'] ?? '', /no-store/)
  assert.ok(
    JSON.parse(session.raw).error?.code,
    'Unauthenticated management response must be an API error, not SPA HTML',
  )
  const challenge = await read('/api/admin/v1/auth/login-challenge', true)
  assert.ok(JSON.parse(challenge.raw).data?.loginNonce)
  const cookie = (challenge.headers['set-cookie'] ?? []).find((value) =>
    value.startsWith('__Host-xiaowork-login='),
  )
  assert.ok(
    cookie &&
      /; Secure(?:;|$)/i.test(cookie) &&
      /; HttpOnly(?:;|$)/i.test(cookie) &&
      /; SameSite=Strict(?:;|$)/i.test(cookie),
    'Login challenge must retain secure Cookie boundaries',
  )
  if (plan.artifact) {
    assert.equal(plan.artifact.schemaVersion, 1)
    assert.ok(Array.isArray(plan.artifact.files) && plan.artifact.files.length > 0)
    for (const file of plan.artifact.files) {
      assert.match(file.sha256, /^[a-f0-9]{64}$/)
      assert.ok(
        Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 16 * 1024 * 1024,
      )
      const response = await read('/' + file.path)
      assert.equal(response.raw.length, file.bytes, `Published size changed for ${file.path}`)
      assert.equal(evidence.at(-1).sha256, file.sha256, `Published hash changed for ${file.path}`)
    }
    const marker = JSON.parse((await read('/__xiaowork-release.json')).raw)
    assert.equal(marker.releaseId, plan.artifact.releaseId)
    assert.equal(marker.snapshotSha256, plan.artifact.snapshotSha256)
  }
  return evidence
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/v11-release-probe.mjs')) {
  verifyLocalRelease(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
    .then((evidence) => console.log(JSON.stringify(evidence)))
    .catch(() => {
      console.error('Local release HTTP/API/assets verification failed')
      process.exitCode = 1
    })
}
