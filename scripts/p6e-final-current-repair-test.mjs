// Test-controller only: consumes the freshly completed final-source pre-switch
// crash case, never the historical P6E fault volumes. No runtime fault API.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { currentRepair } from './v11-current-repair.mjs'
import {
  backupProject,
  docker,
  inspectProject,
  restoreProject,
  verifyBackup,
} from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-closure-fault'
const recovered = 'xiaowork-homepage-v11-p6e-closure-repair'
const origin = 'https://localhost:3456'
const recoveryOrigin = 'https://localhost:3460'
const cache = path.resolve('.cache/p6e-closure-repair')
const manifest = JSON.parse(
  fs.readFileSync('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'),
)
const finalImages = Object.fromEntries(
  Object.entries(manifest.images).map(([role, value]) => [role, value.id]),
)
const maintenance = finalImages.maintenance
const report = {
  date: new Date().toISOString(),
  project,
  recovered,
  source: manifest.source,
  finalImages,
  cases: [],
  result: 'RUNNING',
}
const output = 'docs/evidence/P6E-final-current-repair.json'
const record = (name, detail = {}) => {
  report.cases.push({ name, result: 'PASS', ...detail })
  console.log('PASS ' + name)
  save()
}
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
const digest = (b) => createHash('sha256').update(b).digest('hex')

