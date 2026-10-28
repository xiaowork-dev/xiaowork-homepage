// Isolated real-Docker cross-source lifecycle acceptance. All failures are
// operator-only derivative images or an explicit host CLI test preload. No
// fixture is copied into a production API, Worker or maintenance image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { docker, localEngine } from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-cross-source'
const origin = 'https://localhost:3459'
const cache = path.resolve('.cache/p6e-cross-source')
const state = path.resolve('.v11-deploy', project)
const evidence = path.resolve('docs/evidence/P6E-cross-source-new-content.json')
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
  const command = [...(preload ? ['--import', preload] : []), 'scripts/v11-release.mjs', ...args]
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function submitted(kind, target, expectedStatus = 'succeeded') {
  const session = await request('/auth/session')
  assert.equal(session.status, 200)
  const csrf = session.json.data.csrfToken
  assert.equal(
    (
      await request(
        '/auth/reauth',
        'POST',
        { password: credentials.password },
        { 'X-CSRF-Token': csrf },
      )
    ).status,
    200,
  )
  const draft = (await request('/workspace')).json.data
  const active = (await request('/publishing-status')).json.data.activeReleaseId
  const response = await request(
    '/' + (kind === 'rollback' ? 'rollback' : 'publish') + '-jobs',
    'POST',
    {
      confirmAllChanges: true,
      reviewedActiveReleaseId: active,
      ...(target ? { targetReleaseId: target } : {}),
    },
    {
      'X-CSRF-Token': csrf,
      'If-Match': '"' + draft.revision + '"',
      'Idempotency-Key': randomBytes(16).toString('hex'),
    },
  )
  assert.equal(response.status, 202, '202 must only mean a real queued task')
  const deadline = Date.now() + 600000
  while (Date.now() < deadline) {
    const job = (await request('/jobs/' + response.json.data.jobId)).json.data.job
    if (['succeeded', 'failed'].includes(job.status)) {
      assert.equal(job.status, expectedStatus)
      return job
    }
    assert.ok(['queued', 'running', 'reconciling'].includes(job.status))
    await pause(2500)
  }
  throw new Error('Real cross-source content task timed out')
}
try {
  localEngine()
  const previousReport = read('docs/evidence/P6E-cross-source-final.json')
  assert.equal(previousReport.result, 'PASS')
  const next = specFrom(read(path.resolve(process.argv[2])))
  const prior = previousReport.previous
  assert.notEqual(next.source, prior.source)
  const existing = read(path.join(state, 'current.json'))
  assert.deepEqual(existing.spec, next)
  assert.equal(fs.existsSync(path.join(state, 'operation.lock')), false)
  assert.equal(fs.existsSync(path.join(state, 'recovery-required.json')), false)
  report.previous = prior
  report.final = next
  process.env.V11_SOURCE_REVISION = next.source
  process.env.V11_BUILDER_ID = next.images.worker
  process.env.V11_LOCAL_PUBLISH = '1'
  compose(['up', '-d', '--no-build', 'publication-init', 'api-init'])
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '120'])
  credentials = await (
    await import(
      pathToFileURL(path.join(cache, 'environment.mjs')).href + '?newContent=' + Date.now()
    )
  ).initializeTestAdministrator()
  docker(['cp', project + '-api-init-1:/authority/ca.crt', path.join(cache, 'ca.crt')])
  ca = fs.readFileSync(path.join(cache, 'ca.crt'))
  assert.equal(new X509Certificate(ca).ca, true)
  await login()
  const draft = (await request('/workspace')).json.data
  const first = draft.projects[0]
  const fields = [
    'slug',
    'name',
    'summary',
    'description',
    'category',
    'techStack',
    'status',
    'featured',
    'visible',
    'isPlaceholder',
    'cover',
    'coverAlt',
    'coverKind',
    'demoUrl',
    'repositoryUrl',
  ]
  const body = Object.fromEntries(fields.map((field) => [field, first[field]]))
  body.summary = 'Isolated final-source code-rollback fixture; project facts remain unconfirmed.'
  const session = (await request('/auth/session')).json.data
  const updated = await request('/projects/' + first.id, 'PUT', body, {
    'X-CSRF-Token': session.csrfToken,
    'If-Match': '"' + draft.revision + '"',
  })
  assert.equal(updated.status, 200)
  const published = await submitted('publish')
  assert.equal(published.activeVerified, true)
  const newPrivate = await privateProof()
  const newPublic = await publicProof()
  assert.ok(newPrivate.draft.projects.some((item) => item.summary === body.summary))
  report.newPublication = published
  report.publicBeforeCodeRollback = newPublic
  mark(
    'final-source real Nuxt publication produced new HTML/SEO and retained confirmed synthetic private/public media',
    { jobId: published.id, releaseId: published.releaseId },
  )
  lifecycle(['rollback', '--project', project])
  const old = read(path.join(state, 'current.json'))
  assert.deepEqual(old.spec, prior)
  const backedManifest = read(
    path.join(
      old.backup,
      'content',
      'publications',
      'releases',
      published.releaseId,
      'manifest.json',
    ),
  )
  assert.equal(backedManifest.sourceRevision, next.source)
  assert.equal(backedManifest.builderId, next.images.worker)
  assert.deepEqual(await privateProof(), newPrivate)
  assert.deepEqual(await publicProof(), newPublic)
  const provenJob = (await request('/jobs/' + published.id)).json.data.job
  assert.equal(provenJob.status, 'succeeded')
  assert.equal(provenJob.activeVerified, true)
  const active = (await request('/publishing-status')).json.data
  assert.equal(active.activeReleaseId, published.releaseId)
  assert.equal(active.activeVerified, true)
  report.oldRuntimeNewContentProof = {
    job: provenJob,
    status: active,
    manifestSource: backedManifest.sourceRevision,
    manifestBuilder: backedManifest.builderId,
  }
  mark(
    'older source genuinely serves and verifies new-source current artifact, original successful task identity, workspace and image SHA after code rollback',
  )
  const refused = await submitted('rollback', published.releaseId, 'failed')
  assert.equal(refused.error?.code, 'ROLLBACK_TARGET_INVALID')
  assert.deepEqual(await privateProof(), newPrivate)
  assert.deepEqual(await publicProof(), newPublic)
  assert.equal((await request('/publishing-status')).json.data.activeReleaseId, published.releaseId)
  report.crossSourceContentRestore = {
    submission: 202,
    job: refused,
    actualOutcome: 'failed; current and draft unchanged',
  }
  mark(
    'direct cross-source content-restore request safely fails as incompatible; 202 is queued only and no success is reported',
  )
  lifecycle(['update', '--project', project, '--manifest', path.join(cache, 'final-release.json')])
  assert.deepEqual(read(path.join(state, 'current.json')).spec, next)
  assert.deepEqual(await privateProof(), newPrivate)
  assert.deepEqual(await publicProof(), newPublic)
  mark('new source accepts retained data after old-runtime rejection and genuine re-upgrade')
  lifecycle(['stop', '--project', project])
  report.retention = { stopped: true, volumesRetained: true, imagesRetained: true }
  report.result = 'PASS'
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
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n')
}
