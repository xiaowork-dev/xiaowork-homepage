import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { test } from 'node:test'
import { verifyLocalRelease } from './v11-release-probe.mjs'

const asset = Buffer.from('retained-public-image')
async function fixture(t, mode) {
  const server = http.createServer((req, res) => {
    if (req.url === '/admin/') {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Robots-Tag', 'noindex')
      res.end('<script src="/admin/assets/app.js"></script><link href="/admin/assets/app.css">')
    } else if (req.url === '/api/admin/v1/auth/session') {
      res.statusCode = mode === 'api-spa' ? 200 : 401
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }))
    } else if (req.url === '/api/admin/v1/auth/login-challenge') {
      res.setHeader(
        'Set-Cookie',
        '__Host-xiaowork-login=test; Path=/; Secure; HttpOnly; SameSite=Strict',
      )
      res.end(JSON.stringify({ data: { loginNonce: 'test-only-nonce' } }))
    } else if (req.url === '/__xiaowork-release.json') {
      res.end(
        JSON.stringify({ releaseId: 'rel_' + 'a'.repeat(32), snapshotSha256: 'b'.repeat(64) }),
      )
    } else if (req.url === '/_content/image.png')
      res.end(mode === 'bad-image' ? 'corrupted' : asset)
    else res.end('local-test-response')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return {
    topology: 'openresty',
    httpPort: server.address().port,
    httpsPort: 3449,
    artifact: {
      schemaVersion: 1,
      releaseId: 'rel_' + 'a'.repeat(32),
      snapshotSha256: 'b'.repeat(64),
      files: [
        {
          path: '_content/image.png',
          sha256: createHash('sha256').update(asset).digest('hex'),
          bytes: asset.length,
        },
      ],
    },
  }
}
test('lifecycle probe verifies real admin assets, API denial and retained artifact bytes', async (t) => {
  const evidence = await verifyLocalRelease(await fixture(t))
  assert.ok(evidence.some((p) => p.route === '/_content/image.png'))
  assert.ok(evidence.some((p) => p.route === '/api/admin/v1/auth/session' && p.status === 401))
})
test('lifecycle probe refuses corrupted published image despite HTTP 200', async (t) => {
  await assert.rejects(verifyLocalRelease(await fixture(t, 'bad-image')), /Published size changed/)
})
test('lifecycle probe refuses management fallback HTML or success for anonymous session', async (t) => {
  await assert.rejects(
    verifyLocalRelease(await fixture(t, 'api-spa')),
    /Unexpected release HTTP status/,
  )
})
