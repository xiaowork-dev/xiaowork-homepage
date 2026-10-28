// Test-only Docker PTY and trust helpers. No credential is accepted from argv,
// environment, a file or a pipe. Only the named local E2E project is allowed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { X509Certificate, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

export const project = 'xiaowork-homepage-v11-p6e-e2e'
export const origin = 'https://localhost:3447'
export const cache = path.resolve('.cache/p6e-browser')
const cli = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim()
export function compose(...args) {
  return cli(
    'compose',
    '--profile',
    'publisher',
    '-p',
    project,
    '-f',
    'compose.admin-publish.yaml',
    '-f',
    path.join(cache, 'compose.override.yaml'),
    ...args,
  )
}

export async function prepareEnvironment() {
  assert.equal(
    cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'),
    'npipe:////./pipe/dockerDesktopLinuxEngine',
    'Only local Docker Desktop is permitted',
  )
  const source = cli(
    'image',
    'inspect',
    '--format',
    '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    'xiaowork-homepage-worker:p6d-dev',
  )
  const builder = cli('image', 'inspect', '--format', '{{.Id}}', 'xiaowork-homepage-worker:p6d-dev')
  assert.match(source, /^[a-f0-9]{40}$/)
  assert.match(builder, /^sha256:[a-f0-9]{64}$/)
  process.env.V11_SOURCE_REVISION = source
  process.env.V11_BUILDER_ID = builder
  process.env.V11_LOCAL_PUBLISH = '1'
  await mkdir(cache, { recursive: true })
  const nginx = await readFile('deploy/admin-publish/nginx.conf', 'utf8')
  assert.ok(nginx.includes('listen 3445 ssl;'))
  await writeFile(
    path.join(cache, 'nginx.conf'),
    nginx.replace('listen 3445 ssl;', 'listen 3447 ssl;'),
  )
  await writeFile(
    path.join(cache, 'compose.override.yaml'),
    `services:
  api-init:
    environment:
      XIAOWORK_ORIGIN: https://localhost:3447
      XIAOWORK_TRUSTED_PROXY_CIDRS: 192.168.246.2/32
    networks:
      control:
        ipv4_address: 192.168.246.4
  api:
    environment:
      XIAOWORK_ORIGIN: https://localhost:3447
      XIAOWORK_TRUSTED_PROXY_CIDRS: 192.168.246.2/32
    networks:
      control:
        ipv4_address: 192.168.246.3
  publication-static:
    networks:
      control:
        ipv4_address: 192.168.246.5
  gateway:
    ports: !override
      - '127.0.0.1:3214:8080'
      - '127.0.0.1:3447:3447'
      - '127.0.0.1:9325:9323'
    volumes:
      - ${path.join(cache, 'nginx.conf').replaceAll('\\', '/')}:/etc/nginx/nginx.conf:ro
    networks:
      control:
        ipv4_address: 192.168.246.2
networks:
  control:
    ipam:
      config: !override
        - subnet: 192.168.246.0/28
`,
  )
  compose('config', '--quiet')
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
  const init = compose('ps', '-a', '-q', 'api-init')
  assert.match(init, /^[a-f0-9]{12,64}$/)
  const caPath = path.join(cache, 'ca.crt')
  cli('cp', `${init}:/authority/ca.crt`, caPath)
  const cert = new X509Certificate(await readFile(caPath))
  assert.equal(cert.ca, true)
  assert.match(cert.subject, /XiaoWork/)
  assert.ok(Date.parse(cert.validTo) > Date.now())
  return { caPath, thumbprint: cert.fingerprint.replaceAll(':', '') }
}