function png() {
  const crc32 = (b) => {
    let crc = 0xffffffff
    for (const value of b) {
      crc ^= value
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (name, bytes) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      sum = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    sum.writeUInt32BE(crc32(Buffer.concat([type, bytes])))
    return Buffer.concat([length, type, bytes, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64, 0)
  header.writeUInt32BE(40, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((64 * 4 + 1) * 40)
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 64; x++) {
      const i = y * 257 + 1 + x * 4
      rows[i] = 88
      rows[i + 1] = 45
      rows[i + 2] = 140
      rows[i + 3] = 255
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function client(base, ca) {
  let cookies = new Map()
  return {
    cookies: () => [...cookies].map(([k, v]) => k + '=' + v).join('; '),
    setCookies: (value) => {
      cookies = new Map(value.split('; ').map((v) => v.split('=')))
    },
    request(route, method = 'GET', body, extra = {}) {
      return new Promise((resolve, reject) => {
        const bytes =
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? body
              : Buffer.from(JSON.stringify(body))
        const req = https.request(
          base + route,
          {
            method,
            ca,
            rejectUnauthorized: true,
            headers: {
              Origin: base,
              ...(cookies.size
                ? { Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') }
                : {}),
              ...(bytes
                ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length }
                : {}),
              ...extra,
            },
          },
          (res) => {
            const data = []
            for (const cookie of res.headers['set-cookie'] ?? []) {
              const [key, value] = cookie.split(';')[0].split('=')
              cookies.set(key, value)
            }
            res.on('data', (c) => data.push(c))
            res.on('end', () => {
              const bytes = Buffer.concat(data)
              let json
              try {
                json = JSON.parse(bytes)
              } catch {
                // Binary private images deliberately have no JSON response body.
              }
              resolve({ status: res.statusCode, headers: res.headers, bytes, json })
            })
          },
        )
        req.on('error', reject)
        if (bytes) req.write(bytes)
        req.end()
      })
    },
  }
}
async function login(c, credentials) {
  const challenge = await c.request('/api/admin/v1/auth/login-challenge')
  assert.equal(challenge.status, 200)
  const result = await c.request('/api/admin/v1/auth/login', 'POST', credentials, {
    'X-CSRF-Token': challenge.json.data.loginNonce,
  })
  assert.equal(result.status, 200)
  return result.json.data
}
async function publicProof(base) {
  const result = []
  for (const route of [
    '/',
    '/projects/',
    '/about/',
    '/sitemap.xml',
    '/robots.txt',
    '/__xiaowork-release.json',
  ]) {
    const r = await fetch(base + route, { cache: 'no-store' })
    assert.equal(r.status, 200)
    result.push({ route, status: r.status, sha256: digest(Buffer.from(await r.arrayBuffer())) })
  }
  return result
}

try {
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  save()
  const beforeFault = JSON.parse(
    fs.readFileSync('docs/evidence/P6E-final-faults-before-switch.json', 'utf8'),
  )
  assert.equal(beforeFault.project, project)
  assert.equal(beforeFault.case, 'before-switch')
  assert.equal(beforeFault.result, 'PASS')
  const helper = await import(
    pathToFileURL(path.resolve('.cache/p6e-final-harness/p6e-fault-environment.mjs')).href
  )
  const trust = await helper.prepareEnvironment()
  assert.equal(helper.project, project)
  const credentials = await helper.initializeTestAdministrator()
  const ca = fs.readFileSync(trust.caPath),
    source = client(origin, ca)
  const session = await login(source, credentials)
  const ws = await source.request('/api/admin/v1/workspace')
  assert.equal(ws.status, 200)
  const fixture = png(),
    boundary = 'p6e-closure-image-' + Date.now()
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-repair-fixture.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    fixture,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const upload = await source.request('/api/admin/v1/media', 'POST', multipart, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'X-CSRF-Token': session.csrfToken,
    'If-Match': '"' + ws.json.data.revision + '"',
  })
  assert.equal(upload.status, 201)
  const media = upload.json.data.media
  const privateImage = await source.request(media.contentUrl)
  assert.equal(privateImage.status, 200)
  assert.equal(digest(privateImage.bytes), media.sha256)
  const workspace = await source.request('/api/admin/v1/workspace')
  assert.equal(workspace.status, 200)
  report.syntheticImage = {
    id: media.id,
    sha256: media.sha256,
    bytes: media.byteSize,
    note: 'Locally generated test fixture; never a real project screenshot',
  }
  const oldCookie = source.cookies()
  report.publicBefore = await publicProof('http://127.0.0.1:3223')
  record(
    'trusted HTTPS account and persistent synthetic private upload prepared; current public version unchanged',
  )
  helper.compose('stop', '-t', '10', 'worker', 'api', 'api-init', 'publication-init')
  const actualImages = { ...finalImages }
  for (const [role, service] of Object.entries({
    api: 'api',
    worker: 'worker',
    gateway: 'gateway',
    frontend: 'frontend',
    static: 'publication-static',
  })) {
    const id = helper.compose('ps', '-aq', service)
    assert.match(id, /^[0-9a-f]{12,64}$/)
    actualImages[role] = docker(['inspect', '--format', '{{.Image}}', id])
  }
  report.faultRuntimeImages = actualImages
  const stateDir = path.resolve('.v11-deploy', project)
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const stateFile = path.join(stateDir, 'current.json')
  const state = {
    project,
    spec: { format: 1, source: manifest.source, schema: manifest.schema, images: actualImages },
  }
  if (fs.existsSync(stateFile))
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).spec, state.spec)
  else
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const plan = currentRepair('inspect', project, maintenance)
  assert.equal(plan.candidates.length, 1)
  assert.equal(plan.candidates[0].status, 'failed')
  assert.equal(plan.candidates[0].jobId, beforeFault.jobId)
  fs.writeFileSync(path.join(cache, 'repair-plan.json'), JSON.stringify(plan, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  report.plan = { ...plan, files: undefined, fileCount: plan.files.length }
  const blockedBackup = path.resolve('.cache/v11-backups', 'p6e-final-before-repair-' + Date.now())
  assert.throws(() => backupProject(project, maintenance, blockedBackup))
  record(
    'read-only intent/job/receipt/history/full-SHA plan identifies exactly the real pre-switch residual; backup still refuses it',
  )
  const applied = currentRepair(
    'apply',
    project,
    maintenance,
    plan.candidates[0].name,
    plan.sha256,
    'Confirmed terminal pre-switch test job and complete retained artifacts; remove redundant name only',
  )
  assert.equal(applied.outcome, 'verified-redundant-link-removed')
  assert.equal(applied.afterFiles.length, plan.files.length - 1)
  assert.deepEqual(
    applied.afterFiles,
    plan.files.filter((file) => file.path !== 'publications/' + plan.candidates[0].name),
  )
  assert.equal(applied.afterSha256, digest(Buffer.from(JSON.stringify(applied.afterFiles))))
  fs.writeFileSync(
    path.join(cache, 'repair-result.json'),
    JSON.stringify(applied, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  )
  assert.deepEqual(await publicProof('http://127.0.0.1:3223'), report.publicBefore)
  assert.equal(currentRepair('inspect', project, maintenance).candidates.length, 0)
  report.repair = {
    id: applied.id,
    outcome: applied.outcome,
    afterSHA256: applied.afterSha256,
    afterFileCount: applied.afterFiles.length,
    completePerFileSHA256Comparison: true,
    fullManifestStorage: 'Private local test-controller cache and persistent volume audit',
    state: inspectProject(project, maintenance),
  }
  record(
    'single-object repair persisted intent/result, all other file SHAs and active HTTP stayed identical',
  )
  const backup = path.resolve('.cache/v11-backups', 'p6e-final-repaired-' + Date.now())
  const backedUp = backupProject(project, maintenance, backup),
    verified = verifyBackup(maintenance, backup)
  report.backup = { state: backedUp.state, fileCount: backedUp.files.length, verified: true }
  assert.equal(verified.state.unfinished, 0)
  const restored = restoreProject(recovered, maintenance, backup)
  assert.deepEqual(restored, verified.state)
  const spec = { format: 1, source: manifest.source, schema: manifest.schema, images: finalImages }
  const specFile = path.join(cache, 'final-restore-runtime.json')
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n')
  execFileSync(
    process.execPath,
    [
      'scripts/v11-release.mjs',
      'deploy',
      '--project',
      recovered,
      '--manifest',
      specFile,
      '--restored',
      '1',
      '--http-port',
      '3227',
      '--https-port',
      '3460',
      '--subnet',
      '192.168.240.0/28',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
  )
  report.publicAfter = await publicProof('http://127.0.0.1:3227')
  assert.deepEqual(report.publicAfter, report.publicBefore)
  const clone = client(recoveryOrigin, ca)
  clone.setCookies(oldCookie)
  assert.equal((await clone.request('/api/admin/v1/auth/session')).status, 401)
  await login(clone, credentials)
  const cloneWorkspace = await clone.request('/api/admin/v1/workspace')
  assert.equal(cloneWorkspace.status, 200)
  assert.deepEqual(cloneWorkspace.json.data, workspace.json.data)
  const cloneImage = await clone.request(media.contentUrl)
  assert.equal(cloneImage.status, 200)
  assert.equal(digest(cloneImage.bytes), media.sha256)
  assert.equal((await clone.request('/admin/')).status, 200)
  const jobs = await clone.request('/api/admin/v1/jobs')
  assert.equal(jobs.status, 200)
  assert.ok(jobs.json.data.items.find((j) => j.id === beforeFault.jobId && j.status === 'failed'))
  record(
    'consistent repaired backup restored to new empty volumes; final six-role runtime started, original password works, old session rejected, private image/SQLite/history/public HTML and SEO match',
  )
  const restoredStateFile = path.resolve('.v11-deploy', recovered, 'current.json')
  const restoredState = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
  assert.equal(restoredState.publish, false)
  assert.deepEqual(restoredState.spec, spec)
  const updateBackup = path.resolve('.cache/v11-backups', 'p6e-final-repaired-update-' + Date.now())
  const update = JSON.parse(
    execFileSync(
      process.execPath,
      [
        'scripts/v11-release.mjs',
        'update',
        '--project',
        recovered,
        '--manifest',
        specFile,
        '--backup',
        updateBackup,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
    ).trim(),
  )
  assert.equal(update.result, 'updated and verified')
  assert.equal(update.source, manifest.source)
  const updateVerified = verifyBackup(maintenance, updateBackup)
  assert.deepEqual(updateVerified.state, backedUp.state)
  assert.deepEqual(await publicProof('http://127.0.0.1:3227'), report.publicBefore)
  assert.deepEqual((await clone.request('/api/admin/v1/workspace')).json.data, workspace.json.data)
  const updatedPrivateImage = await clone.request(media.contentUrl)
  assert.equal(updatedPrivateImage.status, 200)
  assert.equal(digest(updatedPrivateImage.bytes), media.sha256)
  assert.equal((await clone.request('/admin/')).status, 200)
  assert.equal((await clone.request('/api/admin/v1/jobs')).status, 200)
  const updatedState = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
  assert.equal(updatedState.publish, false)
  assert.deepEqual(updatedState.spec, spec)
  const updatedContainers = []
  for (const [role, service] of Object.entries({
    api: 'api',
    gateway: 'gateway',
    frontend: 'frontend',
    static: 'publication-static',
  })) {
    const id = docker([
      'compose',
      '-p',
      recovered,
      ...updatedState.files.flatMap((file) => ['-f', file]),
      'ps',
      '-q',
      service,
    ])
    assert.match(id, /^[0-9a-f]{12,64}$/)
    const actual = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
    assert.equal(actual.Image, finalImages[role])
    assert.equal(actual.State.Running, true)
    assert.equal(actual.State.Health.Status, 'healthy')
    updatedContainers.push({ role, image: actual.Image, health: actual.State.Health.Status })
  }
  for (const member of ['operation.lock', 'recovery-required.json'])
    assert.equal(fs.existsSync(path.resolve('.v11-deploy', recovered, member)), false)
  assert.equal(
    docker([
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${recovered}`,
      '--filter',
      'label=com.docker.compose.service=worker',
    ]),
    '',
  )
  report.postRepairUpdate = {
    command:
      'node scripts/v11-release.mjs update --project ' +
      recovered +
      ' --manifest <final-six-role-spec> --backup <new-private-directory>',
    result: update.result,
    source: update.source,
    images: updatedState.spec.images,
    containers: updatedContainers,
    workerDefaultOff: true,
    schema: updateVerified.state.schema,
    state: updateVerified.state,
    gateEnabled: updatedState.publish,
    lockRetained: false,
    note: 'Same-source lifecycle replay verifies repaired data acceptance; different-source upgrade/rollback is covered by the separate cross-source matrix',
  }
  record(
    'real post-repair six-role lifecycle update completed with stopped-writer backup and old/new offline checks; HTTP/SEO/admin/private image/workspace preserved, gate stayed off, no residual operation lock',
  )
  execFileSync(process.execPath, ['scripts/v11-release.mjs', 'stop', '--project', recovered], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 180000,
  })
  helper.compose('down', '--remove-orphans')
  for (const owned of [project, recovered]) {
    const names = docker([
      'volume',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${owned}`,
      '--format',
      '{{.Name}}',
    ])
      .split(/\s+/)
      .filter(Boolean)
    assert.ok(names.length >= 6)
    assert.equal(docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${owned}`]), '')
  }
  record(
    'only exact fresh test projects stopped; volumes, images, original fault evidence and backup retained',
  )
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error =
    error?.code === 'ERR_ASSERTION'
      ? error.message
      : 'Controlled final repair test stopped; inspect private local command log without publishing credentials'
  console.error(report.error)
  process.exitCode = 1
} finally {
  save()
}
