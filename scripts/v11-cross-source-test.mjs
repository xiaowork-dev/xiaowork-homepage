// Isolated real-Docker cross-source lifecycle acceptance. All failures are
// operator-only derivative images or an explicit host CLI test preload. No
// fixture is copied into a production API, Worker or maintenance image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  docker,
  inspectProject,
  localEngine,
  restoreProject,
  verifyBackup,
} from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-cross-source'
const origin = 'https://localhost:3459'
const cache = path.resolve('.cache/p6e-cross-source')
const state = path.resolve('.v11-deploy', project)
const evidence = path.resolve('docs/evidence/P6E-cross-source-final.json')
const report = {
  date: new Date().toISOString(),
  project,
  scope: 'Independent restored local test volumes only; no production access',
  schemaMigration: false,
  tlsVerificationDisabled: false,
  credentialsRecorded: false,
  cases: [],
  commands: [],
  fixtures: [],
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
let credentials, ca
const cookies = new Map()
function lifecycle(args, expected = 0, preload) {
  const command = [
    ...(preload ? ['--import', pathToFileURL(preload).href] : []),
    'scripts/v11-release.mjs',
    ...args,
  ]
  const entry = { command: ['node', ...command], expected }
  report.commands.push(entry)
  try {
    const out = execFileSync(process.execPath, command, {
      encoding: 'utf8',
      timeout: 600000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    entry.actual = 0
    assert.equal(expected, 0, 'Lifecycle command unexpectedly succeeded')
    return out
  } catch (error) {
    entry.actual = error.status ?? 1
    if (expected === 0) throw error
    assert.equal(error.status, expected)
    return String(error.stderr)
  }
}
function mark(name, detail) {
  report.cases.push({ name, result: 'PASS', detail })
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n')
  console.log('PASS ' + name)
}
function specFrom(value) {
  return {
    format: 1,
    source: value.source,
    schema: value.schema,
    images: Object.fromEntries(
      Object.entries(value.images).map(([key, image]) => [
        key,
        typeof image === 'string' ? image : image.id,
      ]),
    ),
  }
}
function compose(args) {
  const current = read(path.join(state, 'current.json'))
  return docker(
    [
      'compose',
      '-p',
      project,
      '-f',
      'compose.admin-publish.yaml',
      '-f',
      path.join(state, 'compose.generated.yaml'),
      '-f',
      path.join(state, 'ports.generated.yaml'),
      '--profile',
      'publisher',
      ...args,
    ],
    {
      env: {
        ...process.env,
        V11_SOURCE_REVISION: current.spec.source,
        V11_BUILDER_ID: current.spec.images.worker,
        V11_LOCAL_PUBLISH: '1',
      },
    },
  )
}
async function request(route, method = 'GET', body, extra = {}) {
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return await new Promise((resolve, reject) => {
    const req = https.request(
      new URL('/api/admin/v1' + route, origin),
      {
        method,
        ca,
        rejectUnauthorized: true,
        headers: {
          Origin: origin,
          Connection: 'close',
          Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
          ...extra,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (b) => chunks.push(b))
        res.on('end', () => {
          for (const value of res.headers['set-cookie'] ?? []) {
            const pair = value.split(';')[0]
            const at = pair.indexOf('=')
            cookies.set(pair.slice(0, at), pair.slice(at + 1))
          }
          const raw = Buffer.concat(chunks)
          resolve({
            status: res.statusCode,
            bytes: raw,
            json: String(res.headers['content-type']).includes('application/json')
              ? JSON.parse(raw)
              : undefined,
          })
        })
      },
    )
    req.setTimeout(30000, () => req.destroy(new Error('Local trusted HTTPS timeout')))
    req.on('error', reject)
    if (bytes) req.write(bytes)
    req.end()
  })
}
async function login() {
  const challenge = await request('/auth/login-challenge')
  assert.equal(challenge.status, 200)
  const result = await request('/auth/login', 'POST', credentials, {
    'X-CSRF-Token': challenge.json.data.loginNonce,
  })
  assert.equal(result.status, 200)
}
async function privateProof() {
  const draft = await request('/workspace')
  assert.equal(draft.status, 200)
  const list = await request('/media')
  assert.equal(list.status, 200)
  const media = list.json.data.items.filter(
    (item) => item.storageKind === 'upload' || item.contentUrl,
  )
  assert.ok(media.length > 0, 'Restored fixture must include an uploaded image')
  const files = []
  for (const item of media) {
    const response = await request('/media/' + item.id + '/content')
    assert.equal(response.status, 200)
    files.push({ id: item.id, bytes: response.bytes.length, sha256: hash(response.bytes) })
  }
  return { draft: draft.json.data, media: files }
}
async function publicProof() {
  const files = []
  for (const route of [
    '/',
    '/projects/',
    '/about/',
    '/__xiaowork-release.json',
    '/sitemap.xml',
    '/robots.txt',
  ]) {
    const response = await fetch('http://127.0.0.1:3226' + route, {
      headers: { Connection: 'close' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(response.status, 200)
    files.push({ route, sha256: hash(Buffer.from(await response.arrayBuffer())) })
  }
  return files
}
function candidateFixture(spec, name, role, transform) {
  const directory = path.join(cache, name)
  fs.mkdirSync(directory)
  const base = `xiaowork-homepage-v11-crosstest:base-${role}-${spec.source.slice(0, 12)}`
  const tag = `xiaowork-homepage-v11-crosstest:${name}-${spec.source.slice(0, 12)}`
  docker(['tag', spec.images[role], base])
  let instructions
  if (transform === 'missing-binary') instructions = 'RUN rm /usr/sbin/nginx\n'
  else if (transform === 'missing-admin') instructions = 'RUN rm -f /srv/admin/assets/*.js\n'
  else {
    let config = fs.readFileSync('deploy/admin-publish/static.conf', 'utf8')
    const location =
      transform === 'bad-public'
        ? 'location = / { return 503; }'
        : `location = ${transform} { return 200 'corrupt-image'; }`
    config = config.replace('    listen 8080;', '    listen 8080;\n    ' + location)
    fs.writeFileSync(path.join(directory, 'fault.conf'), config)
    fs.writeFileSync(
      path.join(directory, 'nginx'),
      '#!/bin/sh\nexec /usr/sbin/nginx.real -c /etc/nginx/cross-source-fault.conf -g "daemon off;"\n',
    )
    instructions =
      'RUN mv /usr/sbin/nginx /usr/sbin/nginx.real\nCOPY --chmod=755 nginx /usr/sbin/nginx\nCOPY --chmod=644 fault.conf /etc/nginx/cross-source-fault.conf\n'
  }
  fs.writeFileSync(
    path.join(directory, 'Dockerfile'),
    `FROM ${base}\nUSER 0:0\n${instructions}USER 10001:10001\nLABEL io.xiaowork.test-only="cross-source-${name}"\n`,
  )
  docker([
    'build',
    '--network',
    'none',
    '-f',
    path.join(directory, 'Dockerfile'),
    '-t',
    tag,
    directory,
  ])
  const id = docker(['image', 'inspect', '--format', '{{.Id}}', tag])
  const fixture = { ...spec, images: { ...spec.images, [role]: id } }
  const file = path.join(directory, 'release.json')
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n')
  report.fixtures.push({
    name,
    role,
    id,
    base: spec.images[role],
    source: spec.source,
    testOnly: true,
  })
  return file
}

try {
  localEngine()
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  const resumeGuard = process.argv.includes('--resume-guard')
  if (resumeGuard) {
    const previous = read(evidence)
    assert.equal(previous.result, 'FAIL')
    assert.equal(previous.cases.length, 9)
    assert.ok(previous.cases.every((item) => item.result === 'PASS'))
    report.cases = previous.cases
    report.commands = previous.commands
    report.fixtures = previous.fixtures
    report.resumedAfterHarnessFailure = 'P6E-cross-source-harness-import-before.json'
  }
  const resumePrepared = process.argv.includes('--resume-prepared') || resumeGuard
  assert.ok(
    !fs.existsSync(state) || resumePrepared,
    'A fresh independently named project is required; explicit prepared-baseline resume needs full identity checks',
  )
  const next = specFrom(read(path.resolve(process.argv[2])))
  const backup = path.resolve(process.argv[3] ?? '.cache/v11-backups/p6e-complete-1793181418107')
  const bundle = read(path.join(backup, 'bundle.json'))
  const prior = specFrom(bundle.runtime)
  assert.notEqual(
    prior.source,
    next.source,
    'A different image tag with the same source is not a cross-source upgrade',
  )
  assert.equal(prior.schema, 3)
  assert.equal(next.schema, prior.schema)
  report.previous = prior
  report.final = next
  report.sourceDiff = execFileSync(
    'git',
    [
      'diff',
      '--stat',
      prior.source,
      next.source,
      '--',
      'backend',
      'admin',
      'scripts/v11-release.mjs',
    ],
    { encoding: 'utf8' },
  ).trim()
  assert.ok(report.sourceDiff.length > 0)
  verifyBackup(prior.images.maintenance, backup)
  report.restored = resumePrepared
    ? verifyBackup(prior.images.maintenance, backup).state
    : restoreProject(project, prior.images.maintenance, backup)
  const priorFile = path.join(cache, 'prior-release.json')
  const nextFile = path.join(cache, 'final-release.json')
  fs.writeFileSync(priorFile, JSON.stringify(prior, null, 2) + '\n')
  fs.writeFileSync(nextFile, JSON.stringify(next, null, 2) + '\n')
  if (resumePrepared) {
    const existing = read(path.join(state, 'current.json'))
    assert.deepEqual(existing.spec, prior)
    assert.equal(existing.httpPort, 3226)
    assert.equal(existing.httpsPort, 3459)
    assert.equal(existing.subnet, '192.168.241.0/28')
    assert.equal(fs.existsSync(path.join(state, 'operation.lock')), false)
    assert.equal(fs.existsSync(path.join(state, 'recovery-required.json')), false)
    report.preparedBaselineResume = true
  } else
    lifecycle([
      'deploy',
      '--project',
      project,
      '--manifest',
      priorFile,
      '--restored',
      '1',
      '--http-port',
      '3226',
      '--https-port',
      '3459',
      '--subnet',
      '192.168.241.0/28',
      '--local-publish',
      '1',
    ])
  let helper = fs
    .readFileSync('scripts/publishing-browser-environment.mjs', 'utf8')
    .replaceAll('xiaowork-homepage-v11-p6d-e2e', project)
    .replaceAll('https://localhost:3445', origin)
    .replaceAll('.cache/p6d-browser', '.cache/p6e-cross-source')
    .replaceAll('local-p6d-test', 'local-p6e-recovery')
  helper = helper.replace(
    /export function compose\(\.\.\.args\) \{[\s\S]*?\n\}/,
    `export function compose(...args) { return cli('compose','--profile','publisher','-p',project,'-f',path.resolve('compose.admin-publish.yaml'),'-f',${JSON.stringify(path.join(state, 'compose.generated.yaml'))},'-f',${JSON.stringify(path.join(state, 'ports.generated.yaml'))},...args) }`,
  )
  const helperFile = path.join(cache, 'environment.mjs')
  fs.writeFileSync(helperFile, helper, { mode: 0o600 })
  process.env.V11_SOURCE_REVISION = prior.source
  process.env.V11_BUILDER_ID = prior.images.worker
  process.env.V11_LOCAL_PUBLISH = '1'
  credentials = await (await import(pathToFileURL(helperFile).href)).initializeTestAdministrator()
  docker(['cp', `${project}-api-init-1:/authority/ca.crt`, path.join(cache, 'ca.crt')])
  ca = fs.readFileSync(path.join(cache, 'ca.crt'))
  assert.equal(new X509Certificate(ca).ca, true)
  await login()
  const beforePrivate = await privateProof()
  const beforePublic = await publicProof()
  const oldConfiguration = fs.readFileSync(path.join(state, 'compose.generated.yaml'))
  const lock = path.join(state, 'operation.lock')
  if (!resumeGuard) {
    mark(
      'old reviewed source started from independent new restored volumes; trusted HTTPS administrator and uploaded image work',
    )
    lifecycle(['update', '--project', project, '--manifest', nextFile])
    assert.equal(read(path.join(state, 'current.json')).spec.source, next.source)
    assert.deepEqual(await privateProof(), beforePrivate)
    assert.deepEqual(await publicProof(), beforePublic)
    mark(
      'real six-role different-source same-schema upgrade retained complete draft, private image and immutable public HTML/SEO',
    )
    lifecycle(['rollback', '--project', project])
    assert.deepEqual(read(path.join(state, 'current.json')).spec, prior)
    assert.deepEqual(await privateProof(), beforePrivate)
    assert.deepEqual(await publicProof(), beforePublic)
    mark(
      'real code rollback restored all previous image identities; database and content did not time-travel',
    )
    const artifact = read(
      path.join(
        backup,
        'content',
        'publications',
        'releases',
        report.restored.activeRelease,
        'manifest.json',
      ),
    )
    const image = artifact.files.find((file) => /\.(png|webp|jpe?g)$/.test(file.path))
    assert.ok(image, 'Fixture must have a real published bitmap')
    for (const [name, role, transform] of [
      ['startup-fails', 'gateway', 'missing-binary'],
      ['public-fails', 'static', 'bad-public'],
      ['admin-assets-fail', 'gateway', 'missing-admin'],
      ['image-bytes-fail', 'static', '/' + image.path],
    ]) {
      const fixture = candidateFixture(next, name, role, transform)
      const failure = lifecycle(['update', '--project', project, '--manifest', fixture], 1)
      assert.match(failure, /previous service restored and HTTP verified/)
      assert.deepEqual(read(path.join(state, 'current.json')).spec, prior)
      assert.equal(fs.existsSync(path.join(state, 'operation.lock')), false)
      assert.equal(fs.existsSync(path.join(state, 'recovery-required.json')), false)
      assert.deepEqual(await privateProof(), beforePrivate)
      assert.deepEqual(await publicProof(), beforePublic)
      mark(
        name +
          ': real derivative candidate refused and old service plus database/HTTP/images reverified',
        { fixture },
      )
    }
    const incompatible = path.join(cache, 'schema4.json')
    fs.writeFileSync(incompatible, JSON.stringify({ ...next, schema: 4 }))
    assert.match(
      lifecycle(['update', '--project', project, '--manifest', incompatible], 1),
      /schema|compatible/,
    )
    const priorRecord = read(path.join(state, 'previous.json'))
    const previousFile = path.join(state, 'previous.json')
    fs.writeFileSync(
      previousFile,
      JSON.stringify({ ...priorRecord, spec: { ...priorRecord.spec, schema: 4 } }),
    )
    try {
      assert.match(lifecycle(['rollback', '--project', project], 1), /schema|compatible/)
    } finally {
      fs.writeFileSync(previousFile, JSON.stringify(priorRecord, null, 2) + '\n')
    }
    mark(
      'schema4 update and rollback both refused before candidate replacement; no database migration or downgrade',
    )
    fs.mkdirSync(lock)
    try {
      lifecycle(['update', '--project', project, '--manifest', nextFile], 1)
      assert.ok(fs.existsSync(lock))
    } finally {
      fs.rmdirSync(lock)
    }
    mark('preexisting operation lock refused subsequent update and remained intact')
  }
  compose(['stop', '--timeout', '40', 'worker', 'api', 'api-init'])
  const oldState = inspectProject(project, prior.images.maintenance)
  const newReaderState = inspectProject(project, next.images.maintenance)
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '120'])
  const loader = path.join(cache, 'stop-failure.mjs')
  fs.writeFileSync(
    loader,
    `// Fixed isolated host-only test preload; never loaded by running services.\nimport assert from 'node:assert/strict';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';assert.ok(process.argv.includes(${JSON.stringify(project)}));const original=childProcess.execFileSync;let stops=0;childProcess.execFileSync=function(file,args,options){if(file==='docker'&&args.includes(${JSON.stringify(project)})&&args.includes('compose')&&args.includes('stop')&&args.includes('worker')&&args.includes('api')){stops++;if(stops===2)throw Object.assign(new Error('Isolated host test refused candidate writer stop; actual state unconfirmed'),{status:88})}return original.call(this,file,args,options)};syncBuiltinESMExports();\n`,
  )
  const unknown = lifecycle(
    [
      'update',
      '--project',
      project,
      '--manifest',
      path.join(cache, 'startup-fails', 'release.json'),
    ],
    1,
    loader,
  )
  assert.match(unknown, /Manual recovery required/)
  assert.ok(fs.existsSync(lock))
  const guard = read(path.join(state, 'recovery-required.json'))
  assert.equal(guard.phase, 'manual-recovery-required')
  assert.deepEqual(guard.previous, prior)
  lifecycle(['update', '--project', project, '--manifest', nextFile], 1)
  assert.ok(fs.existsSync(lock))
  report.uncertain = {
    guard,
    method:
      'Test-only host preload rejects exact second writer-stop after a real broken candidate; not a complete Docker daemon outage or physical DB corruption',
  }
  try {
    report.uncertain.publicDuringFailure = await publicProof()
  } catch {
    report.uncertain.publicDuringFailure =
      'Unavailable while broken gateway is retained; no zero-downtime claim'
  }
  mark(
    'unconfirmed candidate writer state preserves manual-recovery record and blocks repeated update',
  )
  // Explicit operator recovery: stop actual candidate writers, compare old and
  // new offline read-only checkers, restore exact recorded old Compose, and
  // verify HTTP/private media before releasing only this project's guard.
  compose(['stop', '--timeout', '40', 'worker', 'api', 'api-init'])
  assert.deepEqual(inspectProject(project, prior.images.maintenance), oldState)
  assert.deepEqual(inspectProject(project, next.images.maintenance), newReaderState)
  fs.writeFileSync(path.join(state, 'compose.generated.yaml'), oldConfiguration)
  compose(['up', '-d', '--no-build', 'publication-init', 'api-init'])
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '120'])
  assert.deepEqual(await privateProof(), beforePrivate)
  assert.deepEqual(await publicProof(), beforePublic)
  assert.deepEqual(read(path.join(state, 'current.json')).spec, prior)
  fs.renameSync(
    path.join(state, 'recovery-required.json'),
    path.join(state, 'operator-recovered-cross-source.json'),
  )
  fs.rmdirSync(lock)
  mark(
    'explicit operator recovered old services only after old/new database inspection and complete HTTP/private-image recheck',
  )
  lifecycle(['update', '--project', project, '--manifest', nextFile])
  assert.equal(fs.existsSync(lock), false)
  assert.deepEqual(await privateProof(), beforePrivate)
  assert.deepEqual(await publicProof(), beforePublic)
  mark(
    'a subsequent genuine cross-source update succeeds only after reviewed recovery removes its own guard',
  )
  report.result = 'PASS'
  report.limitations = [
    'Schema3 only; no automatic cross-schema migration or downgrade.',
    'Historical content rollback stays restricted to the source and Worker identity that built that content. Code rollback does not grant cross-source content rollback.',
    'Host failure preload tests explicit writer-state uncertainty, not a physical SQLite corruption or total Docker daemon failure.',
    'Candidate replacement may briefly interrupt public and management HTTP.',
  ]
  lifecycle(['stop', '--project', project])
  report.retention = { stopped: true, volumesRetained: true, imagesRetained: true }
} catch (error) {
  report.result = 'FAIL'
  report.error = credentials?.password
    ? String(error.message).replaceAll(credentials.password, '[redacted]')
    : error.message
  console.error(report.error)
  process.exitCode = 1
} finally {
  credentials = undefined
  cookies.clear()
  fs.mkdirSync(path.dirname(evidence), { recursive: true })
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n')
}