const browserName = `${project}-browser`
export function stopBrowserContainer() {
  try {
    const label = cli(
      'inspect',
      '--format',
      '{{index .Config.Labels "xiaowork.test-project"}}',
      browserName,
    )
    assert.equal(label, project)
    cli('rm', '-f', browserName)
  } catch (error) {
    if (!/no such/i.test(String(error))) throw error
  }
}
export async function startBrowserContainer(caPath, trusted) {
  const gateway = compose('ps', '-q', 'gateway')
  assert.match(gateway, /^[a-f0-9]{12,64}$/)
  cli(
    'run',
    '-d',
    '--name',
    browserName,
    '--label',
    `xiaowork.test-project=${project}`,
    '--network',
    `container:${gateway}`,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--shm-size',
    '256m',
    '--tmpfs',
    '/tmp:size=512m,mode=1777',
    '-e',
    'HOME=/tmp/p6c-home',
    '--mount',
    `type=bind,src=${caPath},dst=/ca.crt,readonly`,
    '--mount',
    `type=bind,src=${path.resolve('admin/node_modules')},dst=/test-deps,readonly`,
    '--mount',
    `type=bind,src=${path.resolve('scripts/fixtures/browser-server.cjs')},dst=/browser-server.cjs,readonly`,
    'xiaowork-homepage-browser:p6c-test',
    trusted ? 'trusted' : 'untrusted',
  )
  for (let attempt = 0; attempt < 60; attempt++) {
    const logs = cli('logs', browserName)
    const endpoint = logs.match(/ws:\/\/[^\s]+:(9323)\/[^\s]+/)
    if (endpoint)
      return endpoint[0].replace(/ws:\/\/[^:]+:/, 'ws://127.0.0.1:').replace(':9323/', ':9325/')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Isolated browser server did not become ready')
}

export async function initializeTestAdministrator() {
  const password = 'P6E-' + randomBytes(24).toString('base64url')
  const username = 'local-p6e-test'
  const container = compose('ps', '-q', 'api')
  assert.match(container, /^[a-f0-9]{12,64}$/)
  assert.equal(
    cli('inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', container),
    project,
  )
  const socketPath = '\\\\.\\pipe\\dockerDesktopLinuxEngine'
  const version = cli('version', '--format', '{{.Server.APIVersion}}')
  const call = (endpoint, method, payload) =>
    new Promise((resolve, reject) => {
      const data = payload ? JSON.stringify(payload) : ''
      const req = http.request(
        {
          socketPath,
          path: `/v${version}${endpoint}`,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c) => {
            body += c
          })
          res.on('end', () => {
            try {
              assert.ok(res.statusCode < 300)
              resolve(JSON.parse(body))
            } catch {
              reject(new Error('Local Docker fixture failed'))
            }
          })
        },
      )
      req.on('error', reject)
      req.end(data)
    })
  async function tty(command) {
    const created = await call(`/containers/${container}/exec`, 'POST', {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: ['/homepage-api', command],
    })
    let noAccount = false
    let alreadyExists = false
    let completed = false
    await new Promise((resolve, reject) => {
      const data = JSON.stringify({ Detach: false, Tty: true })
      const req = http.request({
        socketPath,
        path: `/v${version}/exec/${created.Id}/start`,
        method: 'POST',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'tcp',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      })
      let stage = 0
      let output = ''
      const timer = setTimeout(() => {
        req.destroy()
        reject(new Error('Local administrator TTY timed out'))
      }, 15000)
      req.on('upgrade', (_res, stream, head) => {
        const consume = (chunk) => {
          output += chunk.toString('utf8')
          if (output.includes('administrator already exists')) {
            alreadyExists = true
            stream.end()
          }
          if (output.includes('initialize the administrator first')) {
            noAccount = true
            stream.end()
          }
          if (stage === 0 && output.includes('Administrator username:')) {
            output = ''
            stream.write(username + '\n')
          } else if (stage === 0 && output.includes('New password (')) {
            stage = 1
            output = ''
            stream.write(password + '\n')
          } else if (stage === 1 && output.includes('Confirm new password (')) {
            stage = 2
            output = ''
            stream.write(password + '\n')
          } else if (stage === 2 && output.includes('Administrator operation completed')) {
            completed = true
            stream.end()
          }
        }
        if (head.length) consume(head)
        stream.on('data', consume)
        stream.on('error', reject)
        stream.on('end', () => {
          clearTimeout(timer)
          resolve()
        })
        stream.on('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      req.on('response', () => {
        clearTimeout(timer)
        reject(new Error('A genuine Docker PTY is required'))
      })
      req.on('error', reject)
      req.end(data)
    })
    const result = await call(`/exec/${created.Id}/json`, 'GET')
    if (completed) assert.equal(result.ExitCode, 0)
    return { completed, noAccount, alreadyExists }
  }
  const initial = await tty('init-admin')
  if (initial.alreadyExists) assert.equal((await tty('reset-admin')).completed, true)
  else assert.equal(initial.completed, true)
  compose('exec', '-T', 'api', '/homepage-api', 'import-v1')
  return { username, password }
}

export function expireSession(tokenDigest) {
  assert.match(tokenDigest, /^[a-f0-9]{64}$/)
  const volume = `${project}_admin-db`
  assert.equal(
    cli('volume', 'inspect', '--format', '{{index .Labels "com.docker.compose.project"}}', volume),
    project,
  )
  const output = cli(
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '10001:10001',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    `type=volume,src=${volume},dst=/data`,
    'xiaowork-homepage-session-fixture:p6c-test',
    tokenDigest,
  )
  assert.equal(output, 'EXPIRED_ONE_ISOLATED_TEST_SESSION')
}

export function recreateEnvironment() {
  compose(
    'up',
    '-d',
    '--no-build',
    '--force-recreate',
    '--wait',
    '--wait-timeout',
    '120',
    'api',
    'worker',
    'publication-static',
    'gateway',
  )
}
