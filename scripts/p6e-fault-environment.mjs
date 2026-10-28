// Test-only Docker PTY and trust helpers. No credential is accepted from argv,
// environment, a file or a pipe. Only the named local E2E project is allowed.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { X509Certificate, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

export const project = 'xiaowork-homepage-v11-p6e-fault'
export const origin = 'https://localhost:3446'
export const cache = path.resolve('.cache/p6e-fault')
export const testApiImage = (() => {
  if (!process.argv.includes('--postfix-api')) return 'xiaowork-homepage-api:p6e-fault'
  assert.equal(process.argv[2], 'recovery-fails')
  const candidate = process.env.P6E_TEST_POSTFIX_API_IMAGE
  assert.match(candidate ?? '', /^xiaowork-homepage-api:p6e-diagnostics-[a-f0-9]{7}$/)
  return candidate
})()
export const cli = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 180000 }).trim()
export function compose(...args) {
  return cli(
    'compose',
    '--profile',
    'publisher',
    '-p',
    project,
    '--project-directory',
    process.cwd(),
    '-f',
    path.join(cache, 'compose.base.yaml'),
    '-f',
    path.join(cache, 'compose.override.yaml'),
    ...args,
  )
}

export async function configureWorker(
  mode = 'none',
  variant = 'normal',
  unavailableVerifier = false,
) {
  assert.ok(
    [
      'none',
      'before-current-rename',
      'after-current-rename',
      'after-receipt',
      'before-result-http',
    ].includes(mode),
  )
  assert.ok(['normal', 'compile-error', 'timeout'].includes(variant))
  const source = process.env.V11_SOURCE_REVISION
  const builder = process.env.V11_BUILDER_ID
  let mounts = ''
  if (variant === 'compile-error')
    mounts = `    volumes:\n      - ./scripts/fixtures/p6e-invalid-page.txt:/builder/app/pages/index.vue:ro\n`
  if (variant === 'timeout')
    mounts = `    volumes:\n      - ./.cache/p6e-fault/timeout-nuxt.config.ts:/builder/nuxt.config.ts:ro\n`
  await writeFile(
    path.join(cache, 'compose.override.yaml'),
    `services:
  api:
    image: ${testApiImage}
${unavailableVerifier ? '    environment:\n      XIAOWORK_PUBLICATION_VERIFY_URL: http://publication-static:8099\n' : ''}  worker:
    image: xiaowork-homepage-worker:p6e-fault
    command: !override ["-test-mode", "${mode}", "-source-revision", "${source}", "-builder-id", "${builder}"]
${mounts}  gateway:
    volumes:
      - ./.cache/p6e-fault/nginx.conf:/etc/nginx/nginx.conf:ro
    ports: !override
      - '127.0.0.1:3213:8080'
      - '127.0.0.1:3446:3446'
      - '127.0.0.1:9324:9323'
`,
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
  const builder = cli(
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    'xiaowork-homepage-worker:p6e-fault',
  )
  assert.match(source, /^[a-f0-9]{40}$/)
  assert.match(builder, /^sha256:[a-f0-9]{64}$/)
  process.env.V11_SOURCE_REVISION = source
  process.env.V11_BUILDER_ID = builder
  process.env.V11_LOCAL_PUBLISH = '1'
  await mkdir(cache, { recursive: true })
  const base = (await readFile('compose.admin-publish.yaml', 'utf8'))
    .replaceAll('192.168.249.', '192.168.248.')
    .replaceAll('https://localhost:3445', origin)
  await writeFile(path.join(cache, 'compose.base.yaml'), base)
  await writeFile(
    path.join(cache, 'nginx.conf'),
    (await readFile('deploy/admin-publish/nginx.conf', 'utf8')).replaceAll('3445', '3446'),
  )
  const nuxt = await readFile('nuxt.config.ts', 'utf8')
  await writeFile(
    path.join(cache, 'timeout-nuxt.config.ts'),
    nuxt.replace(
      '  hooks: {',
      "  hooks: {\n    async 'build:before'() { console.log('P6E_REAL_NUXT_TIMEOUT_HOOK'); await new Promise(resolve => setTimeout(resolve, 11 * 60 * 1000)) },",
    ),
  )
  await configureWorker()
  compose('config', '--quiet')
  // API recreation closes its UDS. Bring it healthy before starting the
  // fail-closed Worker so setup is not itself an unintended outage test.
  compose(
    'up',
    '-d',
    '--no-build',
    '--wait',
    '--wait-timeout',
    '120',
    'api',
    'frontend',
    'publication-static',
    'gateway',
  )
  compose(
    'up',
    '-d',
    '--no-build',
    '--no-deps',
    '--force-recreate',
    '--wait',
    '--wait-timeout',
    '120',
    'worker',
  )
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
    if (!String(error).includes('No such')) throw error
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
    if (endpoint) return endpoint[0].replace(/ws:\/\/[^:]+:9323\//, 'ws://127.0.0.1:9324/')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Isolated browser server did not become ready')
}

export async function initializeTestAdministrator() {
  const password = 'P6E-' + randomBytes(24).toString('base64url')
  const username = 'local-p6e-fault'
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
