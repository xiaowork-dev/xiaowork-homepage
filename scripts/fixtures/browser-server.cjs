// Local E2E sidecar only. No Docker socket, credentials, database or uploads.
const { chromium } = require('/test-deps/playwright-core')
const { execFileSync } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const store = '/tmp/p6c-home/.pki/nssdb'
mkdirSync(store, { recursive: true })
execFileSync('certutil', ['-N', '--empty-password', '-d', 'sql:' + store])
if (process.argv[2] === 'trusted') {
  execFileSync('certutil', [
    '-A',
    '-d',
    'sql:' + store,
    '-n',
    'P6C isolated CA',
    '-t',
    'C,,',
    '-i',
    '/ca.crt',
  ])
}
chromium
  .launchServer({ headless: true, port: 9323, host: '0.0.0.0' })
  .then((server) => {
    console.log(server.wsEndpoint())
  })
  .catch(() => {
    console.error('Isolated browser startup failed')
    process.exit(1)
  })
