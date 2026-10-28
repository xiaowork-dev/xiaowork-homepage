// Dedicated local disaster-recovery acceptance. Credentials are generated in
// memory and entered through the existing real Docker PTY helper, never argv.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { docker, localEngine, restoreProject, verifyBackup } from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-closure-final-backup'
const recovery = 'xiaowork-homepage-v11-closure-final-restored'
const cache = path.resolve('.cache/p6e-closure-backup-recovery')
const api = '/api/admin/v1'
const report = {
  date: new Date().toISOString(),
  scope: 'Dedicated local Docker projects and newly created recovery volumes only',
  project,
  recovery,
  tlsVerificationDisabled: false,
  credentialsRecorded: false,
  cases: [],
  requests: [],
  public: [],
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let credentials,
  csrf,
  ca,
  origin = 'https://localhost:3461'
const cookies = new Map()
const lifecycle = (...args) =>
  execFileSync(process.execPath, ['scripts/v11-release.mjs', ...args], {
    encoding: 'utf8',
    timeout: 360000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const record = (name, detail) => {
  report.cases.push({ name, detail, result: 'PASS' })
  console.log('PASS ' + name)
}
function png() {
  const crc = (data) => {
    let n = 0xffffffff
    for (const byte of data) {
      n ^= byte
      for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
    }
    return (n ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const tag = Buffer.from(type)
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length)
    tag.copy(b, 4)
    data.copy(b, 8)
    b.writeUInt32BE(crc(Buffer.concat([tag, data])), 8 + data.length)
    return b
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64)
  header.writeUInt32BE(40, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.alloc((64 * 3 + 1) * 40)
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 64; x++) {
      const i = y * 193 + 1 + x * 3
      pixels[i] = 64
      pixels[i + 1] = 32
      pixels[i + 2] = 96
    }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
async function request(
  route,
  { method = 'GET', body, type, headers = {}, expected = 200, authenticate = true } = {},
) {
  const address = new URL(route.startsWith('/api/') ? route : api + route, origin)
  const encoded =
    body === undefined
      ? undefined
      : Buffer.isBuffer(body)
        ? body
        : Buffer.from(JSON.stringify(body))
  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      address,
      {
        method,
        ca,
        rejectUnauthorized: true,
        headers: {
          Origin: origin,
          ...(authenticate ? { Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') } : {}),
          ...(encoded
            ? { 'Content-Type': type ?? 'application/json', 'Content-Length': encoded.length }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (b) => chunks.push(b))
        res.on('end', () => {
          for (const value of res.headers['set-cookie'] ?? []) {
            const pair = value.split(';')[0]
            const at = pair.indexOf('=')
            if (at >= 0) cookies.set(pair.slice(0, at), pair.slice(at + 1))
          }
          const bytes = Buffer.concat(chunks)
          let json
          if (String(res.headers['content-type']).includes('application/json'))
            json = JSON.parse(bytes.toString('utf8'))
          resolve({ status: res.statusCode, headers: res.headers, bytes, json })
        })
      },
    )
    req.setTimeout(30000, () => req.destroy(new Error('Local HTTPS timeout')))
    req.on('error', reject)
    if (encoded) req.write(encoded)
    req.end()
  })
  report.requests.push({ method, path: address.pathname, expected, actual: result.status })
  assert.equal(
    result.status,
    expected,
    `${method} ${address.pathname}: ${result.json?.error?.code ?? ''}`,
  )
  return result
}
async function login() {
  const challenge = (await request('/auth/login-challenge', { authenticate: false })).json.data
  const result = await request('/auth/login', {
    method: 'POST',
    body: credentials,
    headers: { 'X-CSRF-Token': challenge.loginNonce },
  })
  csrf = result.json.data.csrfToken
  assert.ok(cookies.get('__Host-xiaowork-admin'))
}
const workspace = async () => (await request('/workspace')).json.data
async function mutate(route, body, method = 'PUT', expected = 200) {
  const draft = await workspace()
  return (
    await request(route, {
      method,
      body,
      expected,
      headers: {
        'X-CSRF-Token': csrf,
        'If-Match': '"' + draft.revision + '"',
        'Idempotency-Key': randomBytes(16).toString('hex'),
      },
    })
  ).json?.data
}
async function publish(kind, target) {
  if (kind !== 'preview')
    await request('/auth/reauth', {
      method: 'POST',
      body: { password: credentials.password },
      headers: { 'X-CSRF-Token': csrf },
    })
  const active = (await request('/publishing-status')).json.data.activeReleaseId
  const body =
    kind === 'preview'
      ? {}
      : {
          confirmAllChanges: true,
          reviewedActiveReleaseId: active,
          ...(target ? { targetReleaseId: target } : {}),
        }
  const submitted = await mutate(
    '/' + (kind === 'rollback' ? 'rollback' : kind) + '-jobs',
    body,
    'POST',
    202,
  )
  const deadline = Date.now() + 600000
  while (Date.now() < deadline) {
    const job = (await request('/jobs/' + submitted.jobId)).json.data.job
    if (job.status === 'succeeded') return job
    assert.ok(
      ['queued', 'running', 'reconciling'].includes(job.status),
      `Task failed: ${job.error?.code ?? job.status}`,
    )
    await pause(2500)
  }
  throw new Error('Real local publication timed out')
}
async function publicProof(port) {
  const proof = []
  for (const route of [
    '/',
    '/projects/',
    '/about/',
    '/__xiaowork-release.json',
    '/sitemap.xml',
    '/robots.txt',
  ]) {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { cache: 'no-store' })
    assert.equal(r.status, 200)
    const bytes = Buffer.from(await r.arrayBuffer())
    proof.push({
      route,
      status: r.status,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    if (route.endsWith('.json')) proof.at(-1).releaseId = JSON.parse(bytes).releaseId
    if (['/', '/projects/', '/about/'].includes(route)) {
      const html = bytes.toString('utf8')
      assert.ok(
        html.includes('https://xiaoworks.com'),
        'Public static SEO uses the fixed official origin',
      )
      assert.match(html, /<link[^>]+rel="canonical"/)
      assert.match(html, /<meta[^>]+property="og:/)
      assert.match(html, /<title>[^<]+<\/title>/)
    }
    if (route === '/sitemap.xml') {
      const xml = bytes.toString('utf8')
      assert.ok(xml.includes('https://xiaoworks.com/'))
      assert.ok(!xml.includes('localhost'))
    }
    if (route === '/robots.txt')
      assert.ok(bytes.toString('utf8').includes('https://xiaoworks.com/sitemap.xml'))
  }
  return proof
}
async function prepareHelper(spec) {
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  const state = path.resolve('.v11-deploy', project)
  let helper = fs
    .readFileSync('scripts/publishing-browser-environment.mjs', 'utf8')
    .replaceAll('xiaowork-homepage-v11-p6d-e2e', project)
    .replaceAll('https://localhost:3445', origin)
    .replaceAll('.cache/p6d-browser', '.cache/p6e-closure-backup-recovery')
    .replaceAll('local-p6d-test', 'local-p6e-closure-backup')
  helper = helper.replace(
    /export function compose\(\.\.\.args\) \{[\s\S]*?\n\}/,
    `export function compose(...args) { return cli('compose','--profile','publisher','-p',project,'-f',path.resolve('compose.admin-publish.yaml'),'-f',${JSON.stringify(path.join(state, 'compose.generated.yaml'))},'-f',${JSON.stringify(path.join(state, 'ports.generated.yaml'))},...args) }`,
  )
  const filename = path.join(cache, 'environment.mjs')
  fs.writeFileSync(filename, helper, { mode: 0o600 })
  process.env.V11_SOURCE_REVISION = spec.source
  process.env.V11_BUILDER_ID = spec.images.worker
  process.env.V11_LOCAL_PUBLISH = '1'
  const module = await import(pathToFileURL(filename).href + '?time=' + Date.now())
  credentials = await module.initializeTestAdministrator()
  docker(['cp', `${project}-api-init-1:/authority/ca.crt`, path.join(cache, 'ca.crt')])
  ca = fs.readFileSync(path.join(cache, 'ca.crt'))
  assert.equal(new X509Certificate(ca).ca, true)
}
try {
  localEngine()
  const runtime = JSON.parse(
    fs.readFileSync('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'),
  )
  assert.equal(runtime.source, '817aa533741bdd5de23f322fa5e5171442cb28a9')
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  const specFile = path.resolve('.cache/p6e-closure-backup-recovery/descriptor.json')
  fs.writeFileSync(
    specFile,
    JSON.stringify(
      {
        format: 1,
        source: runtime.source,
        schema: runtime.schema,
        images: Object.fromEntries(
          Object.entries(runtime.images).map(([role, value]) => [role, value.id]),
        ),
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  )
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'))
  report.sourceRevision = spec.source
  report.images = spec.images
  report.schema = spec.schema
  report.finalManifest = 'docs/evidence/P6E-final-runtime-manifest.json'
  report.runtimeIdentity = Object.fromEntries(
    Object.entries(spec.images).map(([role, image]) => {
      const actual = JSON.parse(docker(['image', 'inspect', '--format', '{{json .}}', image]))
      assert.equal(actual.Id, image)
      assert.equal(actual.Config.Labels['org.opencontainers.image.revision'], spec.source)
      return [
        role,
        {
          image: actual.Id,
          source: actual.Config.Labels['org.opencontainers.image.revision'],
          user: actual.Config.User,
        },
      ]
    }),
  )
  lifecycle(
    'deploy',
    '--project',
    project,
    '--manifest',
    specFile,
    '--http-port',
    '3228',
    '--https-port',
    '3461',
    '--subnet',
    '192.168.239.0/28',
    '--local-publish',
    '1',
  )
  await prepareHelper(spec)
  await login()
  record('new isolated deployment and trusted HTTPS administrator login')
  let draft = await workspace()
  assert.equal(draft.projects.length, 3)
  const boundary = 'P6E-' + randomBytes(12).toString('hex')
  const bytes = png()
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-p6e.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const uploaded = await request('/media', {
    method: 'POST',
    body: multipart,
    type: `multipart/form-data; boundary=${boundary}`,
    expected: 201,
    headers: { 'X-CSRF-Token': csrf, 'If-Match': '"' + draft.revision + '"' },
  })
  const media = uploaded.json.data.media
  await mutate(
    '/media/' + media.id,
    {
      publicUseConfirmed: true,
      publicConfirmationNote:
        'Synthetic local purple bitmap; not a project screenshot; no business data.',
      alt: 'P6E synthetic local recovery test image',
    },
    'PATCH',
  )
  draft = await workspace()
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
  const projectInput = Object.fromEntries(fields.map((field) => [field, first[field]]))
  projectInput.cover = { kind: 'media', id: media.id }
  projectInput.coverAlt = 'P6E synthetic local recovery test image'
  projectInput.coverKind = 'placeholder'
  projectInput.isPlaceholder = true
  await mutate('/projects/' + first.id, projectInput)
  const A = await publish('publish')
  record('real immutable publication A with uploaded referenced bitmap', { releaseId: A.releaseId })
  projectInput.summary = 'Isolated P6E recovery fixture B; project facts remain unconfirmed.'
  await mutate('/projects/' + first.id, projectInput)
  const B = await publish('publish')
  record('real immutable publication B and history', { releaseId: B.releaseId })
  const restored = await publish('rollback', A.releaseId)
  assert.equal(restored.releaseId, A.releaseId)
  const preview = await publish('preview')
  record('real content rollback A plus private preview; draft B preserved', {
    active: A.releaseId,
    preview: preview.releaseId,
  })
  const baseline = await workspace()
  const oldCookie = cookies.get('__Host-xiaowork-admin')
  const mediaBefore = await request('/media/' + media.id + '/content')
  const mediaHash = createHash('sha256').update(mediaBefore.bytes).digest('hex')
  const before = await publicProof(3228)
  report.baseline = {
    draftRevision: baseline.revision,
    projects: baseline.projects.length,
    mediaSha256: mediaHash,
    activeReleaseId: A.releaseId,
    draftSummary: baseline.projects.find((item) => item.id === first.id).summary,
  }
  assert.equal(report.baseline.draftSummary, projectInput.summary)
  report.public.push({ stage: 'beforeBackup', files: before })
  const backup = path.resolve('.cache/v11-backups/p6e-closure-complete-' + Date.now())
  lifecycle('backup', '--project', project, '--backup', backup)
  const checked = verifyBackup(spec.images.maintenance, backup)
  assert.equal(checked.state.administrators, 1)
  assert.ok(checked.state.uploads >= 1 && checked.state.releases >= 3)
  assert.equal(checked.state.activeRelease, A.releaseId)
  report.backup = {
    method: checked.method,
    state: checked.state,
    fileCount: checked.files.length,
    runtime: checked.runtime,
    manifestSha256: createHash('sha256')
      .update(fs.readFileSync(path.join(backup, 'content', 'manifest.json')))
      .digest('hex'),
  }
  assert.deepEqual(await publicProof(3228), before)
  await request('/auth/session')
  record('stopped-writer VACUUM INTO backup verified; original service and Session resumed')
  const badBundle = path.join(cache, 'tampered-bundle')
  fs.mkdirSync(badBundle)
  fs.cpSync(path.join(backup, 'bundle.json'), path.join(badBundle, 'bundle.json'))
  fs.mkdirSync(path.join(badBundle, 'content'))
  const damagedRuntime = JSON.parse(fs.readFileSync(path.join(badBundle, 'bundle.json'), 'utf8'))
  damagedRuntime.runtime.source = '0'.repeat(40)
  fs.writeFileSync(path.join(badBundle, 'bundle.json'), JSON.stringify(damagedRuntime))
  assert.throws(() => verifyBackup(spec.images.maintenance, badBundle), /Runtime descriptor SHA/)
  record('tampered independent runtime metadata rejected')
  const bundledSpec = {
    format: 1,
    source: checked.runtime.source,
    schema: checked.runtime.schema,
    images: checked.runtime.images,
  }
  const recoveredSpecFile = path.join(cache, 'release-from-backup.json')
  fs.writeFileSync(recoveredSpecFile, JSON.stringify(bundledSpec, null, 2) + '\n')
  const originalState = path.resolve('.v11-deploy', project, 'current.json')
  const withheldState = path.join(cache, 'original-host-state-withheld.json')
  fs.renameSync(originalState, withheldState)
  let restoreState
  try {
    restoreState = restoreProject(recovery, checked.runtime.images.maintenance, backup)
    assert.deepEqual(restoreState, checked.state)
    lifecycle(
      'deploy',
      '--project',
      recovery,
      '--manifest',
      recoveredSpecFile,
      '--http-port',
      '3229',
      '--https-port',
      '3462',
      '--subnet',
      '192.168.238.0/28',
      '--local-publish',
      '1',
      '--restored',
      '1',
    )
  } finally {
    fs.renameSync(withheldState, originalState)
  }
  record(
    'independent restore used only backup runtime descriptor while original deployment state was unavailable',
  )
  origin = 'https://localhost:3462'
  cookies.clear()
  cookies.set('__Host-xiaowork-admin', oldCookie)
  await request('/auth/session', { expected: 401 })
  await login()
  assert.deepEqual(await workspace(), baseline)
  assert.equal(
    createHash('sha256')
      .update((await request('/media/' + media.id + '/content')).bytes)
      .digest('hex'),
    mediaHash,
  )
  assert.deepEqual(await publicProof(3229), before)
  const history = (await request('/releases')).json.data
  assert.ok(history.items.length >= 3)
  assert.ok(
    history.items.some((item) => item.id === A.releaseId) &&
      history.items.some((item) => item.id === B.releaseId),
  )
  report.recovered = {
    state: restoreState,
    historyCount: history.items?.length ?? history.releases?.length,
    activeReleaseId: (await request('/publishing-status')).json.data.activeReleaseId,
  }
  assert.equal(report.recovered.activeReleaseId, A.releaseId)
  await request('/previews/' + preview.releaseId + '/')
  record(
    'new empty-volume restore, old Session rejected, same password re-login, identical draft/media/public/SEO/history/private preview',
  )
  assert.throws(() => restoreProject(recovery, spec.images.maintenance, backup))
  record('repeat restore refused instead of overwriting existing recovery data')
  report.result = 'PASS'
  report.finishedAt = new Date().toISOString()
} catch (error) {
  report.result = 'FAIL'
  report.error = credentials?.password
    ? error.message.replaceAll(credentials.password, '[redacted]')
    : error.message
  console.error(report.error)
  process.exitCode = 1
} finally {
  report.stoppedProjects = []
  for (const owned of [recovery, project]) {
    if (!fs.existsSync(path.resolve('.v11-deploy', owned, 'current.json'))) continue
    try {
      lifecycle('stop', '--project', owned)
      const running = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${owned}`])
      assert.equal(running, '')
      report.stoppedProjects.push({
        project: owned,
        result: 'stopped; all volumes and images retained',
      })
    } catch (error) {
      report.stoppedProjects.push({
        project: owned,
        result: 'STOP_REQUIRES_REVIEW',
        error: error.message,
      })
      report.result = 'FAIL'
      process.exitCode = 1
    }
  }
  credentials = undefined
  csrf = undefined
  cookies.clear()
  fs.mkdirSync('docs/evidence', { recursive: true })
  report.finishedAt ??= new Date().toISOString()
  const evidence = 'docs/evidence/P6E-final-backup-recovery.json'
  if (fs.existsSync(evidence)) {
    const previous = JSON.parse(fs.readFileSync(evidence, 'utf8'))
    fs.writeFileSync(
      evidence.replace('.json', '-prior-' + Date.parse(previous.date) + '.json'),
      JSON.stringify(previous, null, 2) + '\n',
    )
  }
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n')
}
